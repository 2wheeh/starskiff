import { describe, expect, it } from 'vitest'
import { defineConfig, Instance } from '../src/index.js'

const mnemonic = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'

describe('defineConfig', () => {
  it('normalizes named chains and a Hermes relayer without creating instances', () => {
    const config = defineConfig({
      chains: {
        gaia: {
          factory: Instance.gaiad,
          parameters: { chainId: 'gaia-test-1' },
          options: { timeout: 120_000 },
        },
        wasm: {
          factory: Instance.wasmd,
          parameters: { chainId: 'wasm-test-1' },
        },
      },
      relayers: {
        hermes: {
          mnemonic,
          channels: [['gaia', 'wasm']],
          gasPrice: '0.01',
        },
      },
    })

    expect(config.chains).toEqual([
      {
        name: 'gaia',
        factory: Instance.gaiad,
        parameters: { chainId: 'gaia-test-1' },
        options: { timeout: 120_000 },
      },
      {
        name: 'wasm',
        factory: Instance.wasmd,
        parameters: { chainId: 'wasm-test-1' },
        options: {},
      },
    ])
    expect(config.relayers).toEqual([
      {
        name: 'hermes',
        factory: Instance.hermes,
        channels: [['gaia', 'wasm']],
        parameters: { mnemonic, gasPrice: '0.01' },
        options: {},
      },
    ])
  })

  it('normalizes omitted relayers to an empty list', () => {
    const config = defineConfig({
      chains: { wasm: { factory: Instance.wasmd } },
    })

    expect(config.relayers).toEqual([])
  })

  it('preserves repeated channel pairs for multi-channel setups', () => {
    const channels = [['a', 'b'], ['a', 'b']] as const
    const config = defineConfig({
      chains: {
        a: { factory: Instance.wasmd },
        b: { factory: Instance.wasmd },
      },
      relayers: { hermes: { mnemonic, channels } },
    })

    expect(config.relayers[0].channels).toEqual(channels)
  })

  it.each([
    {
      name: 'an empty chain collection',
      config: { chains: {} },
      message: 'config.chains must contain at least one chain.',
    },
    {
      name: 'an unknown channel reference',
      config: {
        chains: { a: { factory: Instance.wasmd } },
        relayers: { hermes: { mnemonic, channels: [['a', 'missing']] } },
      },
      message: 'references unknown chain "missing"',
    },
  ])('rejects $name', ({ config, message }) => {
    expect(() => defineConfig(config as never)).toThrow(message)
  })
})
