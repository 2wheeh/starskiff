import { describe, expect, it } from 'vitest';
import { sortCoins } from '../src/utils.js';

/**
 * `genesis add-genesis-account` rejects multi-coin strings whose denoms
 * aren't in ascending byte order — sortCoins normalizes for callers.
 */
describe('sortCoins', () => {
  it('sorts out-of-order multi-coin denoms ascending', () => {
    expect(sortCoins('1000stake,1000atom')).toBe('1000atom,1000stake');
  });

  it('leaves already-sorted multi-coin strings unchanged', () => {
    expect(sortCoins('1000atom,1000stake')).toBe('1000atom,1000stake');
  });

  it('leaves single-coin strings unchanged', () => {
    expect(sortCoins('1000000000stake')).toBe('1000000000stake');
  });

  it('tolerates whitespace around entries', () => {
    expect(sortCoins('1000stake, 1000atom')).toBe('1000atom,1000stake');
    expect(sortCoins(' 1000stake , 1000atom ')).toBe('1000atom,1000stake');
  });

  it('returns malformed input verbatim', () => {
    expect(sortCoins('stake,1000atom')).toBe('stake,1000atom'); // no leading digits
    expect(sortCoins('1000,1000atom')).toBe('1000,1000atom'); // empty denom
    expect(sortCoins('')).toBe(''); // empty string
  });

  it('sorts the realistic maroo-sdk case (atmaroo before atokrw)', () => {
    expect(sortCoins('1000000000000000000atokrw,1000000000000000000atmaroo')).toBe(
      '1000000000000000000atmaroo,1000000000000000000atokrw',
    );
  });
});
