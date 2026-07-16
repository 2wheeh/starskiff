import { describe, it, expect, inject } from 'vitest'

const rpcUrl = inject('simdRpcUrl')
const mnemonic = inject('testMnemonic')

describe('simd instance', () => {
  it('responds to RPC /status', async () => {
    const res = await fetch(`${rpcUrl}/status`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as any
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0)
  })

  it('connects with StargateClient and queries balance', async () => {
    const { StargateClient } = await import('@cosmjs/stargate')
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing')

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'cosmos',
    })
    const [account] = await wallet.getAccounts()

    const client = await StargateClient.connect(rpcUrl)
    const balance = await client.getBalance(account.address, 'stake')

    expect(BigInt(balance.amount)).toBeGreaterThan(0n)
    client.disconnect()
  })

  it('can send tokens', async () => {
    const { SigningStargateClient } = await import('@cosmjs/stargate')
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing')

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'cosmos',
    })
    const [sender] = await wallet.getAccounts()

    const recipient = 'cosmos1qypqxpq9qcrsszg2pvxq6rs0zqg3yyc5lzv7xu'

    const client = await SigningStargateClient.connectWithSigner(rpcUrl, wallet)

    const result = await client.sendTokens(
      sender.address,
      recipient,
      [{ denom: 'stake', amount: '1000' }],
      { amount: [{ denom: 'stake', amount: '500' }], gas: '200000' },
    )

    expect(result.code).toBe(0)

    const balance = await client.getBalance(recipient, 'stake')
    expect(balance.amount).toBe('1000')

    client.disconnect()
  })
})
