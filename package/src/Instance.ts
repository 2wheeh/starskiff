import mitt, { type Emitter, type Handler } from 'mitt'
import type { EventTypes } from './process.js'

export { simd } from './instances/simd.js'
export { wasmd } from './instances/wasmd.js'
export { gaiad } from './instances/gaiad.js'
export { mantra } from './instances/mantra.js'
export { xplad } from './instances/xplad.js'
export { xrplevm } from './instances/xrplevm.js'
export { evmd } from './instances/evmd.js'
export { marood } from './instances/marood.js'
export { hermes } from './instances/hermes.js'

export type InstanceStatus =
  | 'idle'
  | 'starting'
  | 'started'
  | 'stopping'
  | 'stopped'
  | 'restarting'

/** A managed instance with lifecycle control and event emitting. */
export type Instance = {
  /** Host the instance is running on. */
  host: string
  /** Name of the instance (e.g. "simd"). */
  name: string
  /** RPC port the instance is listening on. */
  port: number
  /** Current lifecycle status. */
  status: InstanceStatus
  /** In-memory message buffer for debugging. */
  messages: {
    /** Clear all buffered messages. */
    clear(): void
    /** Get all buffered messages. */
    get(): string[]
  }
  /** Start the instance. Returns a stop function. */
  start(): Promise<() => void>
  /** Stop the instance and clean up resources. */
  stop(): Promise<void>
  /** Stop then start the instance. */
  restart(): Promise<void>
  /** Subscribe to instance events (message, stdout, stderr, listening, exit). */
  on: Emitter<EventTypes>['on']
  /** Unsubscribe from instance events. */
  off: Emitter<EventTypes>['off']
}

export type InstanceOptions = {
  /** Number of messages to store in-memory. @default 20 */
  messageBuffer?: number
  /** Timeout (in milliseconds) for starting and stopping. @default 60_000 */
  timeout?: number
}

export type InstanceStartOptions = {
  port?: number | undefined
}

export type InstanceStartContext = {
  emitter: Emitter<EventTypes>
  setEndpoint?(endpoint: { host?: string; port?: number }): void
  status: InstanceStatus
}

export type InstanceStopContext = {
  emitter: Emitter<EventTypes>
  status: InstanceStatus
}

type DefineFnResult = {
  name: string
  host: string
  port: number
  start(options: InstanceStartOptions, context: InstanceStartContext): Promise<void>
  stop(context: InstanceStopContext): Promise<void>
}

/**
 * Creates an instance definition.
 *
 * Takes a factory function that returns the instance's name, host, port,
 * and start/stop implementations. Returns a callable that creates
 * managed instances with lifecycle control.
 *
 * @example
 * ```ts
 * const simd = Instance.define((params?: { chainId?: string }) => ({
 *   name: 'simd',
 *   host: 'localhost',
 *   port: 26657,
 *   async start(opts, ctx) { ... },
 *   async stop(ctx) { ... },
 * }))
 *
 * const instance = simd({ chainId: 'test-1' })
 * instance.chainId // string — extra field preserved
 * await instance.start()
 * ```
 */
export function define<P = undefined, R extends DefineFnResult = DefineFnResult>(
  fn: (parameters: P) => R,
): (...args: P extends undefined ? [options?: InstanceOptions] : [parameters: P, options?: InstanceOptions]) => Omit<R, keyof DefineFnResult> & Instance {
  return (...[parametersOrOptions, options_]: any[]) => {
    const isInstanceOptions = (v: any): v is InstanceOptions =>
      v != null && typeof v === 'object' && ('messageBuffer' in v || 'timeout' in v)

    // When P = undefined: (options?) → first arg is options
    // When P is defined: (params, options?) → first arg is params, second is options
    const parameters = (options_ !== undefined || !isInstanceOptions(parametersOrOptions)
      ? parametersOrOptions
      : undefined) as P
    const options: InstanceOptions = options_ ?? (isInstanceOptions(parametersOrOptions) ? parametersOrOptions : {})

    const raw = fn(parameters)
    const { name, start, stop } = raw
    let host = raw.host
    let port = raw.port
    const { messageBuffer = 20, timeout = 60_000 } = options

    let startResolver = Promise.withResolvers<() => void>()
    let stopResolver = Promise.withResolvers<void>()
    let restartResolver = Promise.withResolvers<void>()

    const emitter = mitt<EventTypes>()

    let messages: string[] = []
    let status: InstanceStatus = 'idle'
    let restarting = false

    const onMessage: Handler<string> = (message) => {
      messages.push(message)
      if (messages.length > messageBuffer) messages.shift()
    }
    const onListening = () => { status = 'started' }
    const onExit = () => { status = 'stopped' }

    const self = {
      get host() { return host },
      name,
      get port() { return port },
      get status() {
        if (restarting) return 'restarting'
        return status
      },
      messages: {
        clear() { messages = [] },
        get() { return [...messages] },
      },

      async start() {
        if (status === 'starting') return startResolver.promise
        if (status !== 'idle' && status !== 'stopped')
          throw new Error(`Instance "${name}" is not in an idle or stopped state. Status: ${status}`)

        let startTimer: ReturnType<typeof setTimeout> | undefined
        // Guards the in-flight start(...) call's .then/.catch below: once the
        // timeout fires, status/resolvers have already been reset (and a
        // retry may be in flight), so a late settle must not touch them.
        let timedOut = false
        if (typeof timeout === 'number') {
          startTimer = setTimeout(() => {
            timedOut = true
            status = 'idle'
            self.messages.clear()
            emitter.off('message', onMessage)
            emitter.off('listening', onListening)
            emitter.off('exit', onExit)
            startResolver.reject(new Error(`Instance "${name}" failed to start in time.`))
            startResolver = Promise.withResolvers<() => void>()
            // Best-effort: the child may still be running post-timeout, so
            // ask the underlying stop to tear it down. Never let this throw —
            // the instance must remain retryable regardless of the outcome.
            try {
              void stop({ emitter, status: self.status }).catch(() => {})
            } catch {
              // ignore
            }
          }, timeout)
        }

        emitter.on('message', onMessage)
        emitter.on('listening', onListening)
        emitter.on('exit', onExit)

        status = 'starting'
        start(
          { port },
          {
            emitter,
            setEndpoint(endpoint) {
              if (endpoint.host) host = endpoint.host
              if (endpoint.port) port = endpoint.port
            },
            status: self.status,
          },
        )
          .then(() => {
            if (startTimer) clearTimeout(startTimer)
            if (timedOut) return
            status = 'started'
            stopResolver = Promise.withResolvers<void>()
            startResolver.resolve(self.stop.bind(self))
          })
          .catch((error) => {
            if (startTimer) clearTimeout(startTimer)
            if (timedOut) return
            status = 'idle'
            self.messages.clear()
            emitter.off('message', onMessage)
            emitter.off('listening', onListening)
            emitter.off('exit', onExit)
            startResolver.reject(error)
            startResolver = Promise.withResolvers<() => void>()
          })

        return startResolver.promise
      },

      async stop() {
        if (status === 'stopping') return stopResolver.promise
        if (status === 'starting') throw new Error(`Instance "${name}" is starting.`)

        let stopTimer: ReturnType<typeof setTimeout> | undefined
        if (typeof timeout === 'number') {
          stopTimer = setTimeout(() => {
            stopResolver.reject(new Error(`Instance "${name}" failed to stop in time.`))
          }, timeout)
        }

        status = 'stopping'
        stop({
          emitter,
          status: self.status,
        })
          .then((...args) => {
            if (stopTimer) clearTimeout(stopTimer)
            status = 'stopped'
            self.messages.clear()
            emitter.off('message', onMessage)
            emitter.off('listening', onListening)
            emitter.off('exit', onExit)
            startResolver = Promise.withResolvers<() => void>()
            stopResolver.resolve(...args)
          })
          .catch((error) => {
            if (stopTimer) clearTimeout(stopTimer)
            status = 'started'
            stopResolver.reject(error)
            stopResolver = Promise.withResolvers<void>()
          })

        return stopResolver.promise
      },

      async restart() {
        if (restarting) return restartResolver.promise

        restarting = true

        self.stop()
          .then(() => self.start())
          .then(() => {
            restarting = false
            restartResolver.resolve()
            restartResolver = Promise.withResolvers<void>()
          })
          .catch((error) => {
            restarting = false
            restartResolver.reject(error)
            restartResolver = Promise.withResolvers<void>()
          })

        return restartResolver.promise
      },

      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
    } satisfies Instance

    const knownKeys = new Set(['name', 'host', 'port', 'start', 'stop'])
    const extra: Record<string, unknown> = {}
    for (const key of Object.keys(raw)) {
      if (!knownKeys.has(key)) extra[key] = (raw as Record<string, unknown>)[key]
    }

    return Object.assign(self, extra) as Omit<R, keyof DefineFnResult> & Instance
  }
}
