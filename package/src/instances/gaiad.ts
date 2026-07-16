import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

export type GaiadParameters = CosmosChainParameters & {
  /**
   * Run from a local `gaiad` binary on `PATH`.
   * gaiad has no default image, so either this or `image` is required.
   * (When `image` is passed instead, the executable inside the image is
   * assumed to be named `gaiad`.)
   */
  binary?: string
}

/**
 * Defines a gaiad (Cosmos Hub) instance.
 *
 * Cosmos Hub chain with IBC and CosmWasm (v27+). Useful as an IBC counterparty chain.
 * Patches feemarket genesis to set fee_denom and zero gas prices for testing.
 *
 * gaiad has **no default image** — the official one lags mainnet — so the node
 * source must be injected: pass `image` (a container image ref) or `binary`
 * (a local executable on PATH). Constructing without either throws.
 *
 * @example
 * ```ts
 * const instance = Instance.gaiad({
 *   binary: 'gaiad', // or image: 'my-registry/gaia:v27.5.0'
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
  // No default image (the official one lags mainnet): image or binary required.
  const image = resolveInstanceImage('gaiad', params)
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
