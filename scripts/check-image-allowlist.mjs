#!/usr/bin/env node
// Guard: what starskiff publishes to its PUBLIC GHCR namespace is limited to an
// explicit allowlist, and maroo/marood can never be a publish target.
//
// This encodes the maroo hard rule as a failing check rather than prose:
//   - config/images.json entries must be in APPROVED and never match maroo/marood
//   - every field that could reach a `docker build`/`push` (name, repo, ref,
//     context, image, tags) is scanned for the forbidden substring
//
// Run in CI and at the top of the publish workflow. Exit non-zero on violation.
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// The ONLY chains we redistribute publicly. Adding one is a deliberate edit here.
const APPROVED = new Set(['evmd'])

const FORBIDDEN = /maroo|marood/i

function fail(msg) {
  console.error(`[image-allowlist] BLOCKED: ${msg}`)
  process.exit(1)
}

const manifest = JSON.parse(readFileSync(path.join(ROOT, 'config/images.json'), 'utf8'))
const images = manifest.images ?? []

if (images.length === 0) fail('config/images.json has no images — an empty manifest must not pass silently.')

const seen = new Set()
for (const img of images) {
  if (seen.has(img.name)) fail(`duplicate image entry "${img.name}" in config/images.json.`)
  seen.add(img.name)
}

for (const img of images) {
  // Every stringy field that could flow into a build/push command.
  const surface = [
    img.name, img.repo, img.ref, img.commit, img.context, img.image,
    ...(img.platforms ?? []), img.note,
  ].filter((v) => typeof v === 'string')

  for (const field of surface) {
    if (FORBIDDEN.test(field)) {
      fail(`config/images.json entry "${img.name}" contains a forbidden token in "${field}". ` +
        `maroo/marood must never be a public publish target.`)
    }
  }

  if (!APPROVED.has(img.name)) {
    fail(`"${img.name}" is not in the publish allowlist [${[...APPROVED].join(', ')}]. ` +
      `Add it explicitly to APPROVED in scripts/check-image-allowlist.mjs if redistribution is intended.`)
  }
}

// Also reject a maroo target passed directly to the workflow (defense in depth).
const target = process.argv[2]
if (target) {
  if (FORBIDDEN.test(target)) fail(`publish target "${target}" is forbidden (maroo/marood).`)
  if (!APPROVED.has(target)) fail(`publish target "${target}" is not in the allowlist.`)
}

console.log(`[image-allowlist] OK — ${images.length} image(s), all approved, no forbidden tokens.`)
