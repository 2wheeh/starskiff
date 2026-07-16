import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { Instance, findFreePorts, EVMD_DEFAULT_IMAGE } from '../src/index.js';

/**
 * Boots evmd from the container image starskiff publishes (EVMD_DEFAULT_IMAGE)
 * — the default runtime now that cosmos/evm ships no official image. Verifies
 * the container path end to end against the same genesis patching (precompiles,
 * denom metadata, app mempool) the binary runtime uses.
 *
 * The image is digest-pinned and pulled from GHCR on first use (anonymous pull
 * — the package is public), so this doubles as a live check that the published
 * artifact actually boots.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

let instance: ReturnType<typeof Instance.evmd>;

beforeAll(async () => {
  instance = Instance.evmd({
    ...(await findFreePorts({ evm: true })),
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '100000000000000000000000000atest', name: 'alice' },
    ],
  });
  await instance.start();
}, 600_000);

afterAll(async () => {
  await instance?.stop();
});

async function ethRpc(method: string, params: unknown[] = []) {
  const res = await fetch(instance.evmUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  expect(res.ok).toBe(true);
  return (await res.json()) as { result: string };
}

describe('evmd (container runtime, published image)', () => {
  it('defaults to the starskiff-published evmd image', () => {
    expect(EVMD_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/2wheeh\/starskiff\/evmd[:@]/);
  });

  it('produces blocks on the published Cosmos RPC port', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      result: { sync_info: { latest_block_height: string } };
    };
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0);
  });

  it('reports the compiled-in EVM chain id (262144) over JSON-RPC', async () => {
    const data = await ethRpc('eth_chainId');
    expect(Number.parseInt(data.result, 16)).toBe(262144);
  });

  it('has the bank precompile active at 0x…0804 (patched genesis works in-container)', async () => {
    const addr = '0x0000000000000000000000000000000000000001';
    const data = await ethRpc('eth_call', [
      { to: '0x0000000000000000000000000000000000000804', data: '0x27e235e3' + addr.slice(2).padStart(64, '0') },
      'latest',
    ]);
    expect(data.result).not.toBe('0x');
    expect(data.result.length).toBeGreaterThan(2);
  });

  it('serves EVM JSON-RPC via a viem client', async () => {
    const client = createPublicClient({ transport: http(instance.evmUrl) });
    expect(await client.getBlockNumber()).toBeGreaterThan(0n);
  });
});
