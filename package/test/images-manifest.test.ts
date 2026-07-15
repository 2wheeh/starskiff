import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { describe, it, expect } from 'vitest'
import { EVMD_DEFAULT_IMAGE } from '../src/index.js'

// config/images.json lives at the repo root, one level above the package.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..')
const manifest = JSON.parse(
  readFileSync(path.join(repoRoot, 'config', 'images.json'), 'utf8'),
) as {
  images: {
    name: string
    repo: string
    ref: string
    image: string
    digest: string | null
    platforms: string[]
  }[]
}

const byName = Object.fromEntries(manifest.images.map((i) => [i.name, i]))

describe('config/images.json ↔ instance defaults', () => {
  it('pins EVMD_DEFAULT_IMAGE to the published evmd image (single source of truth)', () => {
    const evmd = byName['evmd']
    expect(evmd, 'evmd must have a manifest entry').toBeTruthy()

    // Digest recorded → pin to image@digest exactly. Pre-publish (digest null)
    // → pin to image:ref exactly. Either way an exact string match, so a typo'd
    // tag (e.g. :v999) or a drifted ref fails here instead of at runtime.
    const expected = evmd.digest ? `${evmd.image}@${evmd.digest}` : `${evmd.image}:${evmd.ref}`
    expect(EVMD_DEFAULT_IMAGE).toBe(expected)
  })

  it('declares multi-arch platforms for every published image', () => {
    for (const img of manifest.images) {
      expect(img.platforms, `${img.name} platforms`).toEqual(
        expect.arrayContaining(['linux/amd64', 'linux/arm64']),
      )
    }
  })

  it('never lists maroo/marood as a published image (hard rule)', () => {
    // Scan the operative image entries, not the human-readable _comment (which
    // names the rule and legitimately mentions maroo).
    const blob = JSON.stringify(manifest.images).toLowerCase()
    expect(blob).not.toContain('maroo')
  })
})
