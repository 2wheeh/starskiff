import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'

/**
 * Default active static precompiles for xplad.
 * Mirrors `@xpla/evm` `PRECOMPILE_ADDRESSES` (v1.9.0), sorted ascending as
 * required by cosmos-evm genesis validation. Frozen by chain consensus.
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

export type XpladParameters = CosmosEvmChainParameters & {
  /** Path to the xplad binary. @default "xplad" */
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
 * @example
 * ```ts
 * const instance = Instance.xplad({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000axpla' }],
 * })
 * await instance.start()
 * await instance.stop()
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

  // Preserve the three-state semantics of `activeStaticPrecompiles`:
  // omitted → xpla default; explicit `undefined` → pass through (binary default);
  // `[]` → disable all; `[...]` → overwrite.
  const activeStaticPrecompiles =
    'activeStaticPrecompiles' in params ? params.activeStaticPrecompiles : XPLA_DEFAULT_PRECOMPILES

  return cosmosEvmBase({
    binary, name: 'xpla', chainId, denom, prefix, validatorBalance, validatorStake, ...rest,
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
