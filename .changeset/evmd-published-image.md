---
"starskiff": minor
---

Publish our own chain images to GHCR, and make `evmd` container-first on one.

Some cosmos-evm chains ship no usable image (cosmos/evm publishes none; others lag
mainnet). For those, starskiff now builds a multi-arch (amd64 + arm64) image from a
pinned upstream source and pushes it to its public GHCR namespace
(`ghcr.io/2wheeh/starskiff/<chain>`), which is free to store and pull. What we publish
is an explicit allowlist in `config/images.json` — the single source of truth for both
the publish workflow and the instance default.

`Instance.evmd()` is now container-first on `EVMD_DEFAULT_IMAGE`
(`ghcr.io/2wheeh/starskiff/evmd`), so it needs no Go toolchain — just Docker. Escape
hatches match every instance: `{ image }` to bind your own, `{ binary: 'evmd' }` for a
local binary. Passing both `image` and `binary` now throws (they select mutually
exclusive runtimes).

**maroo is never published**: its node source is private. It stays local-only (inject
your own image/binary), enforced by a CI guard that fails on any `maroo`/`marood`
publish target.

**Breaking for `evmd` users**: `Instance.evmd()` now requires Docker. Pass
`binary: 'evmd'` to keep the previous behaviour.

**Operational note**: the default image must be published (run the `publish-images`
workflow) and its digest pinned in `config/images.json` + `EVMD_DEFAULT_IMAGE` before
the default path works in a fresh environment. Until then, use `{ binary: 'evmd' }` or a
locally-built image tag.
