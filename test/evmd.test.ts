import { describe, it, expect, inject } from 'vitest'

const rpcUrl = inject('evmdRpcUrl')
const evmRpcUrl = inject('evmdEvmRpcUrl')

async function ethRpc(method: string, params: unknown[] = []) {
  const res = await fetch(evmRpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  })
  expect(res.ok).toBe(true)
  return (await res.json()) as { result: string }
}

describe('evmd instance', () => {
  it('responds to Cosmos RPC /status', async () => {
    const res = await fetch(`${rpcUrl}/status`)
    expect(res.ok).toBe(true)
    const data = (await res.json()) as { result: { sync_info: { latest_block_height: string } } }
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0)
  })

  it('responds to EVM JSON-RPC eth_blockNumber', async () => {
    const data = await ethRpc('eth_blockNumber')
    expect(data.result).toMatch(/^0x[0-9a-f]+$/)
    expect(Number.parseInt(data.result, 16)).toBeGreaterThan(0)
  })

  it('reports the default Cosmos EVM chain id (262144)', async () => {
    const data = await ethRpc('eth_chainId')
    expect(Number.parseInt(data.result, 16)).toBe(262144)
  })

  it('has the bank precompile active at 0x…0804 (returns ABI data, not 0x)', async () => {
    // balances(address) — selector + a zero-padded address argument. The
    // account has no Cosmos coin balances, so the precompile returns an
    // ABI-encoded empty array, NOT empty calldata. A disabled precompile would
    // return "0x". This is what distinguishes evmd's canonical precompile set.
    const addr = '0x0000000000000000000000000000000000000001'
    const data = await ethRpc('eth_call', [
      { to: '0x0000000000000000000000000000000000000804', data: '0x27e235e3' + addr.slice(2).padStart(64, '0') },
      'latest',
    ])
    expect(data.result).not.toBe('0x')
    expect(data.result.length).toBeGreaterThan(2)
  })
})
