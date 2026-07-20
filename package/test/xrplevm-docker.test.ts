import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { Instance, findFreePorts, XRPLEVM_DEFAULT_IMAGE, XRPLEVM_DEFAULT_PRECOMPILES } from '../src/index.js';

/**
 * Boots xrplevm from the official Peersyst image — the default runtime.
 * Verifies chain identity (mainnet-mirroring chain id → eth_chainId 1440000),
 * the axrp denom patching, and the standard endpoints.
 *
 * The image is amd64-only; on arm64 hosts pre-pull with
 * `docker pull --platform linux/amd64 peersyst/exrp:<tag>` (runs emulated).
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

// eth coin type 60 account of the test mnemonic, bech32-encoded with `ethm`.
const aliceBech32 = 'ethm1npvwllfr9dqr8erajqqr6s0vxnk2ak55j7ufuc';

let instance: ReturnType<typeof Instance.xrplevm>;

beforeAll(async () => {
  instance = Instance.xrplevm({
    ...(await findFreePorts({ evm: true })),
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000000000000000axrp', name: 'alice' },
    ],
  });
  await instance.start();
  // Image pull on a cold machine can dominate; the node itself boots in seconds.
}, 600_000);

afterAll(async () => {
  await instance?.stop();
});

describe('xrplevm (container runtime)', () => {
  it('defaults to the official Peersyst image', () => {
    expect(XRPLEVM_DEFAULT_IMAGE).toMatch(/^peersyst\/exrp:/);
  });

  it('produces blocks and serves Cosmos RPC on the published port', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      result: { node_info: { network: string }; sync_info: { latest_block_height: string } };
    };
    expect(data.result.node_info.network).toBe('xrplevm_1440000-1');
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0);
  });

  it('funded the genesis account with axrp', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/bank/v1beta1/balances/${aliceBech32}`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { balances: { denom: string; amount: string }[] };
    expect(data.balances.map((b) => b.denom)).toContain('axrp');
  });

  it('serves EVM JSON-RPC with the mainnet eth chain id', async () => {
    const client = createPublicClient({ transport: http(instance.evmUrl) });
    expect(await client.getChainId()).toBe(1440000);
    expect(await client.getBlockNumber()).toBeGreaterThan(0n);
  });

  it('activates the mainnet precompile set (a fresh init leaves it empty)', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/evm/vm/v1/params`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { params: { active_static_precompiles: string[] } };
    expect(data.params.active_static_precompiles).toEqual([...XRPLEVM_DEFAULT_PRECOMPILES]);
  });
});
