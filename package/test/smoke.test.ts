import { describe, it, expect } from 'vitest'
import { Instance, cosmosBase, cosmosEvmBase } from '../dist/index.js'
import type { Genesis, CosmosAccount, CosmosChainParameters, CosmosBaseParameters, CosmosEvmChainParameters, CosmosEvmBaseParameters, CosmosEvmInstance, EventTypes } from '../dist/index.js'

describe('smoke test (built output)', () => {
  describe('exports', () => {
    it('exports Instance namespace with define, simd, wasmd, gaiad, xplad', () => {
      expect(Instance.define).toBeTypeOf('function')
      expect(Instance.simd).toBeTypeOf('function')
      expect(Instance.wasmd).toBeTypeOf('function')
      expect(Instance.gaiad).toBeTypeOf('function')
      expect(Instance.xplad).toBeTypeOf('function')
    })

    it('exports cosmosBase', () => {
      expect(cosmosBase).toBeTypeOf('function')
    })

    it('exports cosmosEvmBase', () => {
      expect(cosmosEvmBase).toBeTypeOf('function')
    })
  })

  describe('Instance.simd', () => {
    it('creates an instance with default values', () => {
      const instance = Instance.simd()
      expect(instance.name).toBe('simd')
      expect(instance.host).toBe('localhost')
      expect(instance.port).toBe(26657)
      expect(instance.status).toBe('idle')
    })

    it('accepts parameters', () => {
      const instance = Instance.simd({
        chainId: 'test-1',
        rpcPort: 27000,
        denom: 'uatom',
      })
      expect(instance.port).toBe(27000)
    })

    it('has lifecycle methods', () => {
      const instance = Instance.simd()
      expect(instance.start).toBeTypeOf('function')
      expect(instance.stop).toBeTypeOf('function')
      expect(instance.restart).toBeTypeOf('function')
    })

    it('has event methods', () => {
      const instance = Instance.simd()
      expect(instance.on).toBeTypeOf('function')
      expect(instance.off).toBeTypeOf('function')
    })

    it('has messages buffer', () => {
      const instance = Instance.simd()
      expect(instance.messages.get()).toEqual([])
      instance.messages.clear()
      expect(instance.messages.get()).toEqual([])
    })
  })

  describe('Instance.wasmd', () => {
    it('creates an instance with default values', () => {
      const instance = Instance.wasmd()
      expect(instance.name).toBe('wasmd')
      expect(instance.host).toBe('localhost')
      expect(instance.port).toBe(26657)
      expect(instance.status).toBe('idle')
    })
  })

  describe('Instance.gaiad', () => {
    it('creates an instance with default values', () => {
      const instance = Instance.gaiad()
      expect(instance.name).toBe('gaiad')
      expect(instance.host).toBe('localhost')
      expect(instance.port).toBe(26657)
      expect(instance.status).toBe('idle')
    })
  })

  describe('Instance.xplad', () => {
    it('creates an instance with default values and evmPort', () => {
      const instance = Instance.xplad()
      expect(instance.name).toBe('xpla')
      expect(instance.host).toBe('localhost')
      expect(instance.port).toBe(26657)
      expect(instance.evmPort).toBe(8545)
      expect(instance.status).toBe('idle')
    })

    it('advertises ethermint relayer hints for Hermes (eth_secp256k1 + coin type 60)', () => {
      const instance = Instance.xplad()
      const hints = instance.relayerHints
      if (hints?.addressDerivation !== 'ethermint') throw new Error('expected ethermint')
      expect(hints.hdPath).toBe("m/44'/60'/0'/0/0")
      expect(hints.pkTypeUrl).toBe('/cosmos.evm.crypto.v1.ethsecp256k1.PubKey')
    })
  })

  describe('relayer hints defaults', () => {
    it('simd exposes no relayer hints (Hermes falls back to secp256k1 defaults)', () => {
      const instance = Instance.simd()
      expect(instance.relayerHints).toBeUndefined()
    })

    it('wasmd exposes no relayer hints', () => {
      const instance = Instance.wasmd()
      expect(instance.relayerHints).toBeUndefined()
    })

    it('caller can override cosmosEvmBase pkTypeUrl via relayerHints', () => {
      const instance = Instance.xplad({
        relayerHints: { pkTypeUrl: '/ethermint.crypto.v1.ethsecp256k1.PubKey' },
      })
      const hints = instance.relayerHints
      if (hints?.addressDerivation !== 'ethermint') throw new Error('expected ethermint')
      expect(hints.pkTypeUrl).toBe('/ethermint.crypto.v1.ethsecp256k1.PubKey')
      // defaults from cosmosEvmBase still applied
      expect(hints.hdPath).toBe("m/44'/60'/0'/0/0")
    })
  })

  describe('Instance.define', () => {
    it('creates a custom instance', () => {
      const custom = Instance.define(() => ({
        name: 'custom',
        host: 'localhost',
        port: 3000,
        async start() {},
        async stop() {},
      }))

      const instance = custom()
      expect(instance.name).toBe('custom')
      expect(instance.status).toBe('idle')
    })
  })
})
