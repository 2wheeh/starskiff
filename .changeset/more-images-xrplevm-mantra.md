---
"starskiff": minor
---

New chain instances: `Instance.xrplevm()` and `Instance.mantra()`, both container-first on their official images.

- `xrplevm` — XRPL EVM sidechain (cosmos/evm), official `peersyst/exrp` image pinned
  to the mainnet version. Defaults mirror mainnet: `xrplevm_1440000-1`, `eth_chainId`
  1440000, 18-decimal `axrp`, `ethm` prefix. The image is amd64-only; on arm64 hosts
  pre-pull with `docker pull --platform linux/amd64` or pass a `binary`.
- `mantra` — MANTRA chain (cosmos/evm + CosmWasm), official multi-arch
  `ghcr.io/mantra-chain/mantrachain` image pinned to the mainnet version. Defaults
  mirror mainnet: `mantra-1`, `eth_chainId` 5888, 18-decimal `amantra`.

Container runtime hardening that made these (and any future image) work:

- `docker run` now pins `--entrypoint` to the chain binary, so images that wrap
  their binary in a shell entrypoint (e.g. `peersyst/exrp`'s `/bin/sh -ec`) no
  longer swallow CLI arguments.
- Containers get `TMPDIR` pointed at the mounted home, so binaries that create
  temp dirs at startup (CosmWasm chains like `mantrachaind`) work under `--user`
  even when the image's `/tmp` isn't writable.
- New internal `finalizeGenesis` hook (cosmosBase): patch genesis *after*
  `collect-gentxs`, for top-level fields the SDK re-marshals on every genesis
  command — used by `xrplevm` to string-encode `initial_height` for CometBFT's
  stricter parser.
