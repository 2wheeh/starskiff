# starskiff

HTTP testing instances for Cosmos. Lightweight Cosmos SDK node management via child processes.

## Architecture

```
src/
├── index.ts              # Public API: export { Instance, cosmosBase, types }
├── Instance.ts           # define() lifecycle + re-exports instances (Instance.simd, Instance.wasmd)
├── cosmos.ts             # cosmosBase() — shared Cosmos SDK chain setup + CosmosChainParameters
├── process.ts            # tinyexec-based process wrapper
├── utils.ts              # stripColors, toArgs
└── instances/
    ├── simd.ts           # Thin wrapper: cosmosBase({ binary: 'simd' })
    └── wasmd.ts          # Thin wrapper: cosmosBase({ binary: 'wasmd' })
```

### Key patterns

- **Instance.define()** — factory pattern from prool. Manages lifecycle (start/stop/restart), status transitions, event emitting, message buffering.
- **cosmosBase()** — shared setup for any Cosmos SDK binary: init → genesis patch → keys → gentx → config patch → start → health poll.
- **CosmosChainParameters** — base type for all chain instances. SimdParameters and WasmdParameters extend it.
- **Instance wrappers** (simd.ts, wasmd.ts) are thin: just set binary name + defaults, delegate to cosmosBase.
- **Events** via mitt (on/off only, no once/addListener).
- **Process management** via tinyexec with resolver pattern for startup detection.
- **Mnemonic recovery** via spawnSync with stdin pipe (tinyexec doesn't support stdin).

### Adding a new chain instance

```ts
// src/instances/gaiad.ts
import { CosmosChainParameters } from '../cosmos.js'

export type GaiadParameters = CosmosChainParameters & {
  binary?: string
}

export const gaiad = Instance.define((parameters?: GaiadParameters) => {
  const { binary = 'gaiad', ...rest } = parameters || {}
  return cosmosBase({ binary, name: 'gaiad', ...rest })
})
```

Then re-export from Instance.ts: `export { gaiad } from './instances/gaiad.js'`

## Commands

- `pnpm test` — run vitest (unit + integration)
- `pnpm build` — tsc build (app only)
- `pnpm check` — tsc -b (app + test type checking)
- Integration tests require binaries in PATH (skipped otherwise)

## Dependencies

- **tinyexec** — process spawning (not execa, not raw child_process)
- **mitt** — events (not eventemitter3)
- **@cosmjs/stargate + @cosmjs/proto-signing + @cosmjs/cosmwasm-stargate** — dev deps for integration tests

## Design decisions

- No Pool/Server layer (unlike prool) — Cosmos nodes expose their own RPC/gRPC/API, proxy unnecessary
- No Docker — child process only
- cosmosBase handles SDK version differences (v0.47 vs v0.50+ genesis structure)
- patchGenesis hook for chain-specific genesis modifications
- wasmd is the recommended default (superset: SDK + IBC + CosmWasm)
- simd for lightweight testing when wasm/IBC not needed
