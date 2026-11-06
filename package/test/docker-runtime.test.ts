import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterAll, describe, it, expect } from 'vitest'
import { resolveInstanceImage, runArgs, startArgs } from '../src/docker.js'
import { resolveMaroodPrivacyZkRuntime } from '../src/instances/marood.js'
import { applyRuntimeEnvironment } from '../src/runtime.js'
import {
  Instance,
  cosmosEvmBase,
  SIMD_DEFAULT_IMAGE,
  GAIAD_DEFAULT_IMAGE,
  WASMD_DEFAULT_IMAGE,
  XPLA_DEFAULT_IMAGE,
  EVMD_DEFAULT_IMAGE,
} from '../src/index.js'

// Unit coverage for the shared "default artifact policy" resolver every
// instance routes through. No node boots.
describe('resolveInstanceImage (default artifact policy)', () => {
  it('returns the default image when neither image nor binary is passed', () => {
    expect(resolveInstanceImage('x', {}, 'default/img:1')).toBe('default/img:1')
  })

  it('returns an explicitly passed image', () => {
    expect(resolveInstanceImage('x', { image: 'my/img:2' }, 'default/img:1')).toBe('my/img:2')
  })

  it('opts out of docker (returns undefined) when binary is passed', () => {
    expect(resolveInstanceImage('x', { binary: 'wasmd' }, 'default/img:1')).toBeUndefined()
  })

  it('throws when both image and binary are passed (mutually exclusive)', () => {
    expect(() => resolveInstanceImage('x', { image: 'a', binary: 'b' }, 'd')).toThrow(/not both/)
  })

  it('rejects an empty or explicitly-undefined image instead of silently falling through', () => {
    expect(() => resolveInstanceImage('x', { image: '' }, 'd')).toThrow(/non-empty/)
    expect(() => resolveInstanceImage('x', { image: undefined }, 'd')).toThrow(/non-empty/)
  })

  it('rejects an empty or explicitly-undefined binary instead of silently opting out', () => {
    expect(() => resolveInstanceImage('x', { binary: '' }, 'd')).toThrow(/non-empty/)
    expect(() => resolveInstanceImage('x', { binary: undefined }, 'd')).toThrow(/non-empty/)
    // and it must not bypass required injection on no-default instances
    expect(() => resolveInstanceImage('marood', { binary: undefined })).toThrow(/non-empty/)
  })

  it('requires injection when the instance has no default image', () => {
    expect(() => resolveInstanceImage('marood', {})).toThrow(/marood has no default image/)
    expect(resolveInstanceImage('marood', { binary: 'marood' })).toBeUndefined()
    expect(resolveInstanceImage('marood', { image: 'my/marood:private' })).toBe('my/marood:private')
  })
})

// Instances without a usable upstream image must fail fast at construction —
// no implicit binary fallback.
describe('injection-required instances', () => {
  it('requires explicit sources for Cronos and dYdX, including JavaScript callers', () => {
    // @ts-expect-error A source is required.
    expect(() => Instance.cronosd()).toThrow(/cronosd has no default image/)
    // @ts-expect-error A source is required.
    expect(() => Instance.dydxprotocold({})).toThrow(/dydxprotocold has no default image/)
    expect(() => Instance.cronosd({ image: 'cronos:local', binary: 'cronosd' } as never)).toThrow(/not both/)
    expect(() => Instance.dydxprotocold({ binary: '' })).toThrow(/non-empty/)
  })

  it('rejects Sei IDs that load public-network genesis', () => {
    for (const chainId of ['pacific-1', 'atlantic-2', 'arctic-1']) {
      expect(() => Instance.seid({ chainId })).toThrow(/embedded|embeds/)
    }
  })

  it('rejects extra validators for THORChain custom registration', () => {
    // @ts-expect-error THORChain does not use staking gentxs.
    expect(() => Instance.thornode({ extraValidators: 1 })).toThrow(/extraValidators/)
  })
  it('marood throws without an injected image or binary', () => {
    // @ts-expect-error Runtime validation remains for JavaScript callers.
    expect(() => Instance.marood()).toThrow(/no default image/)
    // @ts-expect-error Network options do not replace the required runtime source.
    expect(() => Instance.marood({ network: 'mainnet' })).toThrow(/no default image/)
  })

  it('an explicitly-undefined binary does not bypass required injection', () => {
    // @ts-expect-error Runtime validation remains for JavaScript callers.
    expect(() => Instance.marood({ binary: undefined })).toThrow(/non-empty/)
  })

  it('marood requires a Privacy V4 input as well as a source', () => {
    // @ts-expect-error Runtime validation remains for JavaScript callers.
    expect(() => Instance.marood({ image: 'my/marood:private' })).toThrow(/privacyGenesis.*absolute host path/)
  })

  it('marood constructs with an injected source', () => {
    expect(Instance.marood({ binary: 'marood', privacyGenesis: '/tmp/privacy.json' }).name).toBe('marood')
    expect(Instance.marood({ image: 'my/marood:private', privacyGenesis: '/tmp/privacy.json' }).name).toBe('marood')
  })
})

describe('xrplevm chain identity', () => {
  it('preserves the mainnet-style Cosmos chain ID inference by default', () => {
    expect(Instance.xrplevm().evmChainId).toBe(1440000)
    expect(Instance.xrplevm({ chainId: 'xrplevm_1440002-1' }).evmChainId).toBe(1440002)
  })

  it('allows the EVM chain ID to be set independently of the Cosmos chain ID', () => {
    const instance = Instance.xrplevm({
      chainId: 'custom-xrplevm-local',
      evmChainId: 1440001,
    })

    expect(instance.chainId).toBe('custom-xrplevm-local')
    expect(instance.evmChainId).toBe(1440001)
  })

  it.each([null as unknown as number, 0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])('rejects invalid evmChainId=%s', (evmChainId) => {
    expect(() => Instance.xrplevm({ evmChainId })).toThrow(
      'evmChainId must be a positive safe integer',
    )
  })
})

describe('cosmosEvmBase chain identity', () => {
  it.each([0, -1, 1.5, Number.POSITIVE_INFINITY, Number.MAX_SAFE_INTEGER + 1])(
    'rejects invalid evmChainId=%s at the shared interface',
    (evmChainId) => {
      expect(() => cosmosEvmBase({
        binary: 'custom-evmd',
        name: 'custom-evmd',
        evmChainId,
      })).toThrow('evmChainId must be a positive safe integer')
    },
  )

  it('applies the shared validation to wrapper-provided values', () => {
    expect(() => Instance.mantra({ evmChainId: Number.NaN })).toThrow(
      'evmChainId must be a positive safe integer',
    )
  })

  it.each([
    ['--evm.evm-chain-id', '2'],
    ['--evm.evm-chain-id=2'],
  ])('rejects a duplicate raw EVM chain ID flag: %j', (...extraStartArgs) => {
    expect(() => cosmosEvmBase({
      binary: 'custom-evmd',
      name: 'custom-evmd',
      evmChainId: 1,
      extraStartArgs,
    })).toThrow('evmChainId cannot be combined with --evm.evm-chain-id')
  })

  it('preserves raw flag compatibility when evmChainId is omitted', () => {
    expect(() => cosmosEvmBase({
      binary: 'custom-evmd',
      name: 'custom-evmd',
      extraStartArgs: ['--evm.evm-chain-id=2'],
    })).not.toThrow()
  })
})

describe('container-first default images', () => {
  it('simd uses the official simapp image (minor-line pin)', () => {
    expect(SIMD_DEFAULT_IMAGE).toBe('ghcr.io/cosmos/simapp:v0.55')
  })

  it('gaiad pins the official gaia image at the live mainnet version', () => {
    expect(GAIAD_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/cosmos\/gaia:v/)
  })

  it('wasmd pins an exact CosmWasm release tag', () => {
    expect(WASMD_DEFAULT_IMAGE).toBe('cosmwasm/wasmd:v0.70.5')
  })

  it('xplad pins the official XPLA v1.14.0-rc4 image', () => {
    expect(XPLA_DEFAULT_IMAGE).toBe('ghcr.io/xpladev/xpla:v1.14.0-rc4')
  })

  it('evmd pins the image starskiff publishes', () => {
    expect(EVMD_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/2wheeh\/starskiff\/evmd[:@]/)
  })
})

const artifactDirectory = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-zk-test-'))
afterAll(() => fs.rmSync(artifactDirectory, { recursive: true, force: true }))

describe('marood Privacy ZK artifacts', () => {
  it('gives explicit environment values precedence in both runtimes', () => {
    const runtime = {
      environment: { OVERLAPPING_VALUE: 'explicit' },
      unsetEnvironment: ['OVERLAPPING_VALUE'],
    }
    const environment = applyRuntimeEnvironment(
      { OVERLAPPING_VALUE: 'parent' },
      runtime,
    )
    expect(environment.OVERLAPPING_VALUE).toBe('explicit')

    const args = runArgs(
      { image: 'maroo:local', homeDir: '/tmp/chain', runtime },
      'marood',
      ['init', 'validator'],
    )
    expect(args.lastIndexOf('OVERLAPPING_VALUE=explicit')).toBeGreaterThan(
      args.lastIndexOf('OVERLAPPING_VALUE='),
    )
  })

  it('maps audit-field artifacts for every Docker invocation', () => {
    const runtime = resolveMaroodPrivacyZkRuntime(
      { directory: artifactDirectory },
      true,
    )

    expect(runtime).toEqual({
      environment: {
        CLAIRVEIL_PRIVACY_ZK_ARTIFACT_DIR: '/starskiff/privacy-zk-artifacts',
        CLAIRVEIL_PRIVACY_ZK_PREFLIGHT_MODE: 'strict',
        CLAIRVEIL_PRIVACY_ZK_RUNTIME_ENVIRONMENT: 'development',
      },
      unsetEnvironment: ['MAROO_PRIVACY_GENESIS'],
      mounts: [{
        source: artifactDirectory,
        target: '/starskiff/privacy-zk-artifacts',
        readOnly: true,
      }],
    })

    const options = { image: 'maroo:local', homeDir: '/tmp/chain', runtime }
    for (const args of [
      runArgs(options, 'marood', ['init', 'validator']),
      startArgs(options, 'marood', ['start'], { name: 'marood-test', ports: [] }),
    ]) {
      expect(args).toContain(`${artifactDirectory}:/starskiff/privacy-zk-artifacts:ro`)
      expect(args).toContain('CLAIRVEIL_PRIVACY_ZK_ARTIFACT_DIR=/starskiff/privacy-zk-artifacts')
      expect(args).toContain('CLAIRVEIL_PRIVACY_ZK_PREFLIGHT_MODE=strict')
      expect(args).toContain('CLAIRVEIL_PRIVACY_ZK_RUNTIME_ENVIRONMENT=development')
      expect(args).toContain('MAROO_PRIVACY_GENESIS=')
    }
  })

  it('maps the same bundle to a local binary without a container mount', () => {
    const runtime = resolveMaroodPrivacyZkRuntime({ directory: artifactDirectory }, false)
    const environment = applyRuntimeEnvironment({
      KEEP_ME: 'yes', MAROO_PRIVACY_GENESIS: '/unrelated/privacy.json',
    }, runtime)
    expect(environment.KEEP_ME).toBe('yes')
    expect(environment.MAROO_PRIVACY_GENESIS).toBeUndefined()
    expect(environment.CLAIRVEIL_PRIVACY_ZK_ARTIFACT_DIR).toBe(artifactDirectory)
    expect(environment.CLAIRVEIL_PRIVACY_ZK_RUNTIME_ENVIRONMENT).toBe('development')
    expect(runtime?.mounts).toBeUndefined()
  })

  it('ignores inherited genesis files when artifacts are embedded in the image', () => {
    const runtime = resolveMaroodPrivacyZkRuntime(undefined, true)
    const args = runArgs({ image: 'maroo:v0.11.0', homeDir: '/tmp/chain', runtime }, 'marood', ['init', 'validator'])
    expect(args).toContain('MAROO_PRIVACY_GENESIS=')
    expect(runtime.environment).toBeUndefined()
    expect(runtime.mounts).toBeUndefined()
  })

  it('validates only that the host input is an absolute existing directory', () => {
    expect(() => Instance.marood({
      image: 'maroo:local',
      privacyGenesis: '/tmp/privacy.json',
      privacyZkArtifacts: { directory: 'relative/artifacts' },
    })).toThrow(/absolute host path/)

    expect(() => Instance.marood({
      binary: 'marood',
      privacyGenesis: '/tmp/privacy.json',
      privacyZkArtifacts: { directory: path.join(artifactDirectory, 'missing') },
    })).toThrow(/not an existing directory/)

    expect(() => Instance.marood({
      image: 'maroo:local',
      privacyGenesis: '/tmp/privacy.json',
      privacyZkArtifacts: { directory: artifactDirectory },
    })).not.toThrow()
  })
})
