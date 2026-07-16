---
"starskiff": minor
---

Image-first: `simd` and `wasmd` now run from an official container image by default.

Following `xplad`/`evmd`, the policy is now image-first — an instance defaults to a
container image wherever a usable, version-pinned one exists:

- `simd` → `ghcr.io/cosmos/simapp:v0.53` (official; the image only tags minor lines,
  so it tracks the latest patch of that line)
- `wasmd` → `cosmwasm/wasmd:v0.61.14` (official, exact version tags)

Both take the shared escape hatches: pass `binary` to run a local executable, or
`image` to bind your own. The exceptions are `hermes` (a relayer, run as a host
process) and the private `marood` (no default image — inject a source).

**Breaking**: `Instance.simd()` and `Instance.wasmd()` now require Docker by default.
Pass `binary: 'simd'` / `binary: 'wasmd'` to keep the previous behaviour.
