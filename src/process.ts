import { exec } from 'tinyexec';
import type { Emitter } from 'mitt';
import type { ChildProcess } from 'node:child_process';

import { stripColors } from './utils.js';

export type EventTypes = {
  exit: number | null;
  listening: undefined;
  message: string;
  stderr: string;
  stdout: string;
};

export type ProcessResolverOptions = {
  process: ReturnType<typeof exec>;
  resolve(): void;
  reject(reason: string): Promise<void>;
};

export type ProcessStartOptions = {
  emitter: Emitter<EventTypes>;
  resolver(options: ProcessResolverOptions): void;
};

export type Process = {
  start(command: string, args: string[], options: ProcessStartOptions): Promise<void>;
  stop(): Promise<void>;
};

export type ProcessOptions = {
  /** Grace period (ms) between SIGTERM and SIGKILL escalation on stop(). @default 5_000 */
  killGracePeriod?: number;
};

/** Truncated tail of buffered stderr, for surfacing e.g. a Go panic in error messages. */
function errorTail(errorMessages: string[]): string {
  if (errorMessages.length === 0) return '';
  const tail = errorMessages.slice(-10).join('\n');
  return `\n${tail.length > 2000 ? tail.slice(-2000) : tail}`;
}

/** Sends SIGTERM, escalating to SIGKILL if the process hasn't exited within gracePeriodMs. */
async function terminate(proc: ChildProcess, gracePeriodMs: number) {
  if (proc.exitCode !== null) return;

  const closed = new Promise<void>(resolve => proc.on('close', () => resolve()));
  proc.kill('SIGTERM');

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<'timeout'>(resolve => {
    timer = setTimeout(() => resolve('timeout'), gracePeriodMs);
  });

  const result = await Promise.race([closed.then(() => 'closed' as const), timedOut]);
  clearTimeout(timer);

  if (result === 'timeout' && proc.exitCode === null) {
    proc.kill('SIGKILL');
    await closed;
  }
}

/**
 * Creates a managed child process wrapper using tinyexec.
 *
 * Handles spawning, stdout/stderr forwarding to the emitter,
 * and graceful shutdown via SIGTERM (escalating to SIGKILL if ignored).
 */
export function createProcess(name: string, options: ProcessOptions = {}): Process {
  const { killGracePeriod = 5_000 } = options;
  let child: ReturnType<typeof exec> | undefined;
  const errorMessages: string[] = [];

  return {
    start(command, args, { emitter, resolver }) {
      const { promise, resolve, reject } = Promise.withResolvers<void>();

      child = exec(command, args, {
        nodeOptions: { stdio: 'pipe' },
      });

      const proc = child.process!;

      async function kill() {
        await terminate(proc, killGracePeriod);
      }

      resolver({
        process: child,
        resolve() {
          emitter.emit('listening', undefined);
          resolve();
        },
        async reject(reason) {
          await kill();
          reject(new Error(`Failed to start "${name}": ${reason}${errorTail(errorMessages)}`));
        },
      });

      proc.stdout?.on('data', (data: Buffer) => {
        const message = stripColors(data.toString());
        emitter.emit('message', message);
        emitter.emit('stdout', message);
      });

      proc.stderr?.on('data', (data: Buffer) => {
        const message = stripColors(data.toString());
        errorMessages.push(message);
        if (errorMessages.length > 20) errorMessages.shift();
        emitter.emit('message', message);
        emitter.emit('stderr', message);
      });

      proc.on('exit', code => {
        emitter.emit('exit', code);
      });

      // A missing binary (ENOENT) etc. never reaches 'exit' — without this the
      // startup resolver would never settle and start() would hang forever.
      proc.on('error', (error) => {
        reject(new Error(`Failed to start "${name}": ${error.message}${errorTail(errorMessages)}`));
      });

      return promise;
    },

    async stop() {
      if (!child) return;
      const proc = child.process;
      if (!proc || proc.exitCode !== null) return;

      await terminate(proc, killGracePeriod);
      child = undefined;
    },
  };
}
