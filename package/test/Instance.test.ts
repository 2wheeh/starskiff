import { afterEach, describe, it, expect, vi } from 'vitest';
import mitt from 'mitt';
import * as Instance from '../src/Instance.js';
import { createProcess, type EventTypes } from '../src/process.js';

/** Creates a fake instance that resolves start/stop via callbacks. */
function fakeInstance(options?: { startDelay?: number; stopDelay?: number }) {
  const { startDelay = 0, stopDelay = 0 } = options || {};

  let startCb: (() => void) | undefined;
  let stopCb: (() => void) | undefined;

  const instance = Instance.define((parameters?: { port?: number }) => ({
    name: 'fake',
    host: 'localhost',
    port: parameters?.port ?? 3000,
    async start(_opts, { emitter }) {
      await new Promise<void>(resolve => {
        if (startDelay > 0) {
          setTimeout(() => {
            emitter.emit('listening', undefined);
            resolve();
          }, startDelay);
        } else {
          startCb = () => {
            emitter.emit('listening', undefined);
            resolve();
          };
        }
      });
    },
    async stop() {
      await new Promise<void>(resolve => {
        if (stopDelay > 0) {
          setTimeout(resolve, stopDelay);
        } else {
          stopCb = resolve;
        }
      });
    },
  }));

  return {
    instance,
    resolveStart: () => startCb?.(),
    resolveStop: () => stopCb?.(),
  };
}

afterEach(() => vi.useRealTimers());

describe('Instance', () => {
  describe('define', () => {
    it('creates an instance with correct defaults', () => {
      const { instance } = fakeInstance();
      const inst = instance();
      expect(inst.name).toBe('fake');
      expect(inst.host).toBe('localhost');
      expect(inst.port).toBe(3000);
      expect(inst.status).toBe('idle');
    });

    it('accepts parameters', () => {
      const { instance } = fakeInstance();
      const inst = instance({ port: 4000 });
      expect(inst.port).toBe(4000);
    });

    it('never guesses option-shaped parameters', async () => {
      const factory = Instance.define((parameters?: {
        messageBuffer?: number;
        timeout?: number;
      }) => ({
        name: 'explicit-arguments',
        host: 'localhost',
        port: parameters?.timeout ?? 3000,
        parameterMessageBuffer: parameters?.messageBuffer,
        async start(_opts, { emitter }) {
          emitter.emit('message', 'first');
          emitter.emit('message', 'second');
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = factory(
        { timeout: 4000, messageBuffer: 99 },
        { messageBuffer: 1 },
      );
      await inst.start();

      expect(inst.port).toBe(4000);
      expect(inst.parameterMessageBuffer).toBe(99);
      expect(inst.messages.get()).toEqual(['second']);
    });

    it('preserves extra property descriptors from the definition', () => {
      let value = 1;
      const instance = Instance.define(() => ({
        name: 'descriptors',
        host: 'localhost',
        port: 3000,
        get currentValue() { return value; },
        setValue(next: number) { value = next; },
        async start() {},
        async stop() {},
      }));

      const inst = instance();
      expect(Object.getOwnPropertyDescriptor(inst, 'currentValue')?.get).toBeTypeOf('function');
      expect(inst.currentValue).toBe(1);
      inst.setValue(2);
      expect(inst.currentValue).toBe(2);
    });

    it('does not let definition properties replace managed instance members', () => {
      const instance = Instance.define(() => ({
        name: 'reserved-members',
        host: 'localhost',
        port: 3000,
        status: 'raw-status',
        messages: 'raw-messages',
        restart: 'raw-restart',
        on: 'raw-on',
        off: 'raw-off',
        async start() {},
        async stop() {},
      }));

      const inst = instance();
      expect(inst.status).toBe('idle');
      expect(inst.messages.get).toBeTypeOf('function');
      expect(inst.restart).toBeTypeOf('function');
      expect(inst.on).toBeTypeOf('function');
      expect(inst.off).toBeTypeOf('function');
    });

    it('preserves symbol-keyed definition properties', () => {
      const marker = Symbol('marker');
      const instance = Instance.define(() => ({
        name: 'symbol-descriptor',
        host: 'localhost',
        port: 3000,
        [marker]: 'preserved',
        async start() {},
        async stop() {},
      }));

      expect(instance()[marker]).toBe('preserved');
    });
  });

  describe('lifecycle', () => {
    it('start → started', async () => {
      const { instance } = fakeInstance({ startDelay: 10 });
      const inst = instance();

      expect(inst.status).toBe('idle');
      const result = await inst.start();
      expect(inst.status).toBe('started');
      expect(result).toBeUndefined();
    });

    it('stop → stopped', async () => {
      const { instance } = fakeInstance({ startDelay: 10, stopDelay: 10 });
      const inst = instance();

      await inst.start();
      expect(inst.status).toBe('started');

      await inst.stop();
      expect(inst.status).toBe('stopped');
    });

    it('restart cycles through stop → start', async () => {
      const { instance } = fakeInstance({ startDelay: 10, stopDelay: 10 });
      const inst = instance();

      await inst.start();
      expect(inst.status).toBe('started');

      await inst.restart();
      expect(inst.status).toBe('started');
    });

    it('throws when starting a non-idle/stopped instance', async () => {
      const { instance } = fakeInstance({ startDelay: 10 });
      const inst = instance();
      await inst.start();

      await expect(inst.start()).rejects.toThrow('not in an idle or stopped state');
    });

    it('throws when stopping a starting instance', async () => {
      const { instance, resolveStart } = fakeInstance();
      const inst = instance();

      const startPromise = inst.start();
      expect(inst.status).toBe('starting');

      await expect(inst.stop()).rejects.toThrow('is starting');

      resolveStart();
      await startPromise;
    });

    it('deduplicates concurrent start calls', async () => {
      const { instance } = fakeInstance({ startDelay: 50 });
      const inst = instance();

      const p1 = inst.start();
      const p2 = inst.start();

      const [r1, r2] = await Promise.all([p1, p2]);
      expect(r1).toBe(r2);
    });

    it('deduplicates concurrent stop calls', async () => {
      const { instance } = fakeInstance({ startDelay: 10, stopDelay: 50 });
      const inst = instance();
      await inst.start();

      const p1 = inst.stop();
      const p2 = inst.stop();
      await Promise.all([p1, p2]);

      expect(inst.status).toBe('stopped');
    });

    it('can restart after stop', async () => {
      const { instance } = fakeInstance({ startDelay: 10, stopDelay: 10 });
      const inst = instance();

      await inst.start();
      await inst.stop();
      expect(inst.status).toBe('stopped');

      await inst.start();
      expect(inst.status).toBe('started');
    });

    it('retries successfully after a failed start', async () => {
      let attempt = 0;

      const instance = Instance.define(() => ({
        name: 'flaky',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          attempt++;
          if (attempt === 1) throw new Error('boom');
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();

      await expect(inst.start()).rejects.toThrow('boom');
      expect(inst.status).toBe('idle');

      await inst.start();
      expect(inst.status).toBe('started');
    });

    it('leaves the instance recoverable and stops the child after a start timeout', async () => {
      vi.useFakeTimers();
      let stopCalls = 0;
      let hang = true;

      const instance = Instance.define(() => ({
        name: 'hangs',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          if (hang) await new Promise(() => {}); // never resolves
          emitter.emit('listening', undefined);
        },
        async stop() {
          stopCalls++;
        },
      }));

      const inst = instance(undefined, { timeout: 50 });
      const startOperation = inst.start();
      const startFailure = expect(startOperation).rejects.toThrow('failed to start in time');
      await vi.advanceTimersByTimeAsync(50);

      await startFailure;
      expect(inst.status).toBe('idle');
      expect(stopCalls).toBe(1); // best-effort teardown of the hung child

      hang = false;
      await inst.start();
      expect(inst.status).toBe('started');
    });

    it('does not allow a retry while timeout cleanup is still running', async () => {
      vi.useFakeTimers();
      let finishStop: (() => void) | undefined;
      let receivedSignal: AbortSignal | undefined;

      const instance = Instance.define(() => ({
        name: 'cleanup-race',
        host: 'localhost',
        port: 3000,
        async start(_opts, { signal }) {
          receivedSignal = signal;
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
        async stop({ emitter }) {
          emitter.emit('exit', 0);
          await new Promise<void>(resolve => { finishStop = resolve; });
        },
      }));

      const inst = instance(undefined, { timeout: 20 });
      const startOperation = inst.start();
      const startFailure = expect(startOperation).rejects.toThrow('failed to start in time');
      await vi.advanceTimersByTimeAsync(20);
      await startFailure;

      expect(receivedSignal?.aborted).toBe(true);
      expect(inst.status).toBe('stopping');
      await expect(inst.start()).rejects.toThrow('Status: stopping');

      const joinedCleanup = inst.stop();
      finishStop?.();
      await joinedCleanup;
      expect(inst.status).toBe('idle');
    });

    it('keeps starts blocked and allows teardown retry after start cleanup fails', async () => {
      vi.useFakeTimers();
      let stopCalls = 0;

      const instance = Instance.define(() => ({
        name: 'failed-start-cleanup',
        host: 'localhost',
        port: 3000,
        async start(_opts, { signal }) {
          await new Promise<void>((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(signal.reason), { once: true });
          });
        },
        async stop() {
          stopCalls++;
          if (stopCalls === 1) throw new Error('cleanup failed');
        },
      }));

      const inst = instance(undefined, { timeout: 20 });
      const startOperation = inst.start();
      const startFailure = expect(startOperation).rejects.toThrow('failed to start in time');
      await vi.advanceTimersByTimeAsync(20);
      await startFailure;

      expect(inst.status).toBe('stopping');
      await expect(inst.start()).rejects.toThrow('Status: stopping');
      await inst.stop();
      expect(stopCalls).toBe(2);
      expect(inst.status).toBe('stopped');
    });

    it('accepts zero and empty endpoint values from the runtime', async () => {
      const instance = Instance.define(() => ({
        name: 'endpoint',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter, setEndpoint }) {
          setEndpoint?.({ host: '', port: 0 });
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();
      await inst.start();
      expect(inst.host).toBe('');
      expect(inst.port).toBe(0);
    });

    it('waits for timed-out stop cleanup before restarting', async () => {
      vi.useFakeTimers();
      let finishStop: (() => void) | undefined;
      let startCalls = 0;
      const instance = Instance.define(() => ({
        name: 'slow-stop',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          startCalls++;
          emitter.emit('listening', undefined);
        },
        async stop({ emitter }) {
          emitter.emit('exit', 0);
          await new Promise<void>(resolve => { finishStop = resolve; });
        },
      }));

      const inst = instance(undefined, { timeout: 20 });
      await inst.start();
      const stopOperation = inst.stop();
      const stopFailure = expect(stopOperation).rejects.toThrow('failed to stop in time');
      await vi.advanceTimersByTimeAsync(20);
      await stopFailure;

      const restartOperation = inst.restart();
      expect(inst.status).toBe('restarting');
      expect(startCalls).toBe(1);

      finishStop?.();
      await restartOperation;
      expect(startCalls).toBe(2);
      expect(inst.status).toBe('started');
    });
  });

  describe('events', () => {
    it('emits message events', async () => {
      const messages: string[] = [];

      const instance = Instance.define(() => ({
        name: 'eventer',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          emitter.emit('message', 'hello');
          emitter.emit('message', 'world');
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();
      inst.on('message', msg => messages.push(msg));
      await inst.start();

      expect(messages).toEqual(['hello', 'world']);
    });
  });

  describe('messages', () => {
    it('buffers messages', async () => {
      const instance = Instance.define(() => ({
        name: 'buffered',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          for (let i = 0; i < 5; i++) {
            emitter.emit('message', `msg-${i}`);
          }
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();
      await inst.start();

      expect(inst.messages.get()).toEqual(['msg-0', 'msg-1', 'msg-2', 'msg-3', 'msg-4']);
    });

    it('respects messageBuffer limit', async () => {
      const instance = Instance.define(() => ({
        name: 'limited',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          for (let i = 0; i < 10; i++) {
            emitter.emit('message', `msg-${i}`);
          }
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance(undefined, { messageBuffer: 3 });
      await inst.start();

      expect(inst.messages.get()).toEqual(['msg-7', 'msg-8', 'msg-9']);
    });

    it('returns a snapshot, not the live buffer', async () => {
      const instance = Instance.define(() => ({
        name: 'snapshot',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          emitter.emit('message', 'one');
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();
      await inst.start();

      const snapshot = inst.messages.get();
      snapshot.push('mutated');

      expect(inst.messages.get()).toEqual(['one']);
    });

    it('clears messages on stop', async () => {
      const instance = Instance.define(() => ({
        name: 'clearable',
        host: 'localhost',
        port: 3000,
        async start(_opts, { emitter }) {
          emitter.emit('message', 'test');
          emitter.emit('listening', undefined);
        },
        async stop() {},
      }));

      const inst = instance();
      await inst.start();
      expect(inst.messages.get().length).toBe(1);

      await inst.stop();
      expect(inst.messages.get()).toEqual([]);
    });
  });

  describe('timeout', () => {
    it('rejects start if timeout exceeded', async () => {
      const instance = Instance.define(() => ({
        name: 'slow',
        host: 'localhost',
        port: 3000,
        async start() {
          // Never resolves
          await new Promise(() => {});
        },
        async stop() {},
      }));

      const inst = instance(undefined, { timeout: 100 });
      await expect(inst.start()).rejects.toThrow('failed to start in time');
    });

    it('includes the active phase, logical command, and output tail', async () => {
      vi.useFakeTimers();
      const instance = Instance.define(() => ({
        name: 'diagnostic-timeout',
        host: 'localhost',
        port: 3000,
        async start(_options, { emitter, setStartDiagnostics }) {
          setStartDiagnostics({
            phase: 'readiness check',
            command: 'chaind start --home /chain',
          });
          for (let index = 0; index < 60; index++) {
            emitter.emit('message', `line-${index}\n`);
          }
          await new Promise(() => {});
        },
        async stop() {},
      }));

      const inst = instance(undefined, { messageBuffer: 1, timeout: 100 });
      const startOperation = inst.start();
      const startFailure = expect(startOperation).rejects.toThrow(
        /failed to start in time during readiness check[\s\S]*command: chaind start --home \/chain[\s\S]*last 50 lines:[\s\S]*line-10[\s\S]*line-59/,
      );
      await vi.advanceTimersByTimeAsync(100);

      await startFailure;
      expect(inst.messages.get()).toEqual([]);
    });

    it('enriches a non-timeout startup failure before clearing messages', async () => {
      const instance = Instance.define(() => ({
        name: 'diagnostic-failure',
        host: 'localhost',
        port: 3000,
        async start(_options, { emitter, setStartDiagnostics }) {
          setStartDiagnostics({ phase: 'init', command: 'chaind init validator' });
          emitter.emit('message', 'panic: invalid genesis\n');
          throw new Error('exit code 1');
        },
        async stop() {},
      }));

      const inst = instance();
      await expect(inst.start()).rejects.toThrow(
        /failed to start during init[\s\S]*command: chaind init validator[\s\S]*details:\nexit code 1[\s\S]*last 50 lines:\npanic: invalid genesis/,
      );
      expect(inst.messages.get()).toEqual([]);
    });
  });

  describe('async disposal', () => {
    it('stops the instance', async () => {
      const { instance } = fakeInstance({ startDelay: 10, stopDelay: 10 });
      const inst = instance();
      await inst.start();

      await inst[Symbol.asyncDispose]();

      expect(inst.status).toBe('stopped');
    });
  });
});

describe('createProcess', () => {
  it('passes the supplied environment to the managed child process', async () => {
    const proc = createProcess('environment-handoff');
    const emitter = mitt<EventTypes>();
    let stdout = '';
    const exited = new Promise<void>(resolve => {
      emitter.on('stdout', message => { stdout += message; });
      emitter.on('exit', () => { resolve(); });
    });

    await proc.start(
      process.execPath,
      ['-e', 'process.stdout.write(process.env.STARSKIFF_PROCESS_ENV_TEST ?? "missing")'],
      {
        emitter,
        environment: {
          ...process.env,
          STARSKIFF_PROCESS_ENV_TEST: 'forwarded',
        },
        resolver({ resolve }) { resolve(); },
      },
    );
    await exited;

    expect(stdout).toBe('forwarded');
  });

  it('rejects with a clear error when the binary is missing, instead of hanging', async () => {
    const proc = createProcess('missing-binary');
    const emitter = mitt<EventTypes>();

    await expect(
      proc.start('definitely-not-a-real-binary-xyz', [], {
        emitter,
        resolver() {},
      }),
    ).rejects.toThrow(/Failed to start "missing-binary"/);
  });

  it('escalates to SIGKILL when the child ignores SIGTERM', async () => {
    const proc = createProcess('sigterm-ignoring', { killGracePeriod: 50 });
    const emitter = mitt<EventTypes>();

    await proc.start('bash', ['-c', 'trap "" TERM; sleep 30'], {
      emitter,
      resolver({ resolve }) { resolve(); },
    });

    const start = Date.now();
    await proc.stop();
    const elapsed = Date.now() - start;

    // Should escalate past the ignored SIGTERM well before sleep(30) would exit naturally.
    expect(elapsed).toBeLessThan(2000);
  });

  it('clears the grace-period timer once stop() resolves normally', async () => {
    const proc = createProcess('normal-stop', { killGracePeriod: 5_000 });
    const emitter = mitt<EventTypes>();

    await proc.start('bash', ['-c', 'sleep 30'], {
      emitter,
      resolver({ resolve }) { resolve(); },
    });

    // Fake timers so the grace-period setTimeout is trackable without waiting
    // 5s in real time; the child's real 'close' event still fires immediately
    // and isn't affected by mocking JS timers.
    vi.useFakeTimers();
    try {
      await proc.stop();
      // A leaked timer (never cleared on the fast path) would still be armed here.
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });
});
