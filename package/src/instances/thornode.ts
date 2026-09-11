import fs from 'node:fs'
import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { OptionalInstanceSource } from '../source.js'

/** Official THORChain mainnet v3.20.1 image (linux/amd64; arm64 needs emulation). */
export const THORNODE_DEFAULT_IMAGE =
  'registry.gitlab.com/thorchain/thornode@sha256:b2c4d6c3a91d3eff5620874f6a4c33a112155a6f6e141fd26b1a3a1c8430e2c5'

export type ThornodeParameters = Omit<CosmosChainParameters, 'image' | 'extraValidators' | 'validatorStake' | 'denom' | 'prefix'> & OptionalInstanceSource & {
  patchGenesis?: (genesis: Genesis) => Genesis
}

/** A single-validator THORChain node. External chains, vault signing and Bifrost are not started. */
export const thornode = Instance.define((parameters?: ThornodeParameters) => {
  const params = parameters ?? {}
  const { binary = 'thornode', ...rest } = params
  return cosmosBase({
    name: 'thornode', binary, chainId: 'thorchain-1', ...rest,
    denom: 'rune', prefix: 'thor',
    relayerHints: { addressDerivation: 'cosmos', hdPath: "m/44'/931'/0'/0/0" },
    image: resolveInstanceImage('thornode', params, THORNODE_DEFAULT_IMAGE),
    runtime: (homeDir) => ({
      // THORChain otherwise prompts for signer credentials even when only
      // starting its API server. Keep this local fixture non-interactive.
      environment: { CHAIN_HOME_FOLDER: homeDir, SIGNER_NAME: 'validator', SIGNER_PASSWD: 'starskiff' },
    }),
    extraAppToml: { 'ebifrost.enabled': 'false' },
    async setupValidators({ genesisPath, run }) {
      const address = (await run(['keys', 'show', 'validator', '-a', '--keyring-backend', 'test'])).stdout.trim()
      const pubkey = (await run(['keys', 'show', 'validator', '-p', '--keyring-backend', 'test'])).stdout
      const consensus = (await run(['tendermint', 'show-validator'])).stdout
      const secp256k1 = (await run(['pubkey'], { input: pubkey })).stdout.trim()
      const ed25519 = (await run(['pubkey'], { input: consensus })).stdout.trim()
      const validatorConsPubKey = (await run(['pubkey', '--bech', 'cons'], { input: consensus })).stdout.trim()
      const version = (await run(['version'])).stdout.trim().replace(/^v/, '')
      const genesis = JSON.parse(fs.readFileSync(genesisPath, 'utf8'))
      genesis.app_state.thorchain.node_accounts = [{
        node_address: address, version, ip_address: '127.0.0.1', status: 'Active',
        // Consensus uses fixed power 100. No bond or reward/vault fixtures
        // are provisioned without the external signing infrastructure.
        bond: '0', active_block_height: '0', bond_address: address, signer_membership: [],
        validator_cons_pub_key: validatorConsPubKey, pub_key_set: { secp256k1, ed25519 },
      }]
      // THORChain uses its own send message instead of the SDK bank send.
      genesis.app_state.bank.params.default_send_enabled = false
      fs.writeFileSync(genesisPath, JSON.stringify(genesis, null, 2))
    },
  })
})
