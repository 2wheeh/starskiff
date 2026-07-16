/** A well-known deterministic test account, ready to fund in genesis. */
export type TestAccount = {
  /** Account name (for genesis account labeling / keyring). */
  name: string
  /** BIP39 mnemonic. Public and non-secret — never fund with real value. */
  mnemonic: string
  /** Bech32 address, pre-derived for the "cosmos" prefix at the default cosmos HD path (m/44'/118'/0'/0/0). */
  address: string
}

/**
 * A handful of well-known, publicly-documented BIP39 test mnemonics used
 * throughout the Cosmos/EVM test ecosystems, with addresses pre-derived for
 * the "cosmos" bech32 prefix (the `cosmosBase` default) at the default HD
 * path. Handy for quickly funding genesis accounts without deriving anything
 * yourself.
 *
 * These mnemonics are public — do not use them for real funds.
 *
 * @remarks
 * Addresses here assume the "cosmos" prefix. Chains configured with a
 * different `prefix` (e.g. `osmo`, `xpla`) need addresses re-derived from
 * the same mnemonic — the underlying key doesn't change, only the bech32
 * encoding does.
 */
export const testAccounts: TestAccount[] = [
  {
    name: 'alice',
    mnemonic:
      'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about',
    address: 'cosmos19rl4cm2hmr8afy4kldpxz3fka4jguq0auqdal4',
  },
  {
    name: 'bob',
    mnemonic: 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong',
    address: 'cosmos1am058pdux3hyulcmfgj4m3hhrlfn8nzm88u80q',
  },
  {
    name: 'carol',
    mnemonic: 'test test test test test test test test test test test junk',
    address: 'cosmos15yk64u7zc9g9k2yr2wmzeva5qgwxps6yxj00e7',
  },
  {
    name: 'faucet',
    mnemonic:
      'economy stock theory fatal elder harbor betray wasp final emotion task crumble siren bottom lizard educate guess current outdoor pair theory focus wife stone',
    address: 'cosmos1pkptre7fdkl6gfrzlesjjvhxhlc3r4gmmk8rs6',
  },
]
