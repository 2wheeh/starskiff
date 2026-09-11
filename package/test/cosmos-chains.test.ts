import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DirectSecp256k1HdWallet } from '@cosmjs/proto-signing'
import { stringToPath } from '@cosmjs/crypto'
import { createPublicClient, http } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { Instance, findFreePorts, testAccounts, type CosmosInstance, type InstanceSource } from '../src/index.js'

const mnemonic = testAccounts[0].mnemonic
const funded = '1000000000000'

function source(name: string, binary: string): InstanceSource {
  const image = process.env[`STARSKIFF_${name}_IMAGE`]
  return image ? { image } : { binary: process.env[`STARSKIFF_${name}_BINARY`] ?? binary }
}

const chains = [
  { name: 'provenanced', create: Instance.provenanced, prefix: 'pb', coinType: 505, denom: 'nhash', chainId: 'pio-mainnet-1' },
  { name: 'cronosd', create: (params: object, options: Instance.InstanceOptions) => Instance.cronosd({ ...params, ...source('CRONOSD', 'cronosd') }, options), prefix: 'crc', coinType: 60, denom: 'basecro', chainId: 'cronosmainnet_25-1', evmChainId: 25 },
  { name: 'dydxprotocold', create: (params: object, options: Instance.InstanceOptions) => Instance.dydxprotocold({ ...params, ...source('DYDXPROTOCOLD', 'dydxprotocold') }, options), prefix: 'dydx', coinType: 118, denom: 'adydx', chainId: 'dydx-mainnet-1' },
  { name: 'seid', create: Instance.seid, prefix: 'sei', coinType: 118, denom: 'usei', chainId: 'starskiff-sei-1', evmChainId: 713714 },
  { name: 'thornode', create: Instance.thornode, prefix: 'thor', coinType: 931, denom: 'rune', chainId: 'thorchain-1' },
]

for (const chain of chains) {
  describe(chain.name, () => {
    let instance: CosmosInstance & { evmUrl?: string }
    let address: string

    beforeAll(async () => {
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
        prefix: chain.prefix, hdPaths: [stringToPath(`m/44'/${chain.coinType}'/0'/0/0`)],
      })
      address = (await wallet.getAccounts())[0].address
      instance = chain.create({
        ...await findFreePorts({ evm: true }),
        accounts: [{ mnemonic, coins: `${funded}${chain.denom}`, name: 'alice' }],
      }, { timeout: 300_000 })
      await instance.start()
    }, 600_000)

    afterAll(async () => { await instance?.stop() })

    it('keeps producing blocks on its configured RPC port', async () => {
      const height = async () => {
        const response = await fetch(`${instance.rpcUrl}/status`)
        expect(response.ok).toBe(true)
        type Status = { node_info: { network: string }; sync_info: { latest_block_height: string } }
        const body = await response.json() as Status & { result?: Status }
        const status = body.result ?? body
        expect(status.node_info.network).toBe(chain.chainId)
        return Number(status.sync_info.latest_block_height)
      }
      const first = await height()
      expect(first).toBeGreaterThan(0)
      await expect.poll(height, { timeout: 15_000 }).toBeGreaterThan(first + 2)
    }, 20_000)

    it('funds the recovered account using the native denomination and derivation', async () => {
      if (chain.name === 'cronosd') {
        const client = createPublicClient({ transport: http(instance.evmUrl!) })
        expect(await client.getBalance({ address: mnemonicToAccount(mnemonic).address })).toBe(BigInt(funded))
      } else {
        const response = await fetch(`${instance.apiUrl}/cosmos/bank/v1beta1/balances/${address}`)
        expect(response.ok).toBe(true)
        const body = await response.json() as { balances: { denom: string; amount: string }[] }
        expect(body.balances).toContainEqual({ denom: chain.denom, amount: funded })
      }
    })

    if (chain.evmChainId) {
      it('serves the expected EVM chain and committed blocks', async () => {
        const client = createPublicClient({ transport: http(instance.evmUrl!) })
        expect(await client.getChainId()).toBe(chain.evmChainId)
        expect(await client.getBlockNumber()).toBeGreaterThan(0n)
      })
    }

    if (chain.name === 'thornode') {
      it('registers one active THORChain node without SDK staking gentxs', async () => {
        const genesisResponse = await fetch(`${instance.rpcUrl}/genesis`)
        const genesis = await genesisResponse.json() as {
          result: { genesis: { app_state: { thorchain: { node_accounts: { node_address: string }[] } } } }
        }
        const nodes = genesis.result.genesis.app_state.thorchain.node_accounts
        expect(nodes).toHaveLength(1)
        // /nodes lists bonded nodes; this local consensus fixture has no bond.
        const response = await fetch(`${instance.apiUrl}/thorchain/node/${nodes[0].node_address}`)
        expect(response.ok).toBe(true)
        const node = await response.json() as { status: string; version: string; total_bond: string }
        expect(node.status).toBe('Active')
        expect(node.version).toBe('3.20.1')
        expect(node.total_bond).toBe('0')
      })
    }

    it('stops and releases its RPC port', async () => {
      await instance.stop()
      expect(instance.status).toBe('stopped')
      await expect(fetch(`${instance.rpcUrl}/status`, { signal: AbortSignal.timeout(2_000) })).rejects.toThrow()
    })
  })
}
