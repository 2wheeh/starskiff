# starskiff

HTTP testing instances for Cosmos. Real Cosmos SDK nodes as ephemeral child processes — from a container image or a binary. pnpm workspace: `package/` (the `starskiff` npm package) + `docs/` (vocs site).

## Architecture

```
package/src/
├── index.ts              # Public API: Instance, cosmosBase, cosmosEvmBase, *_DEFAULT_IMAGE, types
├── Instance.ts           # define() lifecycle + re-exports instances
├── cosmos.ts             # cosmosBase()/cosmosEvmBase() — shared chain setup + CosmosChainParameters
├── docker.ts             # container runtime: resolveInstanceImage, run/start args, pull, cleanup
├── process.ts            # tinyexec-based process wrapper
├── utils.ts              # stripColors, toArgs
└── instances/            # simd, wasmd, gaiad, xplad, evmd, marood, hermes
```

### Source policy (image-first)

Every instance routes through `resolveInstanceImage(name, params, defaultImage?)`:

- Usable version-pinned image exists → it's the default (`simd`, `wasmd`, `xplad`, `evmd`).
- No usable image → **injection required**: caller must pass `image` or `binary`; constructing without either throws (`gaiad` — official image lags mainnet; `marood` — private node source, never redistribute).
- `image` and `binary` are mutually exclusive; `binary` opts out of the container runtime.
- `hermes` is the exception: an IBC relayer run as a host binary, outside the container runtime.

Container runtime is NOT orchestration: host temp home bind-mounted at `/chain`, genesis/config patching stays host-side, node runs attached via `docker run` as a child process, ports published 1:1 on `127.0.0.1`.

### Key patterns

- **Instance.define()** — factory pattern from prool. Lifecycle (start/stop/restart), status, events, message buffering.
- **cosmosBase()** — init → genesis patch → keys → gentx → config patch → start → health poll. `cosmosEvmBase()` adds EVM ports/JSON-RPC health.
- **CosmosChainParameters** — base type for all chain instances; EVM chains extend `CosmosEvmChainParameters`.
- **Events** via mitt (on/off only). **Processes** via tinyexec + resolver pattern. **Mnemonic recovery** via spawnSync stdin pipe (docker: `-i`).

### Adding a new chain instance

Follow an existing thin wrapper (`package/src/instances/`): resolve the image (pass a default only if a usable pinned image exists), delegate to `cosmosBase`/`cosmosEvmBase`, re-export from `Instance.ts`. Real-network chains get a bullet on the docs Chains page, not a full doc page.

## Commands

- `pnpm test` / `pnpm test:unit` / `pnpm test:integration` — vitest (integration needs binaries/images; skipped otherwise)
- `pnpm check` — tsc -b (app + tests); `pnpm build` — app only
- `pnpm docs:build` — vocs build (also a CI job)

## Config

- `config/binaries.json` — binaries starskiff's CI provisions (gaiad, hermes, transitional evmd), with a `reason` per entry.
- `config/images.json` — allowlist of images starskiff publishes to GHCR (currently evmd). HARD RULE: maroo/marood must never appear here (`scripts/check-image-allowlist.mjs` enforces).

## Design decisions

- No Pool/Server layer (unlike prool) — Cosmos nodes expose their own RPC/gRPC/API.
- Image-first, but no orchestration — `docker run` in place of exec, still a plain child process.
- cosmosBase handles SDK version differences (v0.47 vs v0.50+ genesis structure).
- patchGenesis hook for chain-specific genesis modifications.
- wasmd is the recommended default (superset: SDK + IBC + CosmWasm); simd for lightweight testing.
