import { describe, it, expect, inject } from 'vitest'

const rpcUrl = inject('xplaRpcUrl')
const evmRpcUrl = inject('xplaEvmRpcUrl')

describe('xplad instance', () => {
  it('responds to Cosmos RPC /status', async () => {
    const res = await fetch(`${rpcUrl}/status`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { result: { sync_info: { latest_block_height: string } } }
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0)
  })

  it('responds to EVM JSON-RPC eth_blockNumber', async () => {
    const res = await fetch(evmRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
    })
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { result: string }
    expect(data.result).toMatch(/^0x[0-9a-f]+$/)
    expect(Number.parseInt(data.result, 16)).toBeGreaterThan(0)
  })

  it('responds to EVM JSON-RPC eth_chainId', async () => {
    const res = await fetch(evmRpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_chainId', params: [], id: 1 }),
    })
    const data = (await res.json()) as { result: string }
    expect(data.result).toMatch(/^0x[0-9a-f]+$/)
  })
})
