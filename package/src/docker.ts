import { x } from 'tinyexec'

/**
 * Home directory *inside* the container. The host's temp home dir is bind
 * mounted here, so genesis/config patching stays plain host-side file I/O —
 * the container and starskiff look at the same bytes.
 */
export const CONTAINER_HOME = '/chain'

/**
 * Resolves which container image an instance should run, enforcing the
 * "default artifact policy": there is NO automatic fallback chain — an instance
 * runs from exactly one source, chosen here.
 *
 * - neither `image` nor `binary` passed → the instance's default image;
 *   if the instance has none (no usable upstream image), throw — the caller
 *   must inject an `image` or a `binary`
 * - `image` passed → that image (must be a non-empty ref)
 * - `binary` passed → `undefined`, i.e. opt out of docker and run the binary
 * - both passed → throw; they select mutually exclusive runtimes
 *
 * Presence is checked with `in`, and present values must be non-empty strings —
 * `{ image: undefined }` / `{ binary: undefined }` / `''` are rejected rather
 * than silently selecting a runtime (or bypassing required injection).
 */
export function resolveInstanceImage(
  name: string,
  params: { image?: string; binary?: string },
  defaultImage?: string,
): string | undefined {
  const hasImage = 'image' in params
  const hasBinary = 'binary' in params
  if (hasImage && hasBinary) {
    throw new Error(
      `${name}: pass either "image" (container runtime) or "binary" (local binary on PATH), not both — ` +
      'they select mutually exclusive runtimes.',
    )
  }
  if (hasImage) {
    if (typeof params.image !== 'string' || params.image.trim() === '') {
      throw new Error(`${name}: "image" must be a non-empty image reference.`)
    }
    return params.image
  }
  if (hasBinary) {
    // Mirror the image validation: `{ binary: undefined }` must not silently
    // opt out of the container runtime (or bypass required injection).
    if (typeof params.binary !== 'string' || params.binary.trim() === '') {
      throw new Error(`${name}: "binary" must be a non-empty executable name or path.`)
    }
    return undefined
  }
  if (defaultImage === undefined) {
    throw new Error(
      `${name} has no default image, so the node source must be injected: pass ` +
      '"image" (a container image ref) or "binary" (a local executable on PATH).',
    )
  }
  return defaultImage
}

/** Container-runtime settings for an instance. */
export type DockerOptions = {
  /** Image reference, e.g. `ghcr.io/xpladev/xpla:v1.10.0`. */
  image: string
  /** Host directory bind mounted at {@link CONTAINER_HOME}. */
  homeDir: string
}

/**
 * Runs the container as the calling user so files written into the bind mount
 * (genesis.json, config.toml, the keyring) stay readable and *deletable* by the
 * host process. Without this the chain writes them as the image's user (often
 * root), and cleanup fails with EACCES.
 *
 * Windows has no uid/gid concept here; Docker Desktop handles ownership itself.
 */
function userArgs(): string[] {
  if (process.platform === 'win32') return []
  return ['--user', `${process.getuid?.()}:${process.getgid?.()}`]
}

function mountArgs({ homeDir }: DockerOptions): string[] {
  // -w pins the working dir to the mounted home. Some chain binaries (e.g. evmd)
  // instantiate the app at command-construction time and create a `data/` dir
  // relative to CWD *before* reading --home; if CWD is the image's default
  // (often `/`, not writable by --user) that panics. Anchoring CWD to the
  // writable mount makes any image work regardless of its baked-in WORKDIR.
  //
  // TMPDIR likewise: CosmWasm-enabled binaries (e.g. mantrachaind) create a
  // temp dir at command construction, and the image's /tmp may not be writable
  // by --user. Pointing TMPDIR at the mounted home keeps temp files somewhere
  // guaranteed-writable, and they're deleted with the home dir on stop().
  return [
    '-v', `${homeDir}:${CONTAINER_HOME}`,
    '-e', `HOME=${CONTAINER_HOME}`,
    '-e', `TMPDIR=${CONTAINER_HOME}`,
    '-w', CONTAINER_HOME,
  ]
}

/**
 * Builds `docker run` args for a one-shot chain command (init, keys, gentx, …).
 *
 * The container is disposable: it exists only to execute one CLI invocation
 * against the mounted home dir.
 */
export function runArgs(
  options: DockerOptions,
  binary: string,
  args: string[],
  opts?: { interactive?: boolean },
): string[] {
  return [
    'run', '--rm',
    ...(opts?.interactive ? ['-i'] : []),
    ...userArgs(),
    ...mountArgs(options),
    // --entrypoint pins the executable to the chain binary regardless of the
    // image's own ENTRYPOINT. Some images wrap the binary in `/bin/sh -ec`
    // (e.g. peersyst/exrp), which would swallow every argument after the first;
    // exec-form or empty entrypoints are unaffected by the override.
    '--entrypoint', binary,
    options.image,
    ...args, '--home', CONTAINER_HOME,
  ]
}

/**
 * Builds `docker run` args for the long-running node.
 *
 * Ports are published 1:1 (host port === container port) because the config
 * files — patched host-side before start — already bind the node to those exact
 * ports. Keeping the numbers identical means every URL getter, health poll and
 * cosmjs client works against the container exactly as it does against a local
 * process.
 *
 * Published only on 127.0.0.1: this is a local test node with fully-funded
 * genesis accounts, and everything that talks to it (health poll, cosmjs/viem,
 * a host-run relayer) uses localhost — so there's no reason to expose it on all
 * interfaces the way Docker's default `-p port:port` (0.0.0.0) would.
 *
 * The container runs ATTACHED: `docker run` forwards its stdout/stderr to our
 * child process, so message buffering, event emitting and exit detection are
 * identical to the binary runtime.
 */
export function startArgs(
  options: DockerOptions,
  binary: string,
  args: string[],
  opts: { name: string; ports: number[] },
): string[] {
  return [
    'run', '--rm',
    '--name', opts.name,
    ...userArgs(),
    ...mountArgs(options),
    ...opts.ports.flatMap((port) => ['-p', `127.0.0.1:${port}:${port}`]),
    // See runArgs: pin the executable regardless of the image's ENTRYPOINT.
    '--entrypoint', binary,
    options.image,
    ...args, '--home', CONTAINER_HOME,
  ]
}

/** Throws with an actionable message if the Docker CLI/daemon isn't usable. */
export async function assertDockerAvailable(image: string): Promise<void> {
  try {
    await x('docker', ['version', '--format', '{{.Server.Version}}'], {
      throwOnError: true,
      nodeOptions: { stdio: 'pipe' },
    })
  } catch {
    throw new Error(
      `Docker is required to run the "${image}" instance but the daemon isn't reachable. ` +
      `Start Docker, or pass a "binary" parameter to run a local binary from PATH instead.`,
    )
  }
}

/**
 * Pulls the image if it isn't present locally.
 *
 * `docker run` would pull implicitly, but a cold pull of a few hundred MB can
 * outlast the instance start timeout and would be invisible in the logs — so
 * pull up front, before the clock on `start()` matters.
 */
export async function ensureImage(image: string, onMessage?: (message: string) => void): Promise<void> {
  const present = await x('docker', ['image', 'inspect', image], { nodeOptions: { stdio: 'pipe' } })
  if (present.exitCode === 0) return

  onMessage?.(`[starskiff] pulling ${image} (first run)\n`)
  await x('docker', ['pull', image], { throwOnError: true, nodeOptions: { stdio: 'pipe' } })
}

/**
 * Force-removes the node container.
 *
 * Killing the `docker run` client does not necessarily reap the container it
 * started, so stop() must remove it explicitly — otherwise the next run collides
 * on the container name (and the published ports stay bound).
 */
export async function removeContainer(name: string): Promise<void> {
  try {
    await x('docker', ['rm', '-f', name], { nodeOptions: { stdio: 'pipe' } })
  } catch {
    // best-effort: the container may already be gone
  }
}
