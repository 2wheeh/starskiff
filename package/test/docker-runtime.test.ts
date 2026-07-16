import { describe, it, expect } from 'vitest'
import { resolveInstanceImage } from '../src/docker.js'
import {
  Instance,
  SIMD_DEFAULT_IMAGE,
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
    expect(() => resolveInstanceImage('gaiad', { binary: undefined })).toThrow(/non-empty/)
  })

  it('requires injection when the instance has no default image', () => {
    expect(() => resolveInstanceImage('gaiad', {})).toThrow(/gaiad has no default image/)
    expect(resolveInstanceImage('gaiad', { binary: 'gaiad' })).toBeUndefined()
    expect(resolveInstanceImage('gaiad', { image: 'my/gaia:v27' })).toBe('my/gaia:v27')
  })
})

// Instances without a usable upstream image must fail fast at construction —
// no implicit binary fallback.
describe('injection-required instances', () => {
  it('gaiad throws without an injected image or binary', () => {
    expect(() => Instance.gaiad()).toThrow(/no default image/)
    expect(() => Instance.gaiad({ chainId: 'hub-test-1' })).toThrow(/no default image/)
  })

  it('marood throws without an injected image or binary', () => {
    expect(() => Instance.marood()).toThrow(/no default image/)
  })

  it('an explicitly-undefined binary does not bypass required injection', () => {
    expect(() => Instance.gaiad({ binary: undefined })).toThrow(/non-empty/)
    expect(() => Instance.marood({ binary: undefined })).toThrow(/non-empty/)
  })

  it('gaiad/marood construct with an injected source', () => {
    expect(Instance.gaiad({ binary: 'gaiad' }).name).toBe('gaiad')
    expect(Instance.marood({ binary: 'marood' }).name).toBe('marood')
    expect(Instance.gaiad({ image: 'my/gaia:v27.5.0' }).name).toBe('gaiad')
  })
})

describe('container-first default images', () => {
  it('simd uses the official simapp image (minor-line pin)', () => {
    expect(SIMD_DEFAULT_IMAGE).toBe('ghcr.io/cosmos/simapp:v0.53')
  })

  it('wasmd pins an exact CosmWasm release tag', () => {
    expect(WASMD_DEFAULT_IMAGE).toBe('cosmwasm/wasmd:v0.61.14')
  })

  it('xplad pins the official XPLA image', () => {
    expect(XPLA_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/xpladev\/xpla:v/)
  })

  it('evmd pins the image starskiff publishes', () => {
    expect(EVMD_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/2wheeh\/starskiff\/evmd[:@]/)
  })
})
