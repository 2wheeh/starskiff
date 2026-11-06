# starskiff

> [!WARNING]
> This project is under active development. APIs may change without notice until v1.0.

Real Cosmos SDK nodes as ephemeral test instances — run from a local binary or an official chain image, no Kubernetes.

starskiff is the lightweight skiff to [Starship](https://github.com/cosmology-tech/starship)'s heavy vessel: where Starship stands up multi-chain environments on Kubernetes, starskiff boots a single real chain node in seconds — for integration tests and CI. Not a mock; the actual node. Each instance runs as a child process, sourced either from a binary on `PATH` or a container image (`docker run`, still a plain child process — no orchestrator).

Inspired by [prool](https://github.com/wevm/prool) (test instances for Ethereum).

## Features

- Spawn real Cosmos SDK nodes as child processes — from a binary or a container image
- No Kubernetes, no orchestration — just a process
- Genesis account injection with mnemonic recovery
- Full lifecycle management (start/stop/restart)
- Compatible with [@cosmjs/stargate](https://github.com/cosmos/cosmjs) and [@cosmjs/cosmwasm-stargate](https://github.com/cosmos/cosmjs), and viem for EVM chains
- Extensible to any Cosmos SDK chain binary via `cosmosBase` / `cosmosEvmBase`

## Instances

| Instance            | Source (default)                       | Modules                                         | Use case                       |
| ------------------- | -------------------------------------- | ----------------------------------------------- | ------------------------------ |
| `Instance.wasmd()`  | image `cosmwasm/wasmd`                 | bank, staking, gov, mint, **IBC**, **CosmWasm** | Contract deploy/execute, IBC   |
| `Instance.simd()`   | image `ghcr.io/cosmos/simapp`          | bank, staking, gov, mint                        | Lightweight Cosmos SDK testing |
| `Instance.gaiad()`  | image `ghcr.io/cosmos/gaia`            | Cosmos Hub (IBC)                                | IBC counterparty chain         |
| `Instance.provenanced()` | image `provenanceio/provenance` | Provenance SDK + CosmWasm | HASH and Provenance module testing |
| `Instance.cronosd()` | **required** — `image` or `binary` | Cronos SDK + **EVM** | Cronos testing (eth 25) |
| `Instance.dydxprotocold()` | **required** — `image` or `binary` | dYdX v4 SDK | SDK APIs and genesis fixtures |
| `Instance.seid()` | image `ghcr.io/sei-protocol/sei` | Sei SDK + **EVM** + CosmWasm | Sei testing (local eth 713714) |
| `Instance.thornode()` | image `registry.gitlab.com/thorchain/thornode` (amd64-only) | THORChain SDK | Single-validator THORChain testing |
| `Instance.xplad()`  | image `ghcr.io/xpladev/xpla`           | Cosmos SDK + **EVM** + CosmWasm                 | XPLA testing, EVM JSON-RPC     |
| `Instance.mantra()` | image `ghcr.io/mantra-chain/mantrachain` | Cosmos SDK + **EVM** + CosmWasm               | MANTRA testing (eth 5888)      |
| `Instance.xrplevm()` | image `peersyst/exrp` (amd64-only)    | Cosmos SDK + **EVM** (cosmos/evm)               | XRPL EVM testing (eth 1440000) |
| `Instance.evmd()`   | image `ghcr.io/2wheeh/starskiff/evmd`  | Cosmos SDK + **EVM** (cosmos/evm reference)     | Canonical cosmos-evm precompiles |
| `Instance.marood()` | **required** — `image` or `binary` (private) | Cosmos SDK + **EVM** + maroo modules      | maroo chain (viem `marooTestnet`) |
| `Instance.hermes()` | binary `hermes`                        | — (IBC relayer)                                 | Relaying between two instances |

Every instance is **image-first**: where a usable, version-pinned image exists it's the default (Docker required); pass `binary` to run a local executable, or `image` to bind your own. The two overrides are mutually exclusive in TypeScript and at runtime. Where none exists (`cronosd`, `dydxprotocold`, and the private `marood` node) exactly one source is **required** by its TypeScript signature, with runtime validation retained for JavaScript callers. `hermes` is a relayer run as a host binary, not a chain node. See the docs [container runtime guide](./../docs/src/pages/docs/guides/docker.mdx).

> `evmd`'s default image is built from cosmos/evm source by the `publish-images` workflow and pinned by multi-arch manifest **digest** — the default always resolves to the exact published artifact.

## Install

```bash
pnpm add -D starskiff
```

starskiff is ESM-only and supports Node.js 22 or newer.

### Prerequisites

Image-backed instances (`simd`, `wasmd`, `gaiad`, `xplad`, `xrplevm`, `mantra`, `evmd`, `provenanced`, `seid`, `thornode`) need a running **Docker** — the image is pulled on first use. THORChain's image is amd64-only; arm64 hosts need emulation. The `hermes` relayer needs its binary on `PATH` (official releases at [informalsystems/hermes](https://github.com/informalsystems/hermes/releases)); `cronosd`, `dydxprotocold`, and `marood` need an injected image or binary.

Cronos is tested with [v1.8.0](https://github.com/crypto-org-chain/cronos/releases/tag/v1.8.0). dYdX is tested with [v9.8.1](https://github.com/dydxprotocol/v4-chain/releases/tag/protocol/v9.8.1), available as Linux binaries. Its external price, bridge, liquidation and oracle daemons are disabled; trading markets are not provisioned. THORChain boots a single unbonded validator without Bifrost or vault signing. Sei uses local chain ID `starskiff-sei-1` (EVM 713714); public-network IDs are rejected to avoid loading embedded mainnet/testnet genesis. See [Chains](./../docs/src/pages/docs/chains.mdx) for chain-specific behavior.

Any instance also accepts a `binary` (local executable) or `image` (custom tag) override — the [escape hatch](./../docs/src/pages/docs/guides/docker.mdx#escape-hatches) for local development, e.g. running an image-backed chain from a source build without Docker.

See the [CI guide](./../docs/src/pages/docs/guides/ci.mdx) for provisioning binaries on GitHub Actions.

### maroo v0.11

Supply a node source, a fresh Privacy V4 genesis JSON file, and the matching
Clairveil v0.6.1 audit-field artifact directory:

```ts
const maroo = Instance.marood({
  image: 'ghcr.io/hashed-open-finance/maroo:v0.11.0',
  privacyGenesis: '/absolute/path/to/privacy-genesis.json',
  privacyZkArtifacts: {
    directory: '/absolute/path/to/clairveil-v0.6.1-artifacts',
  },
});
await maroo.start();
// maroo.rpcUrl / maroo.apiUrl / maroo.evmUrl
await maroo.stop();
```

`privacyGenesis` points to a JSON file containing the public `GenesisStateV4`
object, rather than an entire chain `genesis.json`. Prepare it for the instance's
Cosmos chain ID, initial height **1**, and native fee denom. The default testnet preset uses
`maroo_450815-1` and `atokrw`; the mainnet preset uses `maroo_815-1` and `aokrw`.
The audit key's PoP binds to the chain ID, nonce, and height. Starskiff installs
this JSON before gentx and leaves cryptographic validation to marood.

Prepare the bundle and public genesis using maroo's bootstrap tooling before
running the tests. Starskiff does not generate keys, proofs, or trusted setup.
The artifacts must match the genesis circuit identity. Docker receives a
read-only directory mount and strict/development environment settings; local
binaries receive the host path. Omit `privacyZkArtifacts` only when the image
already contains and configures the matching artifacts. Published maroo images
contain the node binary and require artifacts to be supplied separately.

For private GHCR packages, log Docker in before running tests and grant each
consumer repository Read access under the package's **Manage Actions access**.
Starskiff uses Docker's existing credentials and pulls missing images.

The default preinstalls include ERC-4337 EntryPoint v0.6/v0.8/v0.9 and corrected
EAS runtime code. `policyAdmin` sets the PCL module admin and creates or updates
the Privacy contract-policy owner; `minterAddress` sets the OKRW mint/burn admin.

## Usage

### Basic (simd)

```ts
import { Instance } from 'starskiff';

const instance = Instance.simd({
  chainId: 'test-1',
  denom: 'stake',
  accounts: [
    {
      mnemonic: 'abandon abandon abandon ...',
      coins: '1000000000stake',
      name: 'alice',
    },
  ],
});

await instance.start();

// Connect with cosmjs
import { StargateClient } from '@cosmjs/stargate';
const client = await StargateClient.connect(instance.rpcUrl);
const balance = await client.getBalance(address, 'stake');

await instance.stop();
```

### Test accounts

Skip deriving your own dev mnemonic — `testAccounts` ships a handful of
well-known, publicly-documented BIP39 mnemonics with addresses pre-derived
for the `cosmos` bech32 prefix:

```ts
import { Instance, testAccounts } from 'starskiff';

const [alice, bob] = testAccounts;

const instance = Instance.simd({
  chainId: 'test-1',
  accounts: [{ mnemonic: alice.mnemonic, coins: '1000000000stake', name: alice.name }],
});
```

These mnemonics are public — never fund them with real value. Addresses
assume the `cosmos` prefix; chains configured with a different `prefix`
(e.g. `osmo`, `xpla`) need addresses re-derived from the same mnemonic.

### CosmWasm (wasmd)

```ts
import { Instance } from 'starskiff';
import { SigningCosmWasmClient } from '@cosmjs/cosmwasm-stargate';
import { GasPrice } from '@cosmjs/stargate';

const instance = Instance.wasmd({
  chainId: 'wasm-test-1',
  accounts: [{ mnemonic: '...', coins: '1000000000stake', name: 'alice' }],
});
await instance.start();

const client = await SigningCosmWasmClient.connectWithSigner(instance.rpcUrl, wallet, {
  gasPrice: GasPrice.fromString('0stake'),
});

// Upload, instantiate, execute
const { codeId } = await client.upload(address, wasmBytecode, 'auto');
const { contractAddress } = await client.instantiate(address, codeId, initMsg, 'label', 'auto');
const result = await client.execute(address, contractAddress, executeMsg, 'auto');
```

### vitest globalSetup (provide/inject)

```ts
// test/global-setup.ts
import type { TestProject } from 'vitest/node';
import { Instance } from 'starskiff';

export default async function setup({ provide }: TestProject) {
  const instance = Instance.wasmd({
    chainId: 'test-1',
    accounts: [{ mnemonic: '...', coins: '1000000000stake' }],
  });
  await instance.start();

  provide('rpcUrl', instance.rpcUrl);

  return () => instance.stop();
}

declare module 'vitest' {
  export interface ProvidedContext {
    rpcUrl: string;
  }
}
```

```ts
// vitest.config.ts
export default defineConfig({
  test: {
    globalSetup: './test/global-setup.ts',
  },
});
```

```ts
// test/bank.test.ts
import { inject } from 'vitest';

const rpcUrl = inject('rpcUrl');

it('queries balance', async () => {
  const client = await StargateClient.connect(rpcUrl);
  const balance = await client.getBalance(address, 'stake');
  // ...
});
```

### Multi-chain

Hand-assigning ports gets tedious (and error-prone) once you run more than one
chain — use `findFreePorts()` instead:

```ts
import { findFreePorts, Instance } from 'starskiff';

const [ports1, ports2] = await Promise.all([findFreePorts(), findFreePorts()]);

const chain1 = Instance.wasmd({ chainId: 'wasm-1', ...ports1 });
const chain2 = Instance.wasmd({ chainId: 'wasm-2', ...ports2 });

await Promise.all([chain1.start(), chain2.start()]);
```

Each `findFreePorts()` call returns a `PortSet` of distinct, currently-free
ports (`rpcPort`, `grpcPort`, `apiPort`, `p2pPort`, `grpcWebPort`,
`pprofPort`). Pass `{ evm: true }` to also grab an `evmPort` for EVM-enabled
chains (e.g. `xplad`, `evmd`). Note the TOCTOU caveat: a port is free at grab
time, but nothing stops another process from binding it before the instance
actually starts — rare, but possible under heavy concurrent test runs.

### Custom chain binary

```ts
import { Instance, cosmosBase } from 'starskiff';

// Any Cosmos SDK binary works — same init/genesis/start flow
const gaiad = Instance.define(params => cosmosBase({ binary: 'gaiad', name: 'gaiad', ...params }));
```

## API

### `Instance.simd(parameters?, options?)`

Creates a simd (Cosmos SDK simapp) instance.

### `Instance.wasmd(parameters?, options?)`

Creates a wasmd (CosmWasm + IBC) instance. Same parameters as simd.

### Parameters

Shared by all instances (`CosmosChainParameters`):

| Parameter          | Type              | Default           | Description        |
| ------------------ | ----------------- | ----------------- | ------------------ |
| `binary`           | `string`          | instance-specific | Path to binary     |
| `chainId`          | `string`          | `"starskiff-1"`     | Chain ID           |
| `denom`            | `string`          | `"stake"`         | Default denom      |
| `accounts`         | `CosmosAccount[]` | `[]`              | Genesis accounts   |
| `minimumGasPrices` | `string`          | `"0{denom}"`      | Minimum gas prices |
| `rpcPort`          | `number`          | `26657`           | CometBFT RPC port  |
| `grpcPort`         | `number`          | `9090`            | gRPC port          |
| `apiPort`          | `number`          | `1317`            | REST API port      |
| `p2pPort`          | `number`          | `26656`           | P2P port           |
| `grpcWebPort`      | `number`          | `9091`            | gRPC-Web port      |
| `pprofPort`        | `number`          | `6060`            | pprof port         |

### Instance options (second argument)

| Option          | Type     | Default | Description                        |
| --------------- | -------- | ------- | ---------------------------------- |
| `messageBuffer` | `number` | `20`    | Max messages to store in-memory    |
| `timeout`       | `number` | `60000` | Start/stop timeout in milliseconds |

```ts
const instance = Instance.wasmd({ chainId: 'test-1' }, { timeout: 30_000 });
```

### Instance methods

| Method                | Description                                                            |
| --------------------- | ---------------------------------------------------------------------- |
| `start()`             | Start the instance; resolves when it is ready.                         |
| `stop()`              | Stop the instance and cleanup temp directory.                          |
| `restart()`           | Stop then start.                                                       |
| `on(event, handler)`  | Listen to events (`message`, `stdout`, `stderr`, `listening`, `exit`). |
| `off(event, handler)` | Remove event listener.                                                 |

Instances also implement `Symbol.asyncDispose`, so `await using` scopes stop
them automatically:

```ts
await using instance = Instance.wasmd();
await instance.start();
```

### Instance properties

| Property   | Type     | Description                                                             |
| ---------- | -------- | ----------------------------------------------------------------------- |
| `status`   | `string` | `idle` / `starting` / `started` / `stopping` / `stopped` / `restarting` |
| `host`     | `string` | Host (default: `localhost`)                                             |
| `port`     | `number` | RPC port                                                                |
| `name`     | `string` | Instance name                                                           |
| `messages` | `object` | `.get()` returns buffered messages, `.clear()` clears them              |

### URL getters

Cosmos instances (`simd`, `wasmd`, `xplad`, `evmd`, and anything built on
`cosmosBase`) also expose ready-to-use endpoint URLs — no more manually
templating `http://localhost:${instance.port}`:

| Property  | Type     | Description                                              |
| --------- | -------- | ---------------------------------------------------------|
| `rpcUrl`  | `string` | `http://{host}:{port}` — CometBFT RPC endpoint            |
| `grpcUrl` | `string` | `http://{host}:{grpcPort}` — gRPC endpoint                |
| `apiUrl`  | `string` | `http://{host}:{apiPort}` — REST (Cosmos SDK API) endpoint |
| `evmUrl`  | `string` | `http://{host}:{evmPort}` — EVM JSON-RPC endpoint (EVM instances only, e.g. `xplad`, `evmd`) |

```ts
const client = await StargateClient.connect(instance.rpcUrl);
```

## Testing strategies

| Strategy                 | Isolation | Speed     | Use case                                    |
| ------------------------ | --------- | --------- | ------------------------------------------- |
| **Account isolation**    | Practical | Fast      | Most tests — each test uses unique accounts |
| **Suite-level instance** | Full      | ~5s setup | Tests that modify chain-wide state          |
| **Shared instance**      | None      | Fastest   | Read-only queries, smoke tests              |

Recommended: fund multiple accounts in genesis, assign each test its own account(s).

## Why not Starship?

|              | Starship                   | starskiff              |
| ------------ | -------------------------- | -------------------- |
| Infra        | Kubernetes + Helm + Docker | None — child process (binary or `docker run`) |
| Startup      | 2-5 min                    | 3-5 sec              |
| Dependencies | K8s cluster                | A binary or Docker   |
| State reset  | Helm redeploy (minutes)    | kill + restart (~3s) |
| Best for     | Production simulation      | Dev/test             |

## Roadmap

See the [roadmap to v1.0](https://github.com/2wheeh/starskiff/blob/main/ROADMAP.md) for planned API, runtime, artifact, and integration work.

## License

MIT
