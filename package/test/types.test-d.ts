import {
  Instance,
  cosmosBase,
  cosmosEvmBase,
  defineConfig,
  type BinaryInstanceSource,
  type CosmosBaseParameters,
  type CosmosChainParameters,
  type CosmosEvmBaseParameters,
  type CosmosEvmChainParameters,
  type CosmosRuntimeOptions,
  type DefinedStarskiffConfig,
  type ImageInstanceSource,
  type InstanceSource,
  type MaroodParameters,
  type MaroodPrivacyZkArtifacts,
  type OptionalInstanceSource,
} from '../src/index.js'
import { expectTypeOf } from 'vitest'

// CosmosInstance extra fields should be inferred
const chain = Instance.wasmd({ chainId: 'test', prefix: 'wasm' })
expectTypeOf(chain.chainId).toBeString()
expectTypeOf(chain.prefix).toBeString()
expectTypeOf(chain.denom).toBeString()
expectTypeOf(chain.grpcPort).toBeNumber()
expectTypeOf(chain.apiPort).toBeNumber()

// Base Instance fields still work
expectTypeOf(chain.host).toBeString()
expectTypeOf(chain.port).toBeNumber()
expectTypeOf(chain.name).toBeString()
expectTypeOf(chain.start).toBeFunction()
expectTypeOf(chain.stop).toBeFunction()

// simd too
const simdChain = Instance.simd({ chainId: 'test' })
expectTypeOf(simdChain.chainId).toBeString()

const xrplevmChain = Instance.xrplevm({ chainId: 'custom-xrplevm', evmChainId: 1440001 })
expectTypeOf(xrplevmChain.evmChainId).toBeNumber()
expectTypeOf(simdChain.grpcPort).toBeNumber()

expectTypeOf<CosmosEvmBaseParameters['evmChainId']>().toEqualTypeOf<number | undefined>()
expectTypeOf<'evmChainId' extends keyof CosmosEvmChainParameters ? true : false>().toEqualTypeOf<false>()
expectTypeOf<'evmChainId' extends keyof MaroodParameters ? true : false>().toEqualTypeOf<false>()
expectTypeOf<CosmosBaseParameters['runtime']>().toEqualTypeOf<CosmosRuntimeOptions | undefined>()
expectTypeOf<CosmosEvmBaseParameters['runtime']>().toEqualTypeOf<CosmosRuntimeOptions | undefined>()
expectTypeOf<'runtime' extends keyof MaroodParameters ? true : false>().toEqualTypeOf<false>()

const privacyZkArtifacts: MaroodPrivacyZkArtifacts = {
  kind: 'generated-test',
  directory: '/tmp/maroo-privacy-zk-test-artifacts',
}
const maroodChain = Instance.marood({ image: 'maroo:local', privacyZkArtifacts })
expectTypeOf(maroodChain.evmUrl).toBeString()

// High-level instance sources are mutually exclusive. Image-backed wrappers
// can use their default, or accept exactly one explicit override.
const imageSource: ImageInstanceSource = { image: 'registry/chain:v1' }
const binarySource: BinaryInstanceSource = { binary: 'chaind' }
const requiredImageSource: InstanceSource = imageSource
const requiredBinarySource: InstanceSource = binarySource
const inheritedSource: OptionalInstanceSource = {}
expectTypeOf(requiredImageSource.image).toBeString()
expectTypeOf(requiredBinarySource.binary).toBeString()
expectTypeOf(inheritedSource).toMatchTypeOf<OptionalInstanceSource>()

Instance.simd()
Instance.simd({})
Instance.simd({ image: 'registry/simd:v1' })
Instance.simd({ binary: 'simd' })
Instance.wasmd({ image: 'registry/wasmd:v1' })
Instance.gaiad({ binary: 'gaiad' })
Instance.xplad({ image: 'registry/xplad:v1' })
Instance.xrplevm({ binary: 'exrpd' })
Instance.mantra({ image: 'registry/mantra:v1' })
Instance.evmd({ binary: 'evmd' })

// @ts-expect-error A source is required when there is no built-in default.
const missingRequiredSource: InstanceSource = {}
// @ts-expect-error An image and binary cannot select two runtimes at once.
const conflictingSource: InstanceSource = { image: 'registry/chain:v1', binary: 'chaind' }
// @ts-expect-error Default-image wrappers still reject conflicting overrides.
Instance.simd({ image: 'registry/simd:v1', binary: 'simd' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.wasmd({ image: 'registry/wasmd:v1', binary: 'wasmd' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.gaiad({ image: 'registry/gaiad:v1', binary: 'gaiad' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.xplad({ image: 'registry/xplad:v1', binary: 'xplad' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.xrplevm({ image: 'registry/xrplevm:v1', binary: 'exrpd' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.mantra({ image: 'registry/mantra:v1', binary: 'mantrachaind' })
// @ts-expect-error Every shipped default-image wrapper uses the same exclusive source contract.
Instance.evmd({ image: 'registry/evmd:v1', binary: 'evmd' })

Instance.marood({ image: 'registry/marood:v1' })
Instance.marood({ binary: 'marood', network: 'mainnet' }, { timeout: 30_000 })
// @ts-expect-error marood has no default source.
Instance.marood()
// @ts-expect-error Other marood parameters do not replace its required source.
Instance.marood({ network: 'testnet' })
// @ts-expect-error marood also rejects conflicting sources.
Instance.marood({ image: 'registry/marood:v1', binary: 'marood' })

// Low-level builders keep `binary` as the executable name even for an image,
// so custom definitions can continue supplying both fields internally.
const customCosmos = cosmosBase({
  name: 'custom-cosmos',
  binary: 'customd',
  image: 'registry/customd:v1',
})
const customEvm = cosmosEvmBase({
  name: 'custom-evm',
  binary: 'customevmd',
  image: 'registry/customevmd:v1',
})
expectTypeOf(customCosmos.rpcUrl).toBeString()
expectTypeOf(customEvm.evmUrl).toBeString()

type CustomChainParameters =
  & Omit<CosmosChainParameters, 'image'>
  & OptionalInstanceSource
const customChain = Instance.define((parameters?: CustomChainParameters) => {
  const { binary = 'customd', image, ...rest } = parameters || {}
  return cosmosBase({ binary, image, name: 'custom', ...rest })
})
customChain()
customChain({ image: 'registry/customd:v1' })
customChain({ binary: 'customd' })
// @ts-expect-error Custom wrappers can reuse the exclusive public source type.
customChain({ image: 'registry/customd:v1', binary: 'customd' })

// Plain define without extras — no extra fields
const plain = Instance.define(() => ({
  name: 'plain',
  host: 'localhost',
  port: 3000,
  async start() {},
  async stop() {},
}))()

expectTypeOf(plain.host).toBeString()
expectTypeOf(plain.start).toBeFunction()

const managedFieldsWin = Instance.define(() => ({
  name: 'managed-fields-win',
  host: 'localhost',
  port: 3000,
  status: 'definition-status' as const,
  async start() {},
  async stop() {},
}))()
expectTypeOf(managedFieldsWin.status).toEqualTypeOf<Instance.InstanceStatus>()

const optionShapedFactory = Instance.define((parameters?: { timeout?: number }) => ({
  name: 'option-shaped-parameters',
  host: 'localhost',
  port: parameters?.timeout ?? 3000,
  async start() {},
  async stop() {},
}))
expectTypeOf(optionShapedFactory({ timeout: 4000 }).port).toBeNumber()
expectTypeOf(optionShapedFactory(undefined, { timeout: 1000 }).port).toBeNumber()

const parameterlessFactory = Instance.define(() => ({
  name: 'parameterless',
  host: 'localhost',
  port: 3000,
  async start() {},
  async stop() {},
}))
expectTypeOf(parameterlessFactory(undefined, { messageBuffer: 1 }).port).toBeNumber()
// @ts-expect-error Parameterless definitions receive lifecycle options in the second argument.
parameterlessFactory({ timeout: 1000 })

const requiredFactory = Instance.define((parameters: { port: number }) => ({
  name: 'required-parameters',
  host: 'localhost',
  port: parameters.port,
  async start() {},
  async stop() {},
}))
// @ts-expect-error Required definition parameters cannot be omitted.
requiredFactory()

// Declarative configs preserve factory parameter requirements and use their
// chain-name keys as the Hermes channel vocabulary.
const declarativeConfig = defineConfig({
  chains: {
    wasm: {
      factory: Instance.wasmd,
      parameters: { chainId: 'wasm-test-1' },
      options: { timeout: 120_000 },
    },
    maroo: {
      factory: Instance.marood,
      parameters: { image: 'registry/marood:v1', network: 'testnet' },
    },
  },
  relayers: {
    hermes: {
      mnemonic: 'test mnemonic',
      channels: [['wasm', 'maroo']],
    },
  },
})
const publicDefinedConfig: DefinedStarskiffConfig = declarativeConfig
void publicDefinedConfig
expectTypeOf(declarativeConfig.relayers[0].channels[0]).toEqualTypeOf<
  readonly ['wasm' | 'maroo', 'wasm' | 'maroo']
>()

defineConfig({ chains: { wasm: { factory: Instance.wasmd } } })

const configuredWasm = declarativeConfig.chains.find((chain) => chain.name === 'wasm')!
expectTypeOf(configuredWasm.factory).toEqualTypeOf<typeof Instance.wasmd>()
expectTypeOf(configuredWasm.options).toEqualTypeOf<Readonly<Instance.InstanceOptions>>()

defineConfig({
  chains: {
    // @ts-expect-error marood's required source parameters remain required in config.
    maroo: { factory: Instance.marood },
  },
})

defineConfig({
  chains: {
    a: { factory: Instance.wasmd },
    b: { factory: Instance.simd },
  },
  relayers: {
    hermes: {
      mnemonic: 'test mnemonic',
      // @ts-expect-error Channels can only reference names in the chain record.
      channels: [['a', 'missing']],
    },
  },
})
