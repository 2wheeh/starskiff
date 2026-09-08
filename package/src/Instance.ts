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
  /** Start the instance. */
  start(): Promise<void>
  /** Stop the instance and clean up resources. */
  stop(): Promise<void>
  /** Stop then start the instance. */
  restart(): Promise<void>
  /** Subscribe to instance events (message, stdout, stderr, listening, exit). */
  on: Emitter<EventTypes>['on']
  /** Unsubscribe from instance events. */
  off: Emitter<EventTypes>['off']
  /** Stop the instance when leaving an `await using` scope. */
  [Symbol.asyncDispose](): Promise<void>
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
  /** Aborted when the managed start operation times out. */
  signal: AbortSignal
  /** Record the active startup phase for actionable failure diagnostics. */
  setStartDiagnostics(diagnostics: InstanceStartDiagnostics): void
  setEndpoint?(endpoint: { host?: string; port?: number }): void
  status: InstanceStatus
}

export type InstanceStartDiagnostics = {
  /** Human-readable startup phase, such as `init` or `readiness`. */
  phase: string
  /** Logical command, excluding runtime wrappers and injected environment. */
  command?: string
}

export type InstanceStopContext = {
  emitter: Emitter<EventTypes>
  status: InstanceStatus
}

/** Values supplied by an instance definition before lifecycle management is applied. */
export type InstanceDefinition = {
  name: string
  host: string
  port: number
  start(options: InstanceStartOptions, context: InstanceStartContext): Promise<void>
  stop(context: InstanceStopContext): Promise<void>
}

/** Callable returned by {@link define}. */
export type InstanceFactory<
  P,
  R extends InstanceDefinition = InstanceDefinition,
> = (
  ...args: undefined extends P
    ? [parameters?: P, options?: InstanceOptions]
    : [parameters: P, options?: InstanceOptions]
) => Omit<R, keyof Instance> & Instance

const DIAGNOSTIC_OUTPUT_LIMIT = 64 * 1024
const DIAGNOSTIC_LINE_LIMIT = 50

function outputTail(output: string): string | undefined {
  const normalized = output.slice(-DIAGNOSTIC_OUTPUT_LIMIT).trimEnd()
  if (!normalized) return undefined
  return normalized.split(/\r?\n/).slice(-DIAGNOSTIC_LINE_LIMIT).join('\n')
}

function startError(
  name: string,
  cause: unknown,
  diagnostics: InstanceStartDiagnostics | undefined,
  output: string,
  timedOut: boolean,
): Error {
  const phase = diagnostics ? ` during ${diagnostics.phase}` : ''
  const lines = [
    `Instance "${name}" failed to start${timedOut ? ' in time' : ''}${phase}.`,
  ]
  if (diagnostics?.command) lines.push(`command: ${diagnostics.command}`)

  const detail = outputTail(cause instanceof Error ? cause.message : String(cause))
  if (!timedOut && detail) lines.push(`details:\n${detail}`)

  const tail = outputTail(output)
  if (tail) lines.push(`last ${DIAGNOSTIC_LINE_LIMIT} lines:\n${tail}`)

  return new Error(lines.join('\n'), { cause })
}

/**
 * Creates an instance definition.
 *
 * Takes a definition function that returns the instance's name, host, port,
 * and start/stop implementations. The returned callable always treats its
 * first argument as definition parameters and its second as lifecycle
 * options. For a parameterless definition, pass `undefined` before options.
 *
 * @example
 * ```ts
 * const simd = Instance.define((params?: { chainId?: string }) => ({
 *   name: 'simd',
 *   host: 'localhost',
 *   port: 26657,
 *   chainId: params?.chainId ?? 'test-1',
 *   async start(opts, ctx) { ... },
 *   async stop(ctx) { ... },
 * }))
 *
 * const instance = simd({ chainId: 'test-1' }, { timeout: 30_000 })
 * instance.chainId // string — extra field preserved
 * await instance.start()
 * ```
 */
export function define<P = undefined, R extends InstanceDefinition = InstanceDefinition>(
  fn: (parameters: P) => R,
): InstanceFactory<P, R> {
  return ((parameters: P, options: InstanceOptions = {}) => {
    const raw = fn(parameters)
    const { name, start, stop } = raw
    let host = raw.host
    let port = raw.port
    const { messageBuffer = 20, timeout = 60_000 } = options

    let startOperation: Promise<void> | undefined
    let stopOperation: Promise<void> | undefined
    let stopCleanupOperation: Promise<void> | undefined
    let restartOperation: Promise<void> | undefined

    const emitter = mitt<EventTypes>()

    let messages: string[] = []
    let diagnosticOutput = ''
    let startDiagnostics: InstanceStartDiagnostics | undefined
    let status: InstanceStatus = 'idle'
    let restarting = false

    const onMessage: Handler<string> = (message) => {
      messages.push(message)
      if (messages.length > messageBuffer) messages.shift()
      diagnosticOutput += message
      if (diagnosticOutput.length > DIAGNOSTIC_OUTPUT_LIMIT) {
        diagnosticOutput = diagnosticOutput.slice(-DIAGNOSTIC_OUTPUT_LIMIT)
      }
    }
    const onListening = () => {
      if (status === 'starting') status = 'started'
    }
    const onExit = () => {
      // A managed stop owns the transition to `stopped` after all cleanup is
      // complete. Exit events only represent an unexpected running-process
      // exit; changing state while `stopping` would reopen start too early.
      if (status === 'started') status = 'stopped'
    }

    const subscribe = () => {
      emitter.on('message', onMessage)
      emitter.on('listening', onListening)
      emitter.on('exit', onExit)
    }

    const unsubscribe = () => {
      emitter.off('message', onMessage)
      emitter.off('listening', onListening)
      emitter.off('exit', onExit)
    }

    const clearRuntimeState = () => {
      self.messages.clear()
      diagnosticOutput = ''
      startDiagnostics = undefined
      unsubscribe()
    }

    const self: Instance = {
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

      async start(): Promise<void> {
        if (status === 'starting' && startOperation) return startOperation
        if (status !== 'idle' && status !== 'stopped')
          throw new Error(`Instance "${name}" is not in an idle or stopped state. Status: ${status}`)

        status = 'starting'
        diagnosticOutput = ''
        startDiagnostics = undefined
        subscribe()

        const controller = new AbortController()
        startOperation = (async () => {
          let startTimer: ReturnType<typeof setTimeout> | undefined
          let timedOut = false
          const startTimeout = new Promise<never>((_, reject) => {
            startTimer = setTimeout(() => {
              timedOut = true
              const timeoutCause = new Error(`Instance "${name}" exceeded its ${timeout}ms start timeout.`)
              const error = startError(name, timeoutCause, startDiagnostics, diagnosticOutput, true)
              controller.abort(error)
              reject(error)
            }, timeout)
          })

          const rawStart = Promise.resolve().then(() => start(
            { port },
            {
              emitter,
              signal: controller.signal,
              setStartDiagnostics(diagnostics) {
                startDiagnostics = { ...diagnostics }
              },
              setEndpoint(endpoint) {
                if (endpoint.host !== undefined) host = endpoint.host
                if (endpoint.port !== undefined) port = endpoint.port
              },
              status: self.status,
            },
          ))

          try {
            await Promise.race([rawStart, startTimeout])
            status = 'started'
          } catch (error) {
            if (!timedOut) {
              status = 'idle'
              const enriched = startDiagnostics
                ? startError(name, error, startDiagnostics, diagnosticOutput, false)
                : error
              clearRuntimeState()
              throw enriched
            }

            // A timed-out start is not retryable until its teardown finishes.
            // Keeping the instance in `stopping` prevents an old child from
            // racing with a new start and overwriting shared runtime state.
            status = 'stopping'
            stopCleanupOperation = Promise.resolve()
              .then(() => stop({ emitter, status: self.status }))
              .then(
                () => {
                  status = 'idle'
                  clearRuntimeState()
                },
                () => {
                  // Startup never completed, so keep new starts blocked. A
                  // later stop() can retry teardown from this state.
                  status = 'stopping'
                },
              )
              .finally(() => {
                startOperation = undefined
                stopCleanupOperation = undefined
              })
            throw error
          } finally {
            if (startTimer) clearTimeout(startTimer)
            if (!timedOut) startOperation = undefined
          }
        })()

        return startOperation
      },

      async stop(): Promise<void> {
        if (status === 'stopping' && stopOperation) return stopOperation
        if (status === 'stopping' && stopCleanupOperation) {
          await stopCleanupOperation
          const settledStatus = status as InstanceStatus
          if (settledStatus === 'idle' || settledStatus === 'stopped') return
          return self.stop()
        }
        if (status === 'starting') throw new Error(`Instance "${name}" is starting.`)

        status = 'stopping'
        stopOperation = (async () => {
          let stopTimer: ReturnType<typeof setTimeout> | undefined
          let timedOut = false
          const stopTimeout = new Promise<never>((_, reject) => {
            stopTimer = setTimeout(() => {
              timedOut = true
              reject(new Error(`Instance "${name}" failed to stop in time.`))
            }, timeout)
          })
          const rawStop = Promise.resolve().then(() => stop({ emitter, status: self.status }))

          try {
            await Promise.race([rawStop, stopTimeout])
            status = 'stopped'
            clearRuntimeState()
          } catch (error) {
            if (!timedOut) {
              status = 'started'
            } else {
              // Keep `stopping` until the original teardown settles. A stop
              // timeout must not make a still-running instance restartable.
              stopCleanupOperation = rawStop
                .then(() => {
                  status = 'stopped'
                  clearRuntimeState()
                })
                .catch(() => {
                  status = 'started'
                })
                .finally(() => {
                  stopCleanupOperation = undefined
                })
            }
            throw error
          } finally {
            if (stopTimer) clearTimeout(stopTimer)
            stopOperation = undefined
          }
        })()

        return stopOperation
      },

      async restart(): Promise<void> {
        if (restarting && restartOperation) return restartOperation

        restarting = true
        restartOperation = self.stop()
          .then(() => self.start())
          .then(() => {})
          .finally(() => {
            restarting = false
            restartOperation = undefined
          })

        return restartOperation
      },

      on: emitter.on.bind(emitter),
      off: emitter.off.bind(emitter),
      [Symbol.asyncDispose]() {
        return self.stop()
      },
    } satisfies Instance

    const knownKeys = new Set(Reflect.ownKeys(self))
    const extraDescriptors = Object.fromEntries(
      Reflect.ownKeys(raw)
        .filter((key) => !knownKeys.has(key))
        .map((key) => [key, Object.getOwnPropertyDescriptor(raw, key)!]),
    )

    return Object.defineProperties(self, extraDescriptors) as Omit<R, keyof Instance> & Instance
  }) as InstanceFactory<P, R>
}
