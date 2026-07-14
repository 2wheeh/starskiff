import { describe, expect, it } from 'vitest';
import { testAccounts } from '../src/index.js';

describe('testAccounts', () => {
  it('derives addresses matching the hardcoded literals (guards against typos)', async () => {
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing');

    for (const account of testAccounts) {
      const wallet = await DirectSecp256k1HdWallet.fromMnemonic(account.mnemonic, {
        prefix: 'cosmos',
      });
      const [derived] = await wallet.getAccounts();
      expect(derived.address).toBe(account.address);
    }
  });

  it('has unique names and addresses', () => {
    expect(new Set(testAccounts.map(a => a.name)).size).toBe(testAccounts.length);
    expect(new Set(testAccounts.map(a => a.address)).size).toBe(testAccounts.length);
  });
});
