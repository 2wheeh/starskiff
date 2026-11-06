import type { TestProject } from 'vitest/node';
import { createGlobalSetup, type StarskiffContext } from '../src/vitest.js';
import config from './starskiff.config.js';

const setupTopology = createGlobalSetup(config);

export default async function setup(project: TestProject) {
  console.log('[global-setup] starting the configured chains and Hermes...');
  const teardown = await setupTopology(project);
  try {
    const { chains } = project.getProvidedContext().starskiff;
    project.provide('simdRpcUrl', chains.simd.rpcUrl);
    project.provide('wasmARpcUrl', chains.wasmA.rpcUrl);
    project.provide('wasmBRpcUrl', chains.wasmB.rpcUrl);
    project.provide('gaiaRpcUrl', chains.gaia.rpcUrl);
    project.provide('xplaRpcUrl', chains.xpla.rpcUrl);
    project.provide('xplaEvmRpcUrl', chains.xpla.evmUrl!);
    project.provide('evmdRpcUrl', chains.evmd.rpcUrl);
    project.provide('evmdEvmRpcUrl', chains.evmd.evmUrl!);
    project.provide('testMnemonic', 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about');
    console.log('[global-setup] topology ready');
    return teardown;
  } catch (error) {
    await teardown();
    throw error;
  }
}

declare module 'vitest' {
  export interface ProvidedContext {
    starskiff: StarskiffContext;
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
