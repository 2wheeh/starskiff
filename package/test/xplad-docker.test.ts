import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createPublicClient, http } from 'viem';
import { Instance, findFreePorts, XPLA_DEFAULT_IMAGE, XPLA_DEFAULT_PRECOMPILES } from '../src/index.js';

/**
 * Boots xplad from the image containing official release binaries — the default runtime for
 * chains that publish one. Verifies the container path end to end: the chain
 * CLI runs inside disposable containers against a host-mounted home dir,
 * genesis is patched host-side, and the node's published ports serve the same
 * Cosmos RPC / REST / EVM JSON-RPC endpoints as a local binary would.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

let instance: ReturnType<typeof Instance.xplad>;

beforeAll(async () => {
  instance = Instance.xplad({
    ...(await findFreePorts({ evm: true })),
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000000000000000axpla', name: 'alice' },
    ],
  });
  await instance.start();
  // Image pull on a cold machine can dominate; the node itself boots in seconds.
}, 600_000);

afterAll(async () => {
  await instance?.stop();
});

describe('xplad (container runtime)', () => {
  it('defaults to the starskiff image of the official XPLA release', () => {
    expect(XPLA_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/2wheeh\/starskiff\/xplad[:@]/);
  });

  it('produces blocks and serves Cosmos RPC on the published port', async () => {
    const res = await fetch(`${instance.rpcUrl}/status`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as {
      result: { node_info: { network: string }; sync_info: { latest_block_height: string } };
    };
    expect(data.result.node_info.network).toBe('dimension_37-1');
    expect(Number(data.result.sync_info.latest_block_height)).toBeGreaterThan(0);
  });

  it('funded the genesis account (REST, recovered via stdin into the container)', async () => {
    const res = await fetch(
      `${instance.apiUrl}/cosmos/bank/v1beta1/balances/xpla1npvwllfr9dqr8erajqqr6s0vxnk2ak55hh2h5f`,
    );
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { balances: { denom: string; amount: string }[] };
    expect(data.balances.map((b) => b.denom)).toContain('axpla');
  });

  it('serves EVM JSON-RPC on the published port', async () => {
    const client = createPublicClient({ transport: http(instance.evmUrl) });
    expect(await client.getBlockNumber()).toBeGreaterThan(0n);
  });

  it('streams node logs through the instance message buffer', () => {
    const messages = instance.messages.get();
    expect(messages.length).toBeGreaterThan(0);
  });

  it('activates the v1.14 mainnet precompile set in the running node', async () => {
    const res = await fetch(`${instance.apiUrl}/cosmos/evm/vm/v1/params`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as { params: { active_static_precompiles: string[] } };
    expect(data.params.active_static_precompiles).toEqual([...XPLA_DEFAULT_PRECOMPILES]);
  });
});
