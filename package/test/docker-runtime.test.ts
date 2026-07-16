import { describe, it, expect } from 'vitest'
import { resolveInstanceImage } from '../src/docker.js'
import {
  Instance,
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
  it('marood throws without an injected image or binary', () => {
    expect(() => Instance.marood()).toThrow(/no default image/)
    expect(() => Instance.marood({ network: 'mainnet' })).toThrow(/no default image/)
  })

  it('an explicitly-undefined binary does not bypass required injection', () => {
    expect(() => Instance.marood({ binary: undefined })).toThrow(/non-empty/)
  })

  it('marood constructs with an injected source', () => {
    expect(Instance.marood({ binary: 'marood' }).name).toBe('marood')
    expect(Instance.marood({ image: 'my/marood:private' }).name).toBe('marood')
  })
})

describe('container-first default images', () => {
  it('simd uses the official simapp image (minor-line pin)', () => {
    expect(SIMD_DEFAULT_IMAGE).toBe('ghcr.io/cosmos/simapp:v0.53')
  })

  it('gaiad pins the official gaia image at the live mainnet version', () => {
    expect(GAIAD_DEFAULT_IMAGE).toMatch(/^ghcr\.io\/cosmos\/gaia:v/)
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
