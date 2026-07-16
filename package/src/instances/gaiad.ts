import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Official Cosmos Hub image, pinned to the version running on mainnet
 * (`cosmoshub-4`). Used unless the caller opts into a binary.
 */
export const GAIAD_DEFAULT_IMAGE = 'ghcr.io/cosmos/gaia:v27.5.0'

export type GaiadParameters = CosmosChainParameters & {
  /**
   * Run from a local `gaiad` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "gaiad" (only when opted in)
   */
  binary?: string
}

/**
 * Defines a gaiad (Cosmos Hub) instance.
 *
 * Cosmos Hub chain with IBC and CosmWasm (v27+). Useful as an IBC counterparty chain.
 * Patches feemarket genesis to set fee_denom and zero gas prices for testing.
 *
 * The Hub publishes an official image that tracks mainnet, so this instance is
 * container-first: it runs {@link GAIAD_DEFAULT_IMAGE} out of the box — Docker
 * must be running. As with every instance, pass `binary` to run a local
 * executable instead, or `image` to bind your own.
 *
 * @example
 * ```ts
 * const instance = Instance.gaiad({
 *   chainId: 'cosmoshub-test-1',
 *   denom: 'uatom',
 *   accounts: [{ mnemonic: '...', coins: '1000000000uatom' }],
 * })
 * await instance.start()
 * await instance.stop()
 * ```
 */
export const gaiad = Instance.define((parameters?: GaiadParameters) => {
  const params = parameters || {}
  const { binary = 'gaiad', denom = 'stake', ...rest } = params
  const image = resolveInstanceImage('gaiad', params, GAIAD_DEFAULT_IMAGE)
  return cosmosBase({
    binary, name: 'gaiad', denom, ...rest, image,
    patchGenesis: (genesis) => {
      if (genesis.app_state.feemarket) {
        const fm = genesis.app_state.feemarket
        fm.params.fee_denom = denom
        fm.params.min_base_gas_price = '0.001000000000000000'
        fm.state.base_gas_price = '0.001000000000000000'
      }
      return genesis
    },
  })
})
