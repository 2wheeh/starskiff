import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Official MANTRA chain image, pinned to the version running on mainnet
 * (`mantra-1`). Multi-arch (amd64 + arm64). Used unless the caller opts into
 * a binary.
 */
export const MANTRA_DEFAULT_IMAGE = 'ghcr.io/mantra-chain/mantrachain:v8.2.0'

export type MantraParameters = CosmosEvmChainParameters & {
  /**
   * Run from a local `mantrachaind` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "mantrachaind" (only when opted in)
   */
  binary?: string
  /** EIP-155 EVM chain id, exposed as `eth_chainId`. @default 5888 (mainnet) */
  evmChainId?: number
  /** Chain-specific genesis patch, chained after mantra's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * Defines a mantra (MANTRA chain) instance.
 *
 * MANTRA is a cosmos/evm chain (EVM live on mainnet since v8) with CosmWasm on
 * top: SDK + EVM + wasm + tokenfactory. Its 18-decimal native denom is
 * `amantra` with the `mantra` bech32 prefix. Defaults mirror mainnet: cosmos
 * chain id `mantra-1`, `eth_chainId` 5888.
 *
 * MANTRA publishes an official multi-arch image, so this instance is
 * container-first on {@link MANTRA_DEFAULT_IMAGE}. Docker must be running.
 * As with every instance, pass `binary` to run a local executable, or `image`
 * to bind your own.
 *
 * @example
 * ```ts
 * const instance = Instance.mantra({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000amantra' }],
 * })
 * await instance.start()
 * // eth_chainId → 5888
 * await instance.stop()
 * ```
 */
export const mantra = Instance.define((parameters?: MantraParameters) => {
  const params = parameters || {}
  const {
    binary = 'mantrachaind',
    chainId = 'mantra-1',
    denom = 'amantra',
    prefix = 'mantra',
    // 18-decimal denom needs large amounts (power reduction 1e18).
    validatorBalance = '100000000000000000000000', // 1e23
    validatorStake = '10000000000000000000000',    // 1e22
    evmChainId = 5888,
    patchGenesis: userPatch,
    ...rest
  } = params

  const image = resolveInstanceImage('mantra', params, MANTRA_DEFAULT_IMAGE)

  return cosmosEvmBase({
    binary, name: 'mantra', chainId, denom, prefix, validatorBalance, validatorStake, ...rest,
    image,
    // app.toml's compiled-in default is cosmos/evm's 262144; mirror mainnet.
    extraStartArgs: ['--evm.evm-chain-id', String(evmChainId)],
    patchGenesis: (genesis) => {
      // A fresh `mantrachaind init` writes cosmos/evm module defaults:
      // evm_denom `aatom` and no bank denom metadata. Point the EVM at the
      // native denom and provide the 18-decimal metadata it requires.
      const evm = (genesis.app_state as Record<string, unknown>).evm as
        | { params: { evm_denom?: string; extended_denom_options?: { extended_denom: string } } }
        | undefined
      if (evm?.params) {
        evm.params.evm_denom = denom
        if (evm.params.extended_denom_options) {
          evm.params.extended_denom_options.extended_denom = denom
        }
      }

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
