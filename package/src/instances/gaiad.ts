import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'

export type GaiadParameters = CosmosChainParameters & {
  /** Path to the gaiad binary. @default "gaiad" */
  binary?: string
}

/**
 * Defines a gaiad (Cosmos Hub) instance.
 *
 * Cosmos Hub chain with IBC and CosmWasm (v27+). Useful as an IBC counterparty chain.
 * Patches feemarket genesis to set fee_denom and zero gas prices for testing.
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
  const { binary = 'gaiad', denom = 'stake', ...rest } = parameters || {}
  return cosmosBase({
    binary, name: 'gaiad', denom, ...rest,
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
