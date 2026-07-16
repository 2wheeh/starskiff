---
"starskiff": minor
---

Uniform default-artifact policy: instances without a default image now require injection.

Every chain instance is image-first (the `hermes` relayer stays a host binary).
Where a usable, version-pinned image exists we set it as the default; where none
exists the node source is **required** — pass `image` (a container image ref) or
`binary` (a local executable on PATH). Chain instances no longer have an
implicit binary default.

**Breaking**: `Instance.marood()` (private node source) now throws at
construction unless `image` or `binary` is passed. Previously it silently
defaulted to a `marood` binary on PATH. Migrate by making the old default
explicit:

```ts
Instance.marood({ binary: 'marood' })
```

Also hardened across every chain instance: an explicitly-undefined or empty
`image` / `binary` (`{ binary: undefined }`, `{ image: '' }`, …) now throws
instead of silently selecting a runtime.
