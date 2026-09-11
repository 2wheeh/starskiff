import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { InstanceSource } from '../source.js'

export type CronosdParameters = Omit<CosmosEvmChainParameters, 'image' | 'activeStaticPrecompiles'> & InstanceSource & {
  patchGenesis?: (genesis: Genesis) => Genesis
}

/** Cronos EVM. Supply a Cronos v1.7.8 binary or an image containing cronosd. */
export const cronosd = Instance.define((parameters: CronosdParameters) => {
  const image = resolveInstanceImage('cronosd', parameters ?? {})
  const { binary = 'cronosd', denom = 'basecro', patchGenesis: userPatch, relayerHints, ...rest } = parameters
  return cosmosEvmBase({
    name: 'cronosd', binary, chainId: 'cronosmainnet_25-1', prefix: 'crc', denom,
    validatorBalance: '100000000000000000000000', validatorStake: '10000000000000000000000',
    ...rest,
    image,
    // Upstream always starts a websocket listener. Use an OS-assigned port
    // so concurrent host instances do not collide on 8546.
    extraAppToml: { 'json-rpc.ws-address': '127.0.0.1:0' },
    relayerHints: { pkTypeUrl: '/ethermint.crypto.v1.ethsecp256k1.PubKey', ...relayerHints },
    patchGenesis(genesis) {
      // Ethermint's base fee calculation requires a finite block gas limit.
      const doc = genesis as Genesis & { consensus: { params: { block: { max_gas: string } } } }
      doc.consensus.params.block.max_gas = '60000000'
      const evm = genesis.app_state.evm as { params: { evm_denom: string } }
      evm.params.evm_denom = denom
      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
