import { appendFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { defineConfig, Instance, type CosmosChainParameters } from 'starskiff'

// A small HTTP dependency exercises the actual Vitest process boundary without
// requiring Docker or a Cosmos binary in the unit suite.
const chain = Instance.define((parameters?: CosmosChainParameters & { evmPort?: number }) => {
  const ports = [parameters?.rpcPort, parameters?.grpcPort, parameters?.apiPort,
    parameters?.p2pPort, parameters?.grpcWebPort, parameters?.pprofPort, parameters?.evmPort] as number[]
  const servers = ports.map(() => createServer((_request, response) => {
    response.setHeader('content-type', 'application/json')
    response.end(JSON.stringify({ chainId: 'fixture-1' }))
  }))
  const record = (event: string) => appendFileSync(process.env.STARSKIFF_TEST_LIFECYCLE!,
    `${JSON.stringify({ event, ports })}\n`)
  return {
    name: 'fixture', host: '127.0.0.1', port: ports[0],
    chainId: 'fixture-1', prefix: 'cosmos', denom: 'stake',
    grpcPort: ports[1], apiPort: ports[2],
    rpcUrl: `http://127.0.0.1:${ports[0]}`,
    grpcUrl: `http://127.0.0.1:${ports[1]}`,
    apiUrl: `http://127.0.0.1:${ports[2]}`,
    async start() {
      await Promise.all(servers.map((server, index) => new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(ports[index], '127.0.0.1', resolve)
      })))
      record('start')
    },
    async stop() {
      await Promise.all(servers.map((server) => new Promise<void>((resolve, reject) => {
        if (!server.listening) return resolve()
        server.close((error) => error ? reject(error) : resolve())
      })))
      record('stop')
    },
  }
})

export default defineConfig({ chains: { local: { factory: chain } } })
