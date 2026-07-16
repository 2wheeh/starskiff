import type { TestProject } from 'vitest/node';
import { Instance } from '../src/index.js';

const TEST_MNEMONIC = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about';

const RELAYER_MNEMONIC = 'zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo zoo wrong';

export default async function setup({ provide }: TestProject) {
  const cleanups: (() => Promise<void>)[] = [];

  const simd = Instance.simd({
    chainId: 'starskiff-test-1',
    denom: 'stake',
    accounts: [{ mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' }],
  });
  console.log('[global-setup] starting simd...');
  await simd.start();
  console.log('[global-setup] simd started');
  cleanups.push(() => simd.stop());

  const wasmA = Instance.wasmd({
    chainId: 'ibc-wasm-a',
    prefix: 'wasm',
    rpcPort: 26757,
    grpcPort: 9190,
    apiPort: 1417,
    p2pPort: 26756,
    grpcWebPort: 9191,
    pprofPort: 6160,
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' },
      { mnemonic: RELAYER_MNEMONIC, coins: '1000000000stake', name: 'relayer' },
    ],
  });

  const wasmB = Instance.wasmd({
    chainId: 'ibc-wasm-b',
    prefix: 'wasm',
    rpcPort: 26857,
    grpcPort: 9290,
    apiPort: 1517,
    p2pPort: 26856,
    grpcWebPort: 9291,
    pprofPort: 6260,
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000stake', name: 'alice' },
      { mnemonic: RELAYER_MNEMONIC, coins: '1000000000stake', name: 'relayer' },
    ],
  });

  const gaia = Instance.gaiad({
    // gaiad has no default image; CI provisions this binary (config/binaries.json).
    binary: 'gaiad',
    chainId: 'ibc-cosmos-1',
    denom: 'uatom',
    rpcPort: 26957,
    grpcPort: 9390,
    apiPort: 1617,
    p2pPort: 26956,
    grpcWebPort: 9391,
    pprofPort: 6360,
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000uatom', name: 'alice' },
      { mnemonic: RELAYER_MNEMONIC, coins: '1000000000uatom', name: 'relayer' },
    ],
  });

  const xpla = Instance.xplad({
    chainId: 'dimension_37-1',
    rpcPort: 27057,
    grpcPort: 9490,
    apiPort: 1717,
    p2pPort: 27056,
    grpcWebPort: 9491,
    pprofPort: 6460,
    evmPort: 18545,
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '1000000000000000000000axpla', name: 'alice' },
      // Relayer funding for Hermes — axpla is 18-decimal so use a large balance
      { mnemonic: RELAYER_MNEMONIC, coins: '1000000000000000000000axpla', name: 'relayer' },
    ],
  });

  const evmd = Instance.evmd({
    // Default image lane: EVMD_DEFAULT_IMAGE is published to GHCR and pinned
    // by digest, so the harness runs it like every other image-backed chain.
    rpcPort: 27157,
    grpcPort: 9590,
    apiPort: 1817,
    p2pPort: 27156,
    grpcWebPort: 9591,
    pprofPort: 6560,
    evmPort: 18546,
    accounts: [
      { mnemonic: TEST_MNEMONIC, coins: '100000000000000000000000000atest', name: 'alice' },
    ],
  });

  console.log('[global-setup] starting ibc chains + xpla + evmd...');
  await Promise.all([wasmA.start(), wasmB.start(), gaia.start(), xpla.start(), evmd.start()]);
  console.log('[global-setup] chains started');
  cleanups.push(() => wasmA.stop());
  cleanups.push(() => wasmB.stop());
  cleanups.push(() => gaia.stop());
  cleanups.push(() => xpla.stop());
  cleanups.push(() => evmd.stop());

  const relayer = Instance.hermes(
    {
      channels: [[wasmA, wasmB], [wasmA, gaia], [wasmB, gaia], [wasmA, xpla]],
      mnemonic: RELAYER_MNEMONIC,
    },
    { timeout: process.env.CI ? 300_000 : 180_000 },
  );

  const onRelayerMessage = (msg: string) => {
    if (msg.includes('[hermes-setup]')) {
      console.log(msg.trim());
    }
  };

  relayer.on('message', onRelayerMessage);

  console.log('[global-setup] starting hermes relayer...');
  try {
    await relayer.start();
  } finally {
    relayer.off('message', onRelayerMessage);
  }
  console.log('[global-setup] hermes relayer started');
  cleanups.push(() => relayer.stop());

  provide('simdRpcUrl', `http://localhost:${simd.port}`);
  provide('wasmARpcUrl', `http://${wasmA.host}:${wasmA.port}`);
  provide('wasmBRpcUrl', `http://${wasmB.host}:${wasmB.port}`);
  provide('gaiaRpcUrl', `http://${gaia.host}:${gaia.port}`);
  provide('xplaRpcUrl', `http://${xpla.host}:${xpla.port}`);
  provide('xplaEvmRpcUrl', `http://${xpla.host}:${xpla.evmPort}`);
  provide('evmdRpcUrl', `http://${evmd.host}:${evmd.port}`);
  provide('evmdEvmRpcUrl', `http://${evmd.host}:${evmd.evmPort}`);
  provide('testMnemonic', TEST_MNEMONIC);

  return async () => {
    await Promise.all(cleanups.map(fn => fn()));
  };
}

declare module 'vitest' {
  export interface ProvidedContext {
    simdRpcUrl: string;
    wasmARpcUrl: string;
    wasmBRpcUrl: string;
    gaiaRpcUrl: string;
    xplaRpcUrl: string;
    xplaEvmRpcUrl: string;
    evmdRpcUrl: string;
    evmdEvmRpcUrl: string;
    testMnemonic: string;
  }
}
