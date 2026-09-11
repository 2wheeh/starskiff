import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { OptionalInstanceSource } from '../source.js'

/** Official Sei v6.6.3 image (linux/amd64 and linux/arm64). */
export const SEID_DEFAULT_IMAGE =
  'ghcr.io/sei-protocol/sei@sha256:39950e6961be44589bb488bb4e10cbd955967fd88672da47ea1ccf7ebf79d1de'

export type SeidParameters = Omit<CosmosChainParameters, 'image'> & OptionalInstanceSource & {
  /** EVM HTTP JSON-RPC port. @default 8545 */
  evmPort?: number
  patchGenesis?: (genesis: Genesis) => Genesis
}

/** An ephemeral Sei chain using native Cosmos secp256k1 accounts. */
export const seid = Instance.define((parameters?: SeidParameters) => {
  const params = parameters ?? {}
  const { binary = 'seid', evmPort = 8545, patchGenesis: userPatch, ...rest } = params
  if (['pacific-1', 'atlantic-2', 'arctic-1'].includes(rest.chainId ?? '')) {
    throw new Error('Sei embeds public-network genesis for this chainId. Use a local chain ID such as starskiff-sei-1.')
  }
  const base = cosmosBase({
    name: 'seid', binary, chainId: 'starskiff-sei-1', denom: 'usei', prefix: 'sei', ...rest,
    image: resolveInstanceImage('seid', params, SEID_DEFAULT_IMAGE),
    genesisCommand: [],
    extraConfigToml: { mode: 'validator', 'p2p.bootstrap-peers': '' },
    extraPorts: [evmPort],
    extraAppToml: { 'evm.http_enabled': 'true', 'evm.http_port': String(evmPort), 'evm.ws_enabled': 'false' },
    extraReadinessCheck: async () => {
      try {
        const response = await fetch(`http://localhost:${evmPort}`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'eth_blockNumber', params: [] }),
        })
        const data = await response.json() as { result?: string }
        return response.ok && typeof data.result === 'string'
      } catch { return false }
    },
    patchGenesis(genesis) {
      const staking = genesis.app_state.staking as { params: { bond_denom: string; max_voting_power_ratio: string } }
      staking.params.max_voting_power_ratio = '1.000000000000000000'
      return userPatch ? userPatch(genesis) : genesis
    },
    finalizeGenesis(genesis) {
      // Sei's Tendermint fork selects its initial consensus participants from
      // this top-level list; collect-gentxs leaves it empty.
      const genutil = genesis.app_state.genutil as {
        gen_txs: { body: { messages: { pubkey: { key: string }; value: { amount: string }; description: { moniker: string } }[] } }[]
      }
      return {
        ...genesis,
        validators: genutil.gen_txs.flatMap(tx => tx.body.messages.map(msg => ({
          pub_key: { type: 'tendermint/PubKeyEd25519', value: msg.pubkey.key },
          power: (BigInt(msg.value.amount) / 1_000_000n).toString(), name: msg.description.moniker,
        }))),
      }
    },
  })
  return { ...base, evmPort, get evmUrl() { return `http://localhost:${evmPort}` } }
})
