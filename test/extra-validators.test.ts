import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Instance } from '../src/index.js';

/**
 * Verifies the `extraValidators` genesis option: a chain booted with N extra
 * validators ends up with 1 + N bonded validators in the CometBFT consensus
 * set, each with a DISTINCT consensus key. Uses a dedicated short-lived simd on
 * non-default ports (no shared global-setup) so the assertion runs against a
 * fresh chain before the non-signing extra validators can be jailed for
 * downtime.
 */

const TEST_MNEMONIC =
  'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const simd = Instance.simd({
  chainId: 'cosmock-multival-1',
  denom: 'stake',
  extraValidators: 1,
  accounts: [{ mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' }],
  // Non-default ports to avoid clashing with the integration global-setup simd.
  rpcPort: 26667,
  grpcPort: 9099,
  apiPort: 1327,
  p2pPort: 26666,
  grpcWebPort: 9098,
  pprofPort: 6069,
});

type ValidatorsResponse = {
  result: {
    total: string;
    validators: { address: string; voting_power: string }[];
  };
};

describe('extraValidators (genesis multi-validator)', () => {
  beforeAll(async () => {
    await simd.start();
  }, 60_000);

  afterAll(async () => {
    await simd.stop();
  });

  it('boots with 1 + extraValidators bonded validators, each with a distinct consensus key', async () => {
    const res = await fetch(`http://${simd.host}:${simd.port}/validators`);
    expect(res.ok).toBe(true);
    const data = (await res.json()) as ValidatorsResponse;

    // 1 default + 1 extra = 2 validators in the consensus set.
    expect(Number(data.result.total)).toBe(2);
    expect(data.result.validators).toHaveLength(2);

    // Distinct consensus addresses prove distinct consensus keys (not the same
    // priv_validator_key reused) — the whole point of the gentx `--pubkey` path.
    const addresses = new Set(data.result.validators.map(v => v.address));
    expect(addresses.size).toBe(2);

    // The primary validator must hold > 2/3 voting power (extras are bonded but
    // run no node, so the single live node needs a supermajority to make blocks).
    const powers = data.result.validators
      .map(v => Number(v.voting_power))
      .sort((a, b) => b - a);
    const total = powers.reduce((a, b) => a + b, 0);
    expect(powers[0] / total).toBeGreaterThan(2 / 3);
  });
});
