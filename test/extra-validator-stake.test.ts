import { describe, expect, it } from 'vitest';
import { computeExtraValidatorStake } from '../src/cosmos.js';

/**
 * Pure unit test for the extraValidators stake-scaling math (no chain boot).
 * The invariant that matters: the primary validator (the only one running a
 * live node) must retain > 2/3 of total voting power, or CometBFT halts at
 * genesis. See `computeExtraValidatorStake` for the derivation.
 */

function primaryVotingFraction(validatorStake: string, extraValidators: number): number {
  const primary = BigInt(validatorStake);
  const extraStake = computeExtraValidatorStake(validatorStake, extraValidators);
  const total = primary + extraStake * BigInt(extraValidators);
  // Fraction as a float is fine for a test-only assertion at these magnitudes.
  return Number(primary) / Number(total);
}

describe('computeExtraValidatorStake', () => {
  it('returns 0 when there are no extra validators', () => {
    expect(computeExtraValidatorStake('10000000', 0)).toBe(0n);
  });

  it('keeps the primary validator above 2/3 voting power for a large N', () => {
    // The old fixed 1/10 fraction breaks down at N=5 (1/(1+5/10) = 2/3, not > 2/3).
    // Assert the invariant holds well beyond that.
    for (const n of [1, 4, 5, 10, 50, 100]) {
      expect(primaryVotingFraction('10000000', n)).toBeGreaterThan(2 / 3);
    }
  });

  it('throws instead of silently minting zero-stake gentx for extreme N', () => {
    // validatorStake=100, N=1000 => 100/(4*1000) rounds to 0.
    expect(() => computeExtraValidatorStake('100', 1000)).toThrow(/rounds to 0/);
  });
});
