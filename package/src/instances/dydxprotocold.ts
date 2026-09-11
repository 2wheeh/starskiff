import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { InstanceSource } from '../source.js'

export type DydxprotocoldParameters = Omit<CosmosChainParameters, 'image'> & InstanceSource & {
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * dYdX v4 consensus and SDK APIs. Supply a v9.6.4 binary or image.
 * External price, bridge, liquidation and oracle daemons are disabled.
 */
export const dydxprotocold = Instance.define((parameters: DydxprotocoldParameters) => {
  const image = resolveInstanceImage('dydxprotocold', parameters ?? {})
  const { binary = 'dydxprotocold', denom = 'adydx', patchGenesis: userPatch, ...rest } = parameters
  return cosmosBase({
    name: 'dydxprotocold', binary, chainId: 'dydx-mainnet-1', prefix: 'dydx', denom,
    validatorBalance: '100000000000000000000000', validatorStake: '10000000000000000000000',
    ...rest,
    image,
    genesisCommand: [],
    patchGenesis(genesis) {
      const expedited = genesis.app_state.gov?.params?.expedited_min_deposit?.[0]
      if (expedited) expedited.denom = denom
      const rewards = genesis.app_state.rewards as { params: { denom: string } }
      rewards.params.denom = denom
      const vest = genesis.app_state.vest as { vest_entries: { denom: string }[] }
      for (const entry of vest.vest_entries) entry.denom = denom
      // init supplies BTC/ETH prices but omits the Slinky market map they
      // reference. Seed that map while leaving external oracle polling off.
      const prices = genesis.app_state.prices as { market_params: { pair: string; exponent: number }[] }
      const marketmap = genesis.app_state.marketmap as { market_map: { markets: Record<string, unknown> } }
      for (const market of prices.market_params) {
        const [base, quote] = market.pair.split('-')
        marketmap.market_map.markets[`${base}/${quote}`] = {
          ticker: { currency_pair: { Base: base, Quote: quote }, decimals: -market.exponent, min_provider_count: 1, enabled: true },
          provider_configs: [{ name: 'coinbase_ws', off_chain_ticker: market.pair }],
        }
      }
      return userPatch ? userPatch(genesis) : genesis
    },
    extraStartArgs: (homeDir) => [
      '--price-daemon-enabled=false', '--bridge-daemon-enabled=false',
      '--liquidation-daemon-enabled=false', '--panic-on-daemon-failure-enabled=false',
      '--oracle.enabled=false',
      '--unix-socket-address', `${homeDir}/daemons.sock`,
    ],
  })
})
