---
"starskiff": patch
---

evmd default image published and digest-pinned.

`EVMD_DEFAULT_IMAGE` now points at the published multi-arch (amd64 + arm64)
image by manifest digest —
`ghcr.io/2wheeh/starskiff/evmd@sha256:609d198a…` (upstream cosmos/evm v0.7.0) —
so `Instance.evmd()` works out of the box with just Docker: the image is pulled
anonymously from GHCR on first use. Previously the default was an unpublished
tag and required a `binary`/`image` escape hatch.
