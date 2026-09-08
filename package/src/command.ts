import { x, type Output } from 'tinyexec'
import {
  assertDockerAvailable,
  ensureImage,
  removeContainer,
  runArgs as dockerRunArgs,
  startArgs as dockerStartArgs,
} from './docker.js'
import {
  applyRuntimeEnvironment,
  type RuntimeOptions,
} from './runtime.js'
import { createProcess, type ProcessStartOptions } from './process.js'

type CommandRunnerOptions = {
  binary: string
  containerName: string
  runtime?: RuntimeOptions
  image?: string
  name: string
  signal: AbortSignal
}

type RunOptions = {
  input?: string
}

type StartOptions = ProcessStartOptions & {
  ports: number[]
}

/** Internal adapter shared by the local-binary and Docker runtimes. */
export type CommandRunner = {
  prepare(onMessage: (message: string) => void): Promise<void>
  run(homeDir: string, args: string[], options?: RunOptions): Promise<Output>
  start(homeDir: string, args: string[], options: StartOptions): Promise<void>
  stop(): Promise<void>
}

/** Extracts actionable stderr from a failed tinyexec command. */
export function commandErrorMessage(error: unknown): string {
  if (error && typeof error === 'object' && 'output' in error) {
    const output = (error as { output?: { stderr?: unknown } }).output
    if (typeof output?.stderr === 'string' && output.stderr.trim()) {
      return output.stderr
        .slice(-(64 * 1024))
        .trim()
        .split(/\r?\n/)
        .slice(-50)
        .join('\n')
    }
  }
  return error instanceof Error ? error.message : String(error)
}

export function createCommandRunner(options: CommandRunnerOptions): CommandRunner {
  const {
    binary,
    containerName,
    runtime,
    image,
    name,
    signal,
  } = options
  // Runtime environment belongs to the chain process. For Docker, it is
  // encoded in `docker run` arguments below; applying it to the host Docker
  // client could alter DOCKER_HOST, DOCKER_CONFIG, PATH, or similar controls.
  const processEnvironment = image
    ? process.env
    : applyRuntimeEnvironment(process.env, runtime)
  const managedProcess = createProcess(name)
  const dockerOptions = (homeDir: string) => ({
    image: image!,
    homeDir,
    runtime,
  })

  const oneShotCommand = (homeDir: string, args: string[], interactive = false) =>
    image
      ? {
          command: 'docker',
          args: dockerRunArgs(dockerOptions(homeDir), binary, args, { interactive }),
        }
      : {
          command: binary,
          args: [...args, '--home', homeDir],
        }

  return {
    async prepare(onMessage) {
      if (!image) return
      await assertDockerAvailable(image, signal)
      await ensureImage(image, onMessage, signal)
    },

    async run(homeDir, args, runOptions = {}) {
      signal.throwIfAborted()
      const invocation = oneShotCommand(homeDir, args, runOptions.input !== undefined)
      try {
        const result = x(invocation.command, invocation.args, {
          signal,
          throwOnError: true,
          nodeOptions: { stdio: 'pipe', env: processEnvironment },
        })
        if (runOptions.input !== undefined) result.process?.stdin?.end(runOptions.input)
        const output = await result
        signal.throwIfAborted()
        return output
      } catch (error) {
        signal.throwIfAborted()
        throw new Error(commandErrorMessage(error), { cause: error })
      }
    },

    start(homeDir, args, { ports, ...startOptions }) {
      const invocation = image
        ? {
            command: 'docker',
            args: dockerStartArgs(dockerOptions(homeDir), binary, args, {
              name: containerName,
              ports,
            }),
          }
        : {
            command: binary,
            args: [...args, '--home', homeDir],
          }

      return managedProcess.start(invocation.command, invocation.args, {
        ...startOptions,
        environment: processEnvironment,
        signal,
      })
    },

    async stop() {
      try {
        await managedProcess.stop()
      } finally {
        if (image) await removeContainer(containerName)
      }
    },
  }
}
