import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPublicClient, createWalletClient, http, parseEther, parseAbi } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { marooTestnet } from 'viem/chains'
import { Instance, MAROO_NETWORKS, MAROO_NATIVE_ERC20, findFreePorts } from '../src/index.js'

/**
 * Boots dedicated marood instances (no shared global-setup) and verifies the
 * network presets: `testnet` against viem's `marooTestnet` chain definition
 * (chain id, native currency, multicall3 preinstall) including a signed EVM
 * transfer, and `mainnet` for chain identity + the split denom model.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// eth coin type 60 accounts of the test mnemonic (m/44'/60'/0'/0/{i})
const alice = mnemonicToAccount(TEST_MNEMONIC)
const bob = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 })
// alice = 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 → bech32(maroo, …)
const aliceBech32 = 'maroo1npvwllfr9dqr8erajqqr6s0vxnk2ak55fg67c4'

describe('marood testnet preset (viem marooTestnet)', () => {
  const { bondDenom, feeDenom } = MAROO_NETWORKS.testnet

  let instance: ReturnType<typeof Instance.marood>
  let publicClient: ReturnType<typeof createPublicClient>
  let walletClient: ReturnType<typeof createWalletClient>

  beforeAll(async () => {
    instance = Instance.marood({
      binary: 'marood', // no default image (private node source)
      ...(await findFreePorts({ evm: true })),
      accounts: [
        // coins must be alphabetically sorted: atmaroo < atokrw
        {
          mnemonic: TEST_MNEMONIC,
          coins: `1000000000000000000000${bondDenom},1000000000000000000000${feeDenom}`,
          name: 'alice',
        },
      ],
    })
    await instance.start()

    const transport = http(instance.evmUrl)
    publicClient = createPublicClient({ chain: marooTestnet, transport })
    walletClient = createWalletClient({ chain: marooTestnet, transport, account: alice })
  }, 120_000)

  afterAll(async () => {
    await instance?.stop()
  })

  it('responds to Cosmos RPC /status and produces blocks', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as {
      result: { node_info: { network: string }; sync_info: { latest_block_height: string } }
    }
    expect(data.result.node_info.network).toBe(`maroo_${marooTestnet.id}-1`)
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0)
  })

  it('reports the marooTestnet EVM chain id (450815)', async () => {
    expect(await publicClient.getChainId()).toBe(marooTestnet.id)
  })

  it('funded alice with both denoms (cosmos) and native balance (evm)', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/bank/v1beta1/balances/${aliceBech32}`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { balances: { denom: string; amount: string }[] }
    const denoms = data.balances.map((b) => b.denom)
    expect(denoms).toContain(bondDenom)
    expect(denoms).toContain(feeDenom)

    expect(await publicClient.getBalance({ address: alice.address })).toBe(parseEther('1000'))
  })

  it('transfers native tOKRW via a signed EVM transaction', async () => {
    const hash = await walletClient.sendTransaction({
      account: alice,
      chain: marooTestnet,
      to: bob.address,
      value: parseEther('1'),
    })
    const receipt = await publicClient.waitForTransactionReceipt({ hash })
    expect(receipt.status).toBe('success')
    expect(await publicClient.getBalance({ address: bob.address })).toBe(parseEther('1'))
  })

  it('has Multicall3 preinstalled where marooTestnet expects it', async () => {
    const multicall3 = marooTestnet.contracts.multicall3.address
    const code = await publicClient.getCode({ address: multicall3 })
    expect(code).toBeDefined()
    expect(code!.length).toBeGreaterThan(2)

    const bobBalance = await publicClient.readContract({
      address: multicall3,
      abi: parseAbi(['function getEthBalance(address) view returns (uint256)']),
      functionName: 'getEthBalance',
      args: [bob.address],
    })
    expect(bobBalance).toBe(parseEther('1'))
  })

  it('has the native OKRW ERC20 precompile responding with the preset symbol', async () => {
    const symbol = await publicClient.readContract({
      address: MAROO_NATIVE_ERC20,
      abi: parseAbi(['function symbol() view returns (string)']),
      functionName: 'symbol',
    })
    expect(symbol).toBe(marooTestnet.nativeCurrency.symbol)
  })
})

describe('marood mainnet preset', () => {
  const { chainId, evmChainId, bondDenom, feeDenom } = MAROO_NETWORKS.mainnet

  let instance: ReturnType<typeof Instance.marood>

  beforeAll(async () => {
    instance = Instance.marood({
      binary: 'marood', // no default image (private node source)
      network: 'mainnet',
      ...(await findFreePorts({ evm: true })),
      accounts: [
        // coins must be alphabetically sorted: amaroo < aokrw
        {
          mnemonic: TEST_MNEMONIC,
          coins: `1000000000000000000000${bondDenom},1000000000000000000000${feeDenom}`,
          name: 'alice',
        },
      ],
    })
    await instance.start()
  }, 120_000)

  afterAll(async () => {
    await instance?.stop()
  })

  it('runs with the mainnet chain ids (maroo_815-1 / 815)', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { result: { node_info: { network: string } } }
    expect(data.result.node_info.network).toBe(chainId)

    const rpc = await fetch(instance.evmUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    })
    const { result } = (await rpc.json()) as { result: string }
    expect(Number.parseInt(result, 16)).toBe(evmChainId)
  })

  it('funded alice with the mainnet denoms', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/bank/v1beta1/balances/${aliceBech32}`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { balances: { denom: string; amount: string }[] }
    const denoms = data.balances.map((b) => b.denom)
    expect(denoms).toContain(bondDenom)
    expect(denoms).toContain(feeDenom)
  })
})
