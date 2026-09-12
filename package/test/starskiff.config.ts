import { defineConfig, Instance } from '../src/index.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const RELAYER_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

// Six SDK nodes initialize concurrently; allow headroom for Docker Desktop and cold images.
const chainOptions = { timeout: 180_000 };

export default defineConfig({
  chains: {
    simd: {
      factory: Instance.simd,
      options: chainOptions,
      parameters: {
        chainId: 'starskiff-test-1',
        denom: 'stake',
        accounts: [{ mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' }],
      },
    },
    wasmA: {
      factory: Instance.wasmd,
      options: chainOptions,
      parameters: {
        chainId: 'ibc-wasm-a',
        prefix: 'wasm',
        accounts: [
          { mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' },
          { mnemonic: RELAYER_MNEMONIC, coins: '1000000000stake', name: 'relayer' },
        ],
      },
    },
    wasmB: {
      factory: Instance.wasmd,
      options: chainOptions,
      parameters: {
        chainId: 'ibc-wasm-b',
        prefix: 'wasm',
        accounts: [
          { mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' },
          { mnemonic: RELAYER_MNEMONIC, coins: '1000000000stake', name: 'relayer' },
        ],
      },
    },
    gaia: {
      factory: Instance.gaiad,
      options: chainOptions,
      parameters: {
        chainId: 'ibc-cosmos-1',
        denom: 'uatom',
        accounts: [
          { mnemonic: TEST_MNEMONIC, coins: '1000000000uatom', name: 'alice' },
          { mnemonic: RELAYER_MNEMONIC, coins: '1000000000uatom', name: 'relayer' },
        ],
      },
    },
    xpla: {
      factory: Instance.xplad,
      options: chainOptions,
      parameters: {
        chainId: 'dimension_37-1',
        accounts: [
          { mnemonic: TEST_MNEMONIC, coins: '1000000000000000000000axpla', name: 'alice' },
          // Relayer funding for Hermes — axpla is 18-decimal so use a large balance
          { mnemonic: RELAYER_MNEMONIC, coins: '1000000000000000000000axpla', name: 'relayer' },
        ],
      },
    },
    evmd: {
      factory: Instance.evmd,
      options: chainOptions,
      parameters: {
        // Default image lane: EVMD_DEFAULT_IMAGE is published to GHCR and pinned
        // by digest, so the harness runs it like every other image-backed chain.
        accounts: [
          { mnemonic: TEST_MNEMONIC, coins: '100000000000000000000000000atest', name: 'alice' },
        ],
      },
    },
  },
  relayers: {
    hermes: {
      mnemonic: RELAYER_MNEMONIC,
      channels: [['wasmA', 'wasmB'], ['wasmA', 'gaia'], ['wasmB', 'gaia'], ['wasmA', 'xpla']],
      options: { timeout: process.env.CI ? 300_000 : 180_000 },
    },
  },
});
