import { describe, it, expect, vi } from 'vitest';
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
  });

  describe('lifecycle', () => {
    it('start → started', async () => {
      const { instance } = fakeInstance({ startDelay: 10 });
      const inst = instance();

      expect(inst.status).toBe('idle');
      const stopFn = await inst.start();
      expect(inst.status).toBe('started');
      expect(typeof stopFn).toBe('function');
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

      const inst = instance({ timeout: 50 });

      await expect(inst.start()).rejects.toThrow('failed to start in time');
      expect(inst.status).toBe('idle');
      expect(stopCalls).toBe(1); // best-effort teardown of the hung child

      hang = false;
      await inst.start();
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

      const inst = instance({ messageBuffer: 3 });
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

      const inst = instance({ timeout: 100 });
      await expect(inst.start()).rejects.toThrow('failed to start in time');
    });
  });
});

describe('createProcess', () => {
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
