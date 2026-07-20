# starskiff

## 0.6.0

### Minor Changes

- [#11](https://github.com/2wheeh/starskiff/pull/11) [`f1745a0`](https://github.com/2wheeh/starskiff/commit/f1745a0b86159710fc6dc5607c11721f62ce9b67) Thanks [@2wheeh](https://github.com/2wheeh)! - `activeStaticPrecompiles` entries are now stored in genesis in EIP-55
  checksum form (previously lowercased). cosmos/evm forks decide precompile
  activation by comparing the stored strings case-sensitively against
  `address.String()` — lowercasing silently disabled any precompile whose
  address contains a hex letter (empirically: maroo's agent precompile at
  `0x…000A` answered `eth_call` with bare `0x`). The stored list stays
  plain-string sorted, which is what the chain's genesis validation checks.
  The normalization is internal — callers keep passing addresses in any
  casing. `@noble/hashes` becomes a runtime dependency for the keccak-256
  the checksumming needs.

- [#9](https://github.com/2wheeh/starskiff/pull/9) [`65a3ad5`](https://github.com/2wheeh/starskiff/commit/65a3ad5739aa2b668db3aff692d1182e724541a4) Thanks [@2wheeh](https://github.com/2wheeh)! - `mantra` and `xrplevm` now activate their mainnet precompile sets by default.

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

- [#11](https://github.com/2wheeh/starskiff/pull/11) [`f1745a0`](https://github.com/2wheeh/starskiff/commit/f1745a0b86159710fc6dc5607c11721f62ce9b67) Thanks [@2wheeh](https://github.com/2wheeh)! - `marood` now seeds the maroo module genesis params by default, mirroring the
  maroo repo's `local_node.sh`: the `agent` registry addresses, the `eas`
  contract addresses, `pcl.entrypoints` (the Entrypoint v8 preinstall, in
  bech32), and `okrw.mint_denom` per network preset. Previously a bare init
  genesis left these at Go defaults, so the maroo precompiles' constructors
  failed at startup and the precompiles were silently dropped from the EVM's
  available set — consumers had to reverse-engineer the seeding themselves.
  User-specific knobs are new parameters: `policyAdmin` (`pcl.policy_admin`),
  `minterAddress` (`okrw.minter_address`), and `entrypoints` to override the
  default.
  The patch logic is exported as `patchMaroodGenesis` for testing.

  Also:

  - Multi-coin `accounts[].coins` strings are now sorted by denom automatically
    (the SDK rejects unsorted denoms).
  - A failed image pull now throws an actionable error naming the image,
    including docker's stderr tail, and pointing out that locally-built images
    (e.g. a private node image) must be built/loaded before starting.

## 0.5.0

### Minor Changes

- [#3](https://github.com/2wheeh/starskiff/pull/3) [`258251f`](https://github.com/2wheeh/starskiff/commit/258251f6aea1b6962ad17989be0fd867675cab75) Thanks [@2wheeh](https://github.com/2wheeh)! - Publish our own chain images to GHCR, and make `evmd` container-first on one.

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

- [#8](https://github.com/2wheeh/starskiff/pull/8) [`716a3e5`](https://github.com/2wheeh/starskiff/commit/716a3e598b23cd3d919ee3894a9ccfea8203b290) Thanks [@2wheeh](https://github.com/2wheeh)! - `gaiad` is now container-first on the official Cosmos Hub image.

  `ghcr.io/cosmos/gaia` caught up with mainnet — its tags now track the live
  network exactly — so `Instance.gaiad()` runs `ghcr.io/cosmos/gaia:v27.5.0`
  (new `GAIAD_DEFAULT_IMAGE` export) out of the box, joining `simd`/`wasmd`/
  `xplad`/`evmd` as image-backed instances.

  **Breaking**: `Instance.gaiad()` now requires Docker by default. Pass
  `binary: 'gaiad'` to keep running a local binary from PATH.

- [#5](https://github.com/2wheeh/starskiff/pull/5) [`60c3ac5`](https://github.com/2wheeh/starskiff/commit/60c3ac5338ae4a6859d3f8d980df2c693c23970c) Thanks [@2wheeh](https://github.com/2wheeh)! - Image-first: `simd` and `wasmd` now run from an official container image by default.

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

- [#2](https://github.com/2wheeh/starskiff/pull/2) [`cc3b61a`](https://github.com/2wheeh/starskiff/commit/cc3b61a2fc5d98dbb511829f03d06805bbfb13ef) Thanks [@2wheeh](https://github.com/2wheeh)! - Run instances from official chain container images.

  Chains that publish an image that tracks their live network are now
  container-first: `Instance.xplad()` boots `ghcr.io/xpladev/xpla` with no Go
  toolchain and nothing to install but Docker. The image is only where the node
  comes from — the chain CLI still runs against a host-mounted home directory,
  genesis is still patched host-side, and the node still runs as an attached child
  process under starskiff's own lifecycle, so logs, events, ports and URL getters
  are unchanged.

  Every instance accepts an `image` parameter, and container-first instances take
  a `binary` to opt back out:

  ```ts
  Instance.xplad(); // container (default)
  Instance.xplad({ image: "my/xpla:tag" }); // your image
  Instance.xplad({ binary: "xplad" }); // binary on PATH
  Instance.evmd({ image: "my/evmd:dev" }); // image for a binary-default instance
  ```

  **Breaking for `xplad` users**: `Instance.xplad()` now requires Docker. Pass
  `binary: 'xplad'` to keep the previous behaviour.

- [#8](https://github.com/2wheeh/starskiff/pull/8) [`716a3e5`](https://github.com/2wheeh/starskiff/commit/716a3e598b23cd3d919ee3894a9ccfea8203b290) Thanks [@2wheeh](https://github.com/2wheeh)! - New chain instances: `Instance.xrplevm()` and `Instance.mantra()`, both container-first on their official images.

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
  - New internal `finalizeGenesis` hook (cosmosBase): patch genesis _after_
    `collect-gentxs`, for top-level fields the SDK re-marshals on every genesis
    command — used by `xrplevm` to string-encode `initial_height` for CometBFT's
    stricter parser.

- [#6](https://github.com/2wheeh/starskiff/pull/6) [`f65b60b`](https://github.com/2wheeh/starskiff/commit/f65b60bb3119a68b30e905c4d1f59a84e7f7cd22) Thanks [@2wheeh](https://github.com/2wheeh)! - Uniform default-artifact policy: instances without a default image now require injection.

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
  Instance.marood({ binary: "marood" });
  ```

  Also hardened across every chain instance: an explicitly-undefined or empty
  `image` / `binary` (`{ binary: undefined }`, `{ image: '' }`, …) now throws
  instead of silently selecting a runtime.

### Patch Changes

- [#7](https://github.com/2wheeh/starskiff/pull/7) [`ad4e68e`](https://github.com/2wheeh/starskiff/commit/ad4e68eadc8977c78b66b7ee4642b9f215369830) Thanks [@2wheeh](https://github.com/2wheeh)! - evmd default image published and digest-pinned.

  `EVMD_DEFAULT_IMAGE` now points at the published multi-arch (amd64 + arm64)
  image by manifest digest —
  `ghcr.io/2wheeh/starskiff/evmd@sha256:609d198a…` (upstream cosmos/evm v0.7.0) —
  so `Instance.evmd()` works out of the box with just Docker: the image is pulled
  anonymously from GHCR on first use. Previously the default was an unpublished
  tag and required a `binary`/`image` escape hatch.
