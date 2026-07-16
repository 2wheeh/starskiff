import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { Instance, findFreePorts, MANTRA_DEFAULT_IMAGE } from '../src/index.js';

/**
 * Boots mantra from the official MANTRA image — the default runtime. Verifies
 * chain identity (mainnet-mirroring `mantra-1` / eth_chainId 5888), the
 * amantra denom patching, and the standard endpoints.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// eth coin type 60 account of the test mnemonic, bech32-encoded with `mantra`.
const aliceBech32 = 'mantra1npvwllfr9dqr8erajqqr6s0vxnk2ak55zmc0uq';

let instance: ReturnType<typeof Instance.mantra>;

beforeAll(async () => {
  instance = Instance.mantra({
    ...(await findFreePorts({ evm: true })),
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000000000000000amantra', name: 'alice' },
    ],
  });
  await instance.start();
  // Image pull on a cold machine can dominate; the node itself boots in seconds.
}, 600_000);

afterAll(async () => {
  await instance?.stop();
});

describe('mantra (container runtime)', () => {
  it('defaults to the official MANTRA image', () => {
    expect(MANTRA_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/mantra-chain\/mantrachain:/);
  });

  it('produces blocks and serves Cosmos RPC on the published port', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      result: { node_info: { network: string }; sync_info: { latest_block_height: string } };
    };
    expect(data.result.node_info.network).toBe('mantra-1');
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0);
  });

  it('funded the genesis account with amantra', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/bank/v1beta1/balances/${aliceBech32}`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { balances: { denom: string; amount: string }[] };
    expect(data.balances.map((b) => b.denom)).toContain('amantra');
  });

  it('serves EVM JSON-RPC with the mainnet eth chain id', async () => {
    const client = createPublicClient({ transport: http(instance.evmUrl) });
    expect(await client.getChainId()).toBe(5888);
    expect(await client.getBlockNumber()).toBeGreaterThan(0n);
  });
});
