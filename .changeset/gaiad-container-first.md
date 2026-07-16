---
"starskiff": minor
---

`gaiad` is now container-first on the official Cosmos Hub image.

`ghcr.io/cosmos/gaia` caught up with mainnet — its tags now track the live
network exactly — so `Instance.gaiad()` runs `ghcr.io/cosmos/gaia:v27.5.0`
(new `GAIAD_DEFAULT_IMAGE` export) out of the box, joining `simd`/`wasmd`/
`xplad`/`evmd` as image-backed instances.

**Breaking**: `Instance.gaiad()` now requires Docker by default. Pass
`binary: 'gaiad'` to keep running a local binary from PATH.
