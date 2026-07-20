import { describe, expect, it } from 'vitest';
import { toChecksumAddress } from '../src/utils.js';
import { normalizeActiveStaticPrecompiles } from '../src/cosmos.js';
import { MAROO_DEFAULT_PRECOMPILES } from '../src/index.js';

/**
 * Pins the P0 fix: stored `active_static_precompiles` are EIP-55 checksummed
 * (lowercasing silently disabled maroo's agent precompile) and stay sorted
 * per Go's `slices.IsSorted`. See normalizeActiveStaticPrecompiles.
 */
describe('toChecksumAddress', () => {
  it('matches EIP-55 spec vectors', () => {
    expect(toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
    expect(toChecksumAddress('0xfb6916095ca1df60bb79ce92ce3ea74c37c5d359')).toBe(
      '0xfB6916095ca1df60bB79Ce92cE3Ea74c37c5d359',
    );
    expect(toChecksumAddress('0xdbf03b407c01e7cd3cbea99509d93f8dddc8c6fb')).toBe(
      '0xdbF03B407c01E7cD3CBea99509d93f8DDDC8C6FB',
    );
  });

  it('is idempotent on already-checksummed input', () => {
    const checksummed = toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaed');
    expect(toChecksumAddress(checksummed)).toBe(checksummed);
  });

  it('preserves the maroo agent precompile address casing (…000a → …000A)', () => {
    expect(toChecksumAddress('0x100000000000000000000000000000000000000a')).toBe(
      '0x100000000000000000000000000000000000000A',
    );
  });

  it('accepts an uppercase 0X prefix', () => {
    expect(toChecksumAddress('0X5aaeb6053f3e94c9b9a09f33669435e7ef1beaed')).toBe(
      '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed',
    );
  });

  it('rejects an empty string', () => {
    expect(() => toChecksumAddress('')).toThrow(/not a 40-hex-digit address/);
  });

  it('rejects an address that is too short', () => {
    expect(() => toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1bea')).toThrow(
      /not a 40-hex-digit address/,
    );
  });

  it('rejects an address that is too long', () => {
    expect(() => toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaedff')).toThrow(
      /not a 40-hex-digit address/,
    );
  });

  it('rejects non-hex characters', () => {
    expect(() => toChecksumAddress('0x5aaeb6053f3e94c9b9a09f33669435e7ef1beaZg')).toThrow(
      /not a 40-hex-digit address/,
    );
  });
});

describe('normalizeActiveStaticPrecompiles', () => {
  it('checksums and sorts, preserving casing that toLowerCase would have destroyed', () => {
    const result = normalizeActiveStaticPrecompiles(['0x100000000000000000000000000000000000000a']);
    expect(result).toEqual(['0x100000000000000000000000000000000000000A']);
  });

  it('the maroo default precompile set stays casing-correct and Go-sorted after normalization', () => {
    const result = normalizeActiveStaticPrecompiles(MAROO_DEFAULT_PRECOMPILES);

    expect(result).toContain('0x100000000000000000000000000000000000000A');
    expect(result).not.toContain('0x100000000000000000000000000000000000000a');

    // Go's `slices.IsSorted` on the stored strings == plain ascending order.
    expect(result.every((value, i) => i === 0 || result[i - 1] <= value)).toBe(true);
  });

  it('sorts by the checksummed (stored) string, not a lowercase-keyed order', () => {
    // Checksumming leaves 'a111…' lowercase but flips 'f111…' to 'F111…', so
    // lowercase order (a < f) and stored order ('F' < 'a' in ASCII) disagree.
    const addrA = '0xa111111111111111111111111111111111111111';
    const addrF = '0xf111111111111111111111111111111111111111';

    const checksummedA = toChecksumAddress(addrA);
    const checksummedF = toChecksumAddress(addrF);
    expect(checksummedA).toBe('0xa111111111111111111111111111111111111111');
    expect(checksummedF).toBe('0xF111111111111111111111111111111111111111');

    const result = normalizeActiveStaticPrecompiles([addrA, addrF]);
    expect(result).toEqual([
      '0xF111111111111111111111111111111111111111',
      '0xa111111111111111111111111111111111111111',
    ]);

    // A lowercase-keyed sort would keep [a, F] — failing Go's `slices.IsSorted`.
    const lowercaseKeyedOrder = [checksummedA, checksummedF];
    expect(lowercaseKeyedOrder.every((v, i) => i === 0 || lowercaseKeyedOrder[i - 1] <= v)).toBe(false);
  });
});
