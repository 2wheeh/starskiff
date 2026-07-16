import net from 'node:net'

/** Distinct free TCP ports for a Cosmos SDK instance. `evmPort` is only present when requested. */
export type PortSet = {
  rpcPort: number
  grpcPort: number
  apiPort: number
  p2pPort: number
  grpcWebPort: number
  pprofPort: number
  evmPort?: number
}

const PORT_KEYS = ['rpcPort', 'grpcPort', 'apiPort', 'p2pPort', 'grpcWebPort', 'pprofPort'] as const

/** Binds a server to an OS-assigned ephemeral port and resolves with both. */
function grabPort(): Promise<{ server: net.Server; port: number }> {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on('error', reject)
    server.listen(0, () => {
      const address = server.address()
      if (!address || typeof address === 'string') {
        reject(new Error('failed to bind an ephemeral port'))
        return
      }
      resolve({ server, port: address.port })
    })
  })
}

/**
 * Finds a set of distinct free TCP ports for launching a Cosmos SDK instance.
 *
 * Cosmos binaries don't support binding to port 0 at start time, so ports
 * must be resolved up front. Each port is grabbed by binding a server to
 * port 0 and reading back the OS-assigned port. Every server is held open
 * until ALL ports are bound, then closed together — closing one early would
 * free its port for the OS to hand back out to a later grab in this same
 * call, producing duplicates.
 *
 * @remarks
 * TOCTOU caveat: a port is only guaranteed free at grab time. Nothing stops
 * another process from binding it before the instance actually starts —
 * rare in practice, but not impossible under heavy concurrent test runs.
 *
 * @param opts.evm - Also grab an `evmPort` for EVM-enabled chains (e.g. xpla, evmd).
 */
export async function findFreePorts(opts?: { evm?: boolean }): Promise<PortSet> {
  const keys = opts?.evm ? [...PORT_KEYS, 'evmPort' as const] : PORT_KEYS

  const grabbed = await Promise.all(keys.map(() => grabPort()))

  await Promise.all(
    grabbed.map(({ server }) => new Promise<void>((resolve) => server.close(() => resolve()))),
  )

  const ports = {} as Record<(typeof keys)[number], number>
  keys.forEach((key, i) => {
    ports[key] = grabbed[i].port
  })
  return ports as PortSet
}
