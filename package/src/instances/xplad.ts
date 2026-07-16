import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Default active static precompiles for xplad.
 * Mirrors `@xpla/evm` `PRECOMPILE_ADDRESSES` (v1.9.0; unchanged in v1.10.0 —
 * the xpladev/evm diff between the two touches only mempool/server), sorted
 * ascending as required by cosmos-evm genesis validation. Frozen by chain
 * consensus.
 */
export const XPLA_DEFAULT_PRECOMPILES: readonly string[] = [
  '0x0000000000000000000000000000000000000100', // P256
  '0x0000000000000000000000000000000000000400', // Bech32
  '0x0000000000000000000000000000000000000800', // Staking
  '0x0000000000000000000000000000000000000801', // Distribution
  '0x0000000000000000000000000000000000000805', // Gov
  '0x0000000000000000000000000000000000000806', // Slashing
  '0x1000000000000000000000000000000000000001', // Bank
  '0x1000000000000000000000000000000000000004', // Wasm
  '0x1000000000000000000000000000000000000005', // Auth
  '0x1000000000000000000000000000000000000044', // WasmDelegate
]

/**
 * Official XPLA image, pinned to the version running on XPLA mainnet
 * (`dimension_1-1`). Used unless the caller opts into a binary.
 */
export const XPLA_DEFAULT_IMAGE = 'ghcr.io/xpladev/xpla:v1.10.0'

export type XpladParameters = CosmosEvmChainParameters & {
  /**
   * Run from a local `xplad` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "xplad" (only when opted in)
   */
  binary?: string
  /** Chain-specific genesis patch, chained after xplad's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * Defines an xplad (XPLA) instance.
 *
 * XPLA is a Cosmos SDK chain with EVM and CosmWasm support.
 * The native denom uses 18 decimals (e.g. axpla), which requires
 * larger validator stake/balance than the cosmosBase defaults.
 *
 * XPLA publishes an official image, so this instance is container-first: it
 * runs {@link XPLA_DEFAULT_IMAGE} out of the box — no Go toolchain, no manual
 * build, and the node is the exact artifact the network ships. Docker must be
 * running. The node still runs as a plain child process under starskiff's own
 * lifecycle; the image is only where the node comes from.
 *
 * @example
 * ```ts
 * // container (default)
 * const instance = Instance.xplad({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000axpla' }],
 * })
 *
 * // escape hatches
 * Instance.xplad({ image: 'my-registry/xpla:custom' }) // bind your own image
 * Instance.xplad({ binary: 'xplad' })                  // local binary on PATH
 * ```
 */
export const xplad = Instance.define((parameters?: XpladParameters) => {
  const params = parameters || {}
  const {
    binary = 'xplad',
    chainId = 'dimension_37-1',
    denom = 'axpla',
    prefix = 'xpla',
    // 18-decimal denom needs large amounts: xpla DefaultPowerReduction ~ 1.37e12
    validatorBalance = '100000000000000000000000', // 1e23
    validatorStake = '10000000000000000000000',    // 1e22
    patchGenesis: userPatch,
    ...rest
  } = params

  // Container-first, with both escape hatches: an explicit `image` selects the
  // container runtime, naming a `binary` opts out of docker. `binary` still
  // carries the in-image executable name for the container runtime.
  const image = resolveInstanceImage('xplad', params, XPLA_DEFAULT_IMAGE)

  // Preserve the three-state semantics of `activeStaticPrecompiles`:
  // omitted → xpla default; explicit `undefined` → pass through (binary default);
  // `[]` → disable all; `[...]` → overwrite.
  const activeStaticPrecompiles =
    'activeStaticPrecompiles' in params ? params.activeStaticPrecompiles : XPLA_DEFAULT_PRECOMPILES

  return cosmosEvmBase({
    binary, name: 'xpla', chainId, denom, prefix, validatorBalance, validatorStake, ...rest,
    image,
    activeStaticPrecompiles,
    patchGenesis: (genesis) => {
      // xplad requires evm_denom and bank.denom_metadata to match the native denom
      const evm = (genesis.app_state as Record<string, unknown>).evm as
        | { params: { evm_denom: string; extended_denom_options?: { extended_denom: string } } }
        | undefined
      if (evm?.params) {
        evm.params.evm_denom = denom
        if (evm.params.extended_denom_options) {
          evm.params.extended_denom_options.extended_denom = denom
        }
      }

      // bank denom_metadata is required by EVM coin info init
      const display = denom.replace(/^a/, '')
      if (genesis.app_state.bank) {
        // If denom has no leading `a` (e.g. plain "stake"), display === denom
        // — a second denom_units entry would duplicate the denom and fail
        // genesis validation, so collapse to a single unit in that case.
        const denomUnits = display === denom
          ? [{ denom, exponent: 0, aliases: [] }]
          : [
              { denom, exponent: 0, aliases: [] },
              { denom: display, exponent: 18, aliases: [] },
            ]
        genesis.app_state.bank.denom_metadata = [{
          description: 'The native token.',
          denom_units: denomUnits,
          base: denom,
          display,
          name: display.toUpperCase(),
          symbol: display.toUpperCase(),
          uri: '',
          uri_hash: '',
        }]
      }

      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
