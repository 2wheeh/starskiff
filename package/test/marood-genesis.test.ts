import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import {
  patchMaroodGenesis,
  MAROO_NETWORKS,
  MAROO_PREINSTALLS,
  MAROO_DEFAULT_PRECOMPILES,
  MAROO_DEFAULT_PCL_ENTRYPOINTS,
  type Genesis,
} from '../src/index.js';

import { marooFixtures } from './fixtures/maroo/index.js';

const privacyGenesis = marooFixtures.testnetGenesis;
const mainnetPrivacyGenesis = marooFixtures.mainnetGenesis;
const privacyV4 = JSON.parse(fs.readFileSync(privacyGenesis, 'utf-8'));
// Only mutable invalid inputs need temporary files.
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-maroo-genesis-'));
function writePrivacy(name: string, value: unknown): string {
  const file = path.join(directory, `${name}.json`);
  fs.writeFileSync(file, JSON.stringify(value));
  return file;
}
afterAll(() => fs.rmSync(directory, { recursive: true, force: true }));

// Hardcoded literals rather than imported constants (module-internal in
// marood.ts) — guards against typos, like accounts.test.ts does for
// testAccounts addresses.
const MAROO_AGENT_IDENTITY_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqplfm99t';
const MAROO_AGENT_REPUTATION_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqz36wnt5';
const MAROO_EAS_SCHEMA_REGISTRY_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxckxhzt';
const MAROO_EAS_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq89qjzle';
const MAROO_EAS_INDEXER_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6dp7qp';

/** Unit tests for `patchMaroodGenesis` — see marood.ts for the rationale. */

/** Bare-`marood init`-shaped genesis: every touched module present but unseeded. */
function fixtureGenesis(): Genesis {
  return {
    app_state: {
      gov: { params: { min_deposit: [{ denom: 'aatom' }] } },
      bank: { denom_metadata: [] },
      evm: { params: { evm_denom: 'aatom' }, preinstalls: [] },
      okrw: { params: { mint_denom: 'aokrw', minter_address: '' } },
      pcl: { params: { policy_admin: '', entrypoints: [] } },
      eas: { params: { schema_registry_contract: '', eas_contract: '', indexer_contract: '' } },
      agent: { params: { identity_registry_address: '', reputation_registry_address: '' } },
    },
  };
}

describe('patchMaroodGenesis', () => {
  it('seeds agent/eas/pcl/okrw module params by default', () => {
    const result = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
    });
    const appState = result.app_state as any;

    expect(appState.agent.params.identity_registry_address).toBe(MAROO_AGENT_IDENTITY_REGISTRY);
    expect(appState.agent.params.reputation_registry_address).toBe(MAROO_AGENT_REPUTATION_REGISTRY);

    expect(appState.eas.params.schema_registry_contract).toBe(MAROO_EAS_SCHEMA_REGISTRY_CONTRACT);
    expect(appState.eas.params.eas_contract).toBe(MAROO_EAS_CONTRACT);
    expect(appState.eas.params.indexer_contract).toBe(MAROO_EAS_INDEXER_CONTRACT);

    expect(appState.pcl.params.entrypoints).toEqual([...MAROO_DEFAULT_PCL_ENTRYPOINTS]);
    expect(appState.okrw.params.mint_denom).toBe(MAROO_NETWORKS.testnet.feeDenom);
  });

  it('flips okrw.params.mint_denom to the network preset fee denom (mainnet aokrw / testnet atokrw)', () => {
    for (const network of ['mainnet', 'testnet'] as const) {
      const result = patchMaroodGenesis(fixtureGenesis(), {
        preset: MAROO_NETWORKS[network],
        privacyGenesis: network === 'testnet' ? privacyGenesis : mainnetPrivacyGenesis,
        preinstalls: MAROO_PREINSTALLS,
      });
      expect((result.app_state as any).okrw.params.mint_denom).toBe(MAROO_NETWORKS[network].feeDenom);
    }
  });

  it('writes policyAdmin/minterAddress only when provided', () => {
    const withoutOpts = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
    });
    expect((withoutOpts.app_state as any).pcl.params.policy_admin).toBe('');
    expect((withoutOpts.app_state as any).okrw.params.minter_address).toBe('');

    const policyAdmin = 'maroo1policyadminexampleaddress00000000000';
    const minterAddress = 'maroo1minterexampleaddress0000000000000000';
    const withOpts = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
      policyAdmin,
      minterAddress,
    });
    expect((withOpts.app_state as any).pcl.params.policy_admin).toBe(policyAdmin);
    expect((withOpts.app_state as any).okrw.params.minter_address).toBe(minterAddress);
  });

  it('clears evm.preinstalls when passed an empty array, even if the genesis already has entries', () => {
    const genesis = fixtureGenesis();
    (genesis.app_state as any).evm.preinstalls = [
      { name: 'Existing', address: '0x0000000000000000000000000000000000dEaD', code: '0x00' },
    ];

    const result = patchMaroodGenesis(genesis, {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: [],
    });

    expect((result.app_state as any).evm.preinstalls).toEqual([]);
  });

  it('leaves absent modules untouched without crashing or creating keys', () => {
    const genesis: Genesis = { app_state: {} };
    const result = patchMaroodGenesis(genesis, {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
    });

    for (const module of ['okrw', 'pcl', 'eas', 'agent', 'mint', 'gov', 'bank', 'evm', 'erc20']) {
      expect(result.app_state).not.toHaveProperty(module);
    }
  });

  it('runs the caller patchGenesis last, able to override seeded values', () => {
    const result = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
      patchGenesis: (genesis) => {
        (genesis.app_state as any).okrw.params.mint_denom = 'custom_denom';
        return genesis;
      },
    });
    expect((result.app_state as any).okrw.params.mint_denom).toBe('custom_denom');
  });

  it('overrides the default pcl entrypoints when provided', () => {
    const custom = ['maroo1customentrypointaddress000000000000'];
    const result = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis,
      preinstalls: MAROO_PREINSTALLS,
      entrypoints: custom,
    });
    expect((result.app_state as any).pcl.params.entrypoints).toEqual(custom);
  });
});

describe('Privacy policy ownership', () => {
  const privacyAddress = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqt575gw7';
  const policyAdmin = 'maroo1cml96vmptgw99syqrrz8az79xer2pcgp9vckp5';

  function policyFixture() {
    const genesis = fixtureGenesis();
    (genesis.app_state as any).pcl.contract_policies = [
      { config: { contract: privacyAddress, admin: 'existing-admin' }, policies: [{ selector: '__all__', marker: 'preserve-baseline' }] },
      { config: { contract: MAROO_EAS_CONTRACT, admin: 'other-admin' }, policies: [] },
    ];
    return genesis;
  }

  it('changes only the Privacy admin while preserving the complete policy payload', () => {
    const genesis = policyFixture();
    const expected = structuredClone((genesis.app_state as any).pcl.contract_policies);
    expected[0].config.admin = policyAdmin;
    const result = patchMaroodGenesis(genesis, {
      preset: MAROO_NETWORKS.testnet, privacyGenesis, preinstalls: [], policyAdmin,
    });
    expect((result.app_state as any).pcl.params.policy_admin).toBe(policyAdmin);
    expect((result.app_state as any).pcl.contract_policies).toEqual(expected);
  });

  it('preserves existing ownership when policyAdmin is omitted', () => {
    const genesis = policyFixture();
    const expected = structuredClone((genesis.app_state as any).pcl.contract_policies);
    patchMaroodGenesis(genesis, { preset: MAROO_NETWORKS.testnet, privacyGenesis, preinstalls: [] });
    expect((genesis.app_state as any).pcl.contract_policies).toEqual(expected);
  });

  it('creates the Privacy contract-policy owner in fresh genesis', () => {
    const genesis = fixtureGenesis();
    patchMaroodGenesis(genesis, { preset: MAROO_NETWORKS.testnet, privacyGenesis, preinstalls: [], policyAdmin });
    expect((genesis.app_state as any).pcl.contract_policies).toEqual([
      { config: { contract: privacyAddress, admin: policyAdmin }, policies: [] },
    ]);
  });

  it('lets the caller override Privacy ownership after synchronization', () => {
    const result = patchMaroodGenesis(policyFixture(), {
      preset: MAROO_NETWORKS.testnet, privacyGenesis, preinstalls: [], policyAdmin,
      patchGenesis: (genesis) => {
        expect((genesis.app_state as any).pcl.contract_policies[0].config.admin).toBe(policyAdmin);
        (genesis.app_state as any).pcl.contract_policies[0].config.admin = 'custom-admin';
        return genesis;
      },
    });
    expect((result.app_state as any).pcl.contract_policies[0].config.admin).toBe('custom-admin');
  });
});

describe('fresh Privacy V4 input', () => {
  it('installs the supplied public payload without rewriting audit identity', () => {
    const result = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, preinstalls: [], privacyGenesis,
    });
    expect(result.app_state.privacy).toEqual(privacyV4);
    expect(result.app_state).not.toHaveProperty('mint');
    expect(result.app_state).not.toHaveProperty('erc20');
  });

  it.each([
    { ...privacyV4, format_version: 3 },
    { ...privacyV4, mode: 'EXPORT' },
    { ...privacyV4, initial_height: 2 },
  ])('rejects an incompatible genesis header', (value) => {
    expect(() => patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, preinstalls: [], privacyGenesis: writePrivacy('invalid', value),
    })).toThrow(/FRESH Privacy V4.*initial_height 1/);
  });

  it('rejects a native asset that differs from the selected fee denom', () => {
    expect(() => patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.mainnet, preinstalls: [], privacyGenesis,
    })).toThrow(/native fee denom aokrw/);
  });

  it('rejects relative and missing files', () => {
    expect(() => patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, preinstalls: [], privacyGenesis: 'relative.json',
    })).toThrow(/absolute host path/);
    expect(() => patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet, preinstalls: [], privacyGenesis: path.join(directory, 'missing.json'),
    })).toThrow(/ENOENT/);
  });
});

describe('maroo runtime defaults', () => {
  it('enables registered precompiles without the retired IBC and Bank contracts', () => {
    for (const suffix of ['0802', '0804', '0807']) {
      expect(MAROO_DEFAULT_PRECOMPILES.some((address) => address.endsWith(suffix))).toBe(false);
    }
  });

});
