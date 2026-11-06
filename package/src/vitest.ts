import type { DefinedStarskiffConfig } from './config.js'
import type { CosmosInstance } from './cosmos.js'
import type { Instance } from './Instance.js'
import { PORT_KEYS, reservePort } from './ports.js'

type ChainContext = Pick<CosmosInstance, 'chainId' | 'denom' | 'prefix' | 'rpcUrl' | 'grpcUrl' | 'apiUrl'> & {
  /** Present for Cosmos EVM chains. */
  evmUrl?: string
}

/** Serializable topology available to test workers through `inject('starskiff')`. */
export type StarskiffContext<Config extends DefinedStarskiffConfig = DefinedStarskiffConfig> = {
  chains: Record<Config['chains'][number]['name'], ChainContext>
  relayers: {
    name: 'hermes'
    /** Configured chain-name pairs, not the IBC channel IDs created by Hermes. */
    channels: readonly (readonly [Config['chains'][number]['name'], Config['chains'][number]['name']])[]
  }[]
}

const CHAIN_PORT_KEYS = [...PORT_KEYS, 'evmPort'] as const

function chainParameters(value: unknown, name: string): Record<string, unknown> {
  if (value === undefined) return {}
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Chain "${name}" must use object parameters for automatic port allocation.`)
  }
  return { ...value }
}

function configuredPort(value: unknown, name: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 65_535) {
    throw new TypeError(`${name} must be an integer between 1 and 65535.`)
  }
  return value
}

function chainContext(instance: CosmosInstance): ChainContext {
  return {
    chainId: instance.chainId,
    denom: instance.denom,
    prefix: instance.prefix,
    rpcUrl: instance.rpcUrl,
    grpcUrl: instance.grpcUrl,
    apiUrl: instance.apiUrl,
    ...('evmUrl' in instance && typeof instance.evmUrl === 'string' ? { evmUrl: instance.evmUrl } : {}),
  }
}

/**
 * Creates a Vitest global setup that owns one topology per test project.
 * Export the returned function from the file named by Vitest's `globalSetup`.
 * Import your `starskiff.config.ts` directly; no config file discovery is performed.
 *
 * Missing Cosmos ports and the Hermes telemetry port are allocated automatically.
 * Custom factories must accept object parameters and honor the Cosmos port fields.
 * Instances persist across watch reruns and stop when Vitest tears down the project.
 */
export function createGlobalSetup<Config extends DefinedStarskiffConfig>(config: Config) {
  return async function setup(project: {
    provide(key: 'starskiff', value: StarskiffContext<Config>): void
  }): Promise<() => Promise<void>> {
    const instances: Instance[] = []
    const reservations: Awaited<ReturnType<typeof reservePort>>[] = []
    let teardownOperation: Promise<void> | undefined

    const teardown = () => teardownOperation ??= (async () => {
      const errors: unknown[] = []
      // Relayers must finish stopping before their chains are stopped. Continue
      // cleaning up even when one stop fails, including a partially started node.
      for (const instance of [...instances].reverse()) {
        try { await instance.stop() } catch (error) { errors.push(error) }
      }
      for (const reservation of reservations) {
        try { await reservation.release() } catch (error) { errors.push(error) }
      }
      if (errors.length) throw new AggregateError(errors, 'Starskiff teardown failed.')
    })()

    try {
      const declarations = config.chains.map((chain) => ({
        ...chain,
        parameters: chainParameters(chain.parameters, chain.name),
      }))
      const excludedPorts = new Set<number>()
      for (const chain of declarations) {
        for (const key of CHAIN_PORT_KEYS) {
          const port = configuredPort(chain.parameters[key], `Chain "${chain.name}" ${key}`)
          if (port !== undefined) excludedPorts.add(port)
        }
      }
      for (const relayer of config.relayers) {
        const port = configuredPort(relayer.parameters.telemetryPort, 'Hermes telemetryPort')
        if (port !== undefined) excludedPorts.add(port)
      }

      const allocatePort = async () => {
        const reservation = await reservePort(excludedPorts)
        reservations.push(reservation)
        excludedPorts.add(reservation.port)
        return reservation
      }

      const chains = new Map<string, CosmosInstance>()
      for (const chain of declarations) {
        for (const key of CHAIN_PORT_KEYS) {
          chain.parameters[key] ??= (await allocatePort()).port
        }
        const instance = chain.factory(chain.parameters, chain.options)
        instances.push(instance)
        chains.set(chain.name, instance)
      }

      const relayers = []
      for (const relayer of config.relayers) {
        const channels = relayer.channels.map(([a, b]): [CosmosInstance, CosmosInstance] => {
          const chainA = chains.get(a)
          const chainB = chains.get(b)
          if (!chainA || !chainB) throw new Error(`Hermes references an unknown chain: ${a}, ${b}.`)
          return [chainA, chainB]
        })
        const chainIds = new Map<string, CosmosInstance>()
        for (const chain of channels.flat()) {
          const previous = chainIds.get(chain.chainId)
          if (previous && previous !== chain) {
            throw new Error(`Hermes chains share chainId "${chain.chainId}". Set distinct parameters.chainId values.`)
          }
          chainIds.set(chain.chainId, chain)
        }
        relayers.push({ declaration: relayer, channels })
      }

      // Keep the whole topology's automatic ports reserved during construction,
      // then hand them to the nodes. External processes can still race this handoff.
      await Promise.all(reservations.map((reservation) => reservation.release()))
      const starts = await Promise.allSettled([...chains.values()].map((chain) =>
        Promise.resolve().then(() => chain.start()),
      ))
      const failures = starts.filter((result) => result.status === 'rejected')
      if (failures.length === 1) throw failures[0].reason
      if (failures.length > 1) {
        throw new AggregateError(failures.map((failure) => failure.reason), 'Starskiff chains failed to start.')
      }

      for (const { declaration, channels } of relayers) {
        const reservation = declaration.parameters.telemetryPort === undefined ? await allocatePort() : undefined
        const instance = declaration.factory({
          ...declaration.parameters,
          telemetryPort: declaration.parameters.telemetryPort ?? reservation!.port,
          channels,
        }, declaration.options)
        instances.push(instance)
        await reservation?.release()
        await instance.start()
      }

      const context: StarskiffContext = {
        chains: Object.fromEntries([...chains].map(([name, instance]) => [name, chainContext(instance)])),
        relayers: config.relayers.map((relayer) => ({
          name: relayer.name,
          channels: relayer.channels.map(([a, b]) => [a, b] as const),
        })),
      }
      project.provide('starskiff', context)
      return teardown
    } catch (error) {
      try {
        await teardown()
      } catch (cleanupError) {
        throw new AggregateError([error, cleanupError], 'Starskiff setup and rollback failed.', { cause: error })
      }
      throw error
    }
  }
}
