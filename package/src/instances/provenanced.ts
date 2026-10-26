import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { OptionalInstanceSource } from '../source.js'

/** Official Provenance v1.31.0 image (linux/amd64 and linux/arm64). */
export const PROVENANCED_DEFAULT_IMAGE =
  'provenanceio/provenance@sha256:c8d402757aa8e63ae0571da30ab422f2cd9eda4dd41878415cc997a4cbf709f0'

export type ProvenancedParameters = Omit<CosmosChainParameters, 'image'> & OptionalInstanceSource & {
  patchGenesis?: (genesis: Genesis) => Genesis
}

/** An ephemeral Provenance chain, with HASH denominated in nhash. */
export const provenanced = Instance.define((parameters?: ProvenancedParameters) => {
  const params = parameters ?? {}
  const { binary = 'provenanced', denom = 'nhash', patchGenesis: userPatch, ...rest } = params
  return cosmosBase({
    name: 'provenanced', binary,
    chainId: 'pio-mainnet-1', denom, prefix: 'pb',
    validatorBalance: '100000000000000', validatorStake: '10000000000000',
    relayerHints: { addressDerivation: 'cosmos', hdPath: "m/44'/505'/0'/0/0" },
    ...rest,
    image: resolveInstanceImage('provenanced', params, PROVENANCED_DEFAULT_IMAGE),
    patchGenesis(genesis) {
      // init mixes Provenance's nhash deposit with the SDK's stake default
      // for expedited proposals. Keep the expedited deposit larger.
      const gov = genesis.app_state.gov?.params as {
        min_deposit: { amount: string; denom: string }[]
        expedited_min_deposit: { amount: string; denom: string }[]
      }
      gov.expedited_min_deposit = [{ denom, amount: (BigInt(gov.min_deposit[0].amount) * 5n).toString() }]
      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
