import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { EVMD_DEFAULT_IMAGE, XPLA_DEFAULT_IMAGE } from '../src/index.js'

// config/images.json lives at the repo root, one level above the package.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'config', 'images.json'), 'utf8'),
) as {
  images: {
    name: string
    repo: string
    ref: string
    commit: string
    image: string
    digest: string | null
    platforms: string[]
  }[]
}

const byName = Object.fromEntries(manifest.images.map((i) => [i.name, i]))

describe('config/images.json ↔ instance defaults', () => {
  it.each([
    ['evmd', EVMD_DEFAULT_IMAGE],
    ['xplad', XPLA_DEFAULT_IMAGE],
  ])('pins %s to its configured image (single source of truth)', (name, actual) => {
    const image = byName[name]
    expect(image, `${name} must have a manifest entry`).toBeTruthy()

    // Digest recorded → pin to image@digest exactly. Pre-publish (digest null)
    // → pin to image:ref exactly. Either way an exact string match, so a typo'd
    // tag (e.g. :v999) or a drifted ref fails here instead of at runtime.
    const expected = image.digest ? `${image.image}@${image.digest}` : `${image.image}:${image.ref}`
    expect(actual).toBe(expected)
  })

  it('declares multi-arch platforms for every published image', () => {
    for (const img of manifest.images) {
      expect(img.platforms, `${img.name} platforms`).toEqual(
        expect.arrayContaining(['linux/amd64', 'linux/arm64']),
      )
    }
  })

  it('pins every upstream source ref to a full commit SHA', () => {
    for (const img of manifest.images) {
      expect(img.commit, `${img.name} source commit`).toMatch(/^[0-9a-f]{40}$/)
    }
  })

  it('never lists maroo/marood as a published image (hard rule)', () => {
    // Scan the operative image entries, not the human-readable _comment (which
    // names the rule and legitimately mentions maroo).
    const blob = JSON.stringify(manifest.images).toLowerCase()
    expect(blob).not.toContain('maroo')
  })
})
