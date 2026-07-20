import { describe, expect, it } from 'vitest';
import {
  patchMaroodGenesis,
  MAROO_NETWORKS,
  MAROO_PREINSTALLS,
  MAROO_DEFAULT_PCL_ENTRYPOINTS,
  type Genesis,
} from '../src/index.js';

// Hardcoded literals rather than imported constants (module-internal in
// marood.ts) — guards against typos, like accounts.test.ts does for
// testAccounts addresses.
const MAROO_AGENT_IDENTITY_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqplfm99t';
const MAROO_AGENT_REPUTATION_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqz36wnt5';
const MAROO_EAS_SCHEMA_REGISTRY_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxckxhzt';
const MAROO_EAS_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq89qjzle';
const MAROO_EAS_INDEXER_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6dp7qp';

/** Pure unit tests for `patchMaroodGenesis` — see marood.ts for the rationale. */

/** Bare-`marood init`-shaped genesis: every touched module present but unseeded. */
function fixtureGenesis(): Genesis {
  return {
    app_state: {
      mint: { params: { mint_denom: 'aatom' } },
      gov: { params: { min_deposit: [{ denom: 'aatom' }] } },
      bank: { denom_metadata: [] },
      evm: { params: { evm_denom: 'aatom' }, preinstalls: [] },
      erc20: { token_pairs: [], native_precompiles: [] },
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
      preset: MAROO_NETWORKS.testnet,
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
        preinstalls: MAROO_PREINSTALLS,
      });
      expect((result.app_state as any).okrw.params.mint_denom).toBe(MAROO_NETWORKS[network].feeDenom);
    }
  });

  it('writes policyAdmin/minterAddress only when provided', () => {
    const withoutOpts = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet,
      preinstalls: MAROO_PREINSTALLS,
    });
    expect((withoutOpts.app_state as any).pcl.params.policy_admin).toBe('');
    expect((withoutOpts.app_state as any).okrw.params.minter_address).toBe('');

    const policyAdmin = 'maroo1policyadminexampleaddress00000000000';
    const minterAddress = 'maroo1minterexampleaddress0000000000000000';
    const withOpts = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet,
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
      preset: MAROO_NETWORKS.testnet,
      preinstalls: [],
    });

    expect((result.app_state as any).evm.preinstalls).toEqual([]);
  });

  it('leaves absent modules untouched without crashing or creating keys', () => {
    const genesis: Genesis = { app_state: {} };
    const result = patchMaroodGenesis(genesis, {
      preset: MAROO_NETWORKS.testnet,
      preinstalls: MAROO_PREINSTALLS,
    });

    for (const module of ['okrw', 'pcl', 'eas', 'agent', 'mint', 'gov', 'bank', 'evm', 'erc20']) {
      expect(result.app_state).not.toHaveProperty(module);
    }
  });

  it('runs the caller patchGenesis last, able to override seeded values', () => {
    const result = patchMaroodGenesis(fixtureGenesis(), {
      preset: MAROO_NETWORKS.testnet,
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
      preset: MAROO_NETWORKS.testnet,
      preinstalls: MAROO_PREINSTALLS,
      entrypoints: custom,
    });
    expect((result.app_state as any).pcl.params.entrypoints).toEqual(custom);
  });
});
