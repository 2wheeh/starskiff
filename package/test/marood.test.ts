import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createPublicClient, createWalletClient, http, parseEther, parseAbi } from 'viem'
import { mnemonicToAccount } from 'viem/accounts'
import { marooTestnet } from 'viem/chains'
import { Instance, MAROO_NETWORKS, findFreePorts } from '../src/index.js'

/**
 * Boots dedicated marood instances (no shared global-setup) and verifies the
 * network presets: `testnet` against viem's `marooTestnet` chain definition
 * (chain id, native currency, multicall3 preinstall) including a signed EVM
 * transfer, Privacy runtime, PCL ownership, and canonical AA bytecode.
 * Supply MAROO_PRIVACY_GENESIS / MAROO_MAINNET_PRIVACY_GENESIS for each preset,
 * plus MAROO_PRIVACY_ZK_ARTIFACT_DIR (unless the image embeds the bundle).
 * MAROO_IMAGE selects Docker; otherwise MAROO_BINARY selects the host binary.
 * MAROO_TEST_PORT_BASE optionally avoids Docker Desktop's ephemeral port range.
 */

const source = process.env.MAROO_IMAGE
  ? { image: process.env.MAROO_IMAGE }
  : { binary: process.env.MAROO_BINARY ?? 'marood' }
const privacyZkArtifacts = process.env.MAROO_PRIVACY_ZK_ARTIFACT_DIR
  ? { directory: process.env.MAROO_PRIVACY_ZK_ARTIFACT_DIR }
  : undefined

async function testPorts(offset: number) {
  if (!process.env.MAROO_TEST_PORT_BASE) return findFreePorts({ evm: true })
  const base = Number(process.env.MAROO_TEST_PORT_BASE) + offset
  return {
    rpcPort: base, grpcPort: base + 1, apiPort: base + 2,
    p2pPort: base + 3, grpcWebPort: base + 4, pprofPort: base + 5, evmPort: base + 6,
  }
}

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

// eth coin type 60 accounts of the test mnemonic (m/44'/60'/0'/0/{i})
const alice = mnemonicToAccount(TEST_MNEMONIC)
const bob = mnemonicToAccount(TEST_MNEMONIC, { addressIndex: 1 })
// alice = 0x9858EfFD232B4033E47d90003D41EC34EcaEda94 → bech32(maroo, …)
const aliceBech32 = 'maroo1npvwllfr9dqr8erajqqr6s0vxnk2ak55fg67c4'

describe.skipIf(!process.env.MAROO_PRIVACY_GENESIS)('marood testnet preset (viem marooTestnet)', () => {
  const { bondDenom, feeDenom } = MAROO_NETWORKS.testnet

  let instance: ReturnType<typeof Instance.marood>
  let publicClient: ReturnType<typeof createPublicClient>
  let walletClient: ReturnType<typeof createWalletClient>

  beforeAll(async () => {
    instance = Instance.marood({
      ...source,
      privacyGenesis: process.env.MAROO_PRIVACY_GENESIS!,
      privacyZkArtifacts,
      policyAdmin: aliceBech32,
      ...(await testPorts(0)),
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

  it('initializes the Privacy V4 audit runtime through the precompile', async () => {
    const schedule = await publicClient.readContract({
      address: '0x100000000000000000000000000000000000000b',
      abi: parseAbi([
        'function auditKeySchedule() view returns ((uint64 activeEpoch, uint64 nextActivationHeight, uint64 nextEpoch, bool halted, int64 stateHeight) schedule)',
      ]),
      functionName: 'auditKeySchedule',
    })
    expect(schedule.activeEpoch).toBe(1n)
    expect(schedule.halted).toBe(false)
    expect(schedule.stateHeight).toBeGreaterThan(0n)
  })

  it('assigns the Privacy contract-policy owner and all three PCL entrypoints', async () => {
    const paramsResponse = await fetch(`${instance.apiUrl}/maroo/pcl/v1/params`)
    expect(paramsResponse.ok).toBe(true)
    const { params } = await paramsResponse.json() as {
      params: { policy_admin: string; entrypoints: string[] }
    }
    expect(params.policy_admin).toBe(aliceBech32)
    expect(params.entrypoints).toHaveLength(3)
    const policyResponse = await fetch(
      `${instance.apiUrl}/maroo/pcl/v1/contract_policies/maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqt575gw7`,
    )
    expect(policyResponse.ok).toBe(true)
    const policy = await policyResponse.json() as { config: { admin: string } }
    expect(policy.config.admin).toBe(aliceBech32)
  })

  it('uses the canonical SenderCreator baked into EntryPoint v0.8', async () => {
    const creator = await publicClient.readContract({
      address: '0x4337084d9e255ff0702461cf8895ce9e3b5ff108',
      abi: parseAbi(['function senderCreator() view returns (address)']),
      functionName: 'senderCreator',
    })
    expect(creator.toLowerCase()).toBe('0x449ed7c3e6fee6a97311d4b55475df59c44add33')
  })

  it('installs EntryPoint v0.6 and v0.9', async () => {
    for (const address of [
      '0x5ff137d4b0fdcd49dca30c7cf57e578a026d2789',
      '0x433709009b8330fda32311df1c2afa402ed8d009',
    ] as const) {
      expect((await publicClient.getCode({ address }))?.length).toBeGreaterThan(2)
    }
  })
})

describe.skipIf(!process.env.MAROO_MAINNET_PRIVACY_GENESIS)('marood mainnet preset', () => {
  const { chainId, evmChainId, bondDenom, feeDenom } = MAROO_NETWORKS.mainnet

  let instance: ReturnType<typeof Instance.marood>

  beforeAll(async () => {
    instance = Instance.marood({
      ...source,
      privacyGenesis: process.env.MAROO_MAINNET_PRIVACY_GENESIS!,
      privacyZkArtifacts,
      network: 'mainnet',
      ...(await testPorts(10)),
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
