---
"starskiff": minor
---

`mantra` and `xrplevm` now activate their mainnet precompile sets by default.

A fresh `init` on cosmos/evm chains leaves `active_static_precompiles` empty,
so local `mantra`/`xrplevm` instances booted with every precompile disabled —
unlike their mainnets. Both instances now default to the set active on the
live network (queried from `mantra-1` / `xrplevm_1440000-1`), exported as
`MANTRA_DEFAULT_PRECOMPILES` and `XRPLEVM_DEFAULT_PRECOMPILES`. The
`activeStaticPrecompiles` parameter still overrides (same three-state
semantics as evmd/xplad).

Also fixes the docs build's twoslash support: the default ESNext target made
`@typescript/vfs` request `lib.es2025.*` files that typescript 5.9 doesn't
ship, failing every `ts twoslash` block; the docs site now pins the twoslash
target to ES2024 and enables twoslash on the flagship snippets.
