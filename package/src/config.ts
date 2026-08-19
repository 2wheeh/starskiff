import type { CosmosInstance } from './cosmos.js'
import type { InstanceOptions } from './Instance.js'
import { hermes, type HermesParameters } from './instances/hermes.js'

/** An instance factory that produces a Cosmos chain. */
type ChainInstanceFactory = (...args: any[]) => CosmosInstance

type FactoryParameters<F extends ChainInstanceFactory> = Parameters<F>[0]

/** A declarative chain entry accepted by {@link defineConfig}. */
type ChainConfig<F extends ChainInstanceFactory = ChainInstanceFactory> = {
  /** Existing starskiff or custom Cosmos instance factory. */
  factory: F
  /** Lifecycle options passed as the factory's second argument. */
  options?: InstanceOptions
} & (undefined extends FactoryParameters<F>
  ? { /** Parameters passed to the instance factory. */ parameters?: FactoryParameters<F> }
  : { /** Parameters passed to the instance factory. */ parameters: FactoryParameters<F> })

type ChainFactories = Record<string, ChainInstanceFactory>

type ChainConfigs<Factories extends ChainFactories> = {
  [Name in keyof Factories]: ChainConfig<Factories[Name]>
}

type ChainName<Factories extends ChainFactories> = Extract<keyof Factories, string>

/** A pair of configured chain names connected by Hermes. */
type ChannelConfig<Name extends string = string> = readonly [Name, Name]

/** Declarative Hermes parameters, with channels referring to configured names. */
type HermesConfig<Name extends string = string> =
  & Omit<HermesParameters, 'channels'>
  & {
    channels: readonly ChannelConfig<Name>[]
    /** Lifecycle options passed to `Instance.hermes()`. */
    options?: InstanceOptions
  }

/** Input accepted by {@link defineConfig}. */
export type StarskiffConfig<Factories extends ChainFactories = ChainFactories> = {
  /** Named chain declarations. Names are used by relayer channel pairs. */
  chains: ChainConfigs<Factories>
  /** Relayers to create after their referenced chains are running. */
  relayers?: {
    hermes?: HermesConfig<ChainName<Factories>>
  }
}

/** A normalized chain declaration returned by {@link defineConfig}. */
type DefinedChainConfig<
  Name extends string = string,
  F extends ChainInstanceFactory = ChainInstanceFactory,
> = {
  name: Name
  factory: F
  parameters: FactoryParameters<F> | undefined
  options: Readonly<InstanceOptions>
}

type DefinedChainConfigs<Factories extends ChainFactories> = {
  [Name in keyof Factories]: DefinedChainConfig<Extract<Name, string>, Factories[Name]>
}[keyof Factories]

/** A normalized Hermes declaration returned by {@link defineConfig}. */
type DefinedHermesConfig<Name extends string = string> = {
  name: 'hermes'
  factory: typeof hermes
  channels: readonly ChannelConfig<Name>[]
  parameters: Readonly<Omit<HermesParameters, 'channels'>>
  options: Readonly<InstanceOptions>
}

/** Stable, normalized shape consumed by future test-runner integrations. */
export type DefinedStarskiffConfig = {
  chains: readonly DefinedChainConfig[]
  relayers: readonly DefinedHermesConfig[]
}

type InferredDefinedStarskiffConfig<Factories extends ChainFactories> = {
  chains: readonly DefinedChainConfigs<Factories>[]
  relayers: readonly DefinedHermesConfig<ChainName<Factories>>[]
}

function assertRecord(value: unknown, path: string): asserts value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${path} must be an object.`)
  }
}

/**
 * Defines and validates a declarative Starskiff topology.
 *
 * This function does not discover files, allocate ports, or start instances.
 * It returns a normalized description for a runner integration to consume.
 */
export function defineConfig<const Factories extends ChainFactories>(
  config: StarskiffConfig<Factories>,
): InferredDefinedStarskiffConfig<Factories> {
  assertRecord(config, 'config')
  assertRecord(config.chains, 'config.chains')

  const chainNames = Object.keys(config.chains)
  if (chainNames.length === 0) {
    throw new TypeError('config.chains must contain at least one chain.')
  }

  const names = new Set(chainNames)
  const chains = Object.entries(config.chains).map(([name, declaration]) => {
    if (name.trim() === '') {
      throw new TypeError('config.chains cannot contain an empty name.')
    }
    assertRecord(declaration, `config.chains.${name}`)
    if (typeof declaration.factory !== 'function') {
      throw new TypeError(`config.chains.${name}.factory must be a function.`)
    }
    if (declaration.options !== undefined) {
      assertRecord(declaration.options, `config.chains.${name}.options`)
    }

    return {
      name,
      factory: declaration.factory,
      parameters: declaration.parameters,
      options: { ...(declaration.options ?? {}) },
    }
  }) as unknown as DefinedChainConfigs<Factories>[]

  const relayers: DefinedHermesConfig<ChainName<Factories>>[] = []
  if (config.relayers !== undefined) {
    assertRecord(config.relayers, 'config.relayers')
    const unsupported = Object.keys(config.relayers).filter((name) => name !== 'hermes')
    if (unsupported.length > 0) {
      throw new TypeError(`config.relayers contains an unsupported relayer: ${unsupported[0]}.`)
    }

    const declaration = config.relayers.hermes
    if (declaration !== undefined) {
      assertRecord(declaration, 'config.relayers.hermes')
      if (typeof declaration.mnemonic !== 'string' || declaration.mnemonic.trim() === '') {
        throw new TypeError('config.relayers.hermes.mnemonic must be a non-empty string.')
      }
      if (!Array.isArray(declaration.channels) || declaration.channels.length === 0) {
        throw new TypeError('config.relayers.hermes.channels must contain at least one pair.')
      }
      if (declaration.options !== undefined) {
        assertRecord(declaration.options, 'config.relayers.hermes.options')
      }

      const channels = declaration.channels.map((channel, index) => {
        if (!Array.isArray(channel) || channel.length !== 2) {
          throw new TypeError(`config.relayers.hermes.channels[${index}] must be a chain-name pair.`)
        }
        const [a, b] = channel
        if (typeof a !== 'string' || !names.has(a)) {
          throw new TypeError(`config.relayers.hermes.channels[${index}] references unknown chain "${String(a)}".`)
        }
        if (typeof b !== 'string' || !names.has(b)) {
          throw new TypeError(`config.relayers.hermes.channels[${index}] references unknown chain "${String(b)}".`)
        }
        return [a, b] as unknown as ChannelConfig<ChainName<Factories>>
      })

      const { channels: _channels, options, ...parameters } = declaration
      relayers.push({
        name: 'hermes',
        factory: hermes,
        channels,
        parameters,
        options: { ...(options ?? {}) },
      })
    }
  }

  return { chains, relayers }
}
