import { describe, it, expect } from 'vitest'
import { resolveInstanceImage } from '../src/docker.js'
import { SIMD_DEFAULT_IMAGE, WASMD_DEFAULT_IMAGE, XPLA_DEFAULT_IMAGE, EVMD_DEFAULT_IMAGE } from '../src/index.js'

// Unit coverage for the shared "default artifact policy" resolver every
// container-first instance (wasmd, xplad, evmd) routes through. No node boots.
describe('resolveInstanceImage (default artifact policy)', () => {
  it('returns the default image when neither image nor binary is passed', () => {
    expect(resolveInstanceImage({}, 'default/img:1')).toBe('default/img:1')
  })

  it('returns an explicitly passed image', () => {
    expect(resolveInstanceImage({ image: 'my/img:2' }, 'default/img:1')).toBe('my/img:2')
  })

  it('opts out of docker (returns undefined) when binary is passed', () => {
    expect(resolveInstanceImage({ binary: 'wasmd' }, 'default/img:1')).toBeUndefined()
  })

  it('throws when both image and binary are passed (mutually exclusive)', () => {
    expect(() => resolveInstanceImage({ image: 'x', binary: 'y' }, 'd')).toThrow(/not both/)
  })

  it('rejects an empty or explicitly-undefined image instead of silently falling through', () => {
    expect(() => resolveInstanceImage({ image: '' }, 'd')).toThrow(/non-empty/)
    expect(() => resolveInstanceImage({ image: undefined }, 'd')).toThrow(/non-empty/)
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
