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
| `Instance.gaiad()`  | binary `gaiad`                         | Cosmos Hub (IBC)                                | IBC counterparty chain         |
| `Instance.xplad()`  | image `ghcr.io/xpladev/xpla`           | Cosmos SDK + **EVM** + CosmWasm                 | XPLA testing, EVM JSON-RPC     |
| `Instance.evmd()`   | image `ghcr.io/2wheeh/starskiff/evmd`  | Cosmos SDK + **EVM** (cosmos/evm reference)     | Canonical cosmos-evm precompiles |
| `Instance.marood()` | binary `marood`                        | Cosmos SDK + **EVM** + maroo modules            | maroo chain (viem `marooTestnet`) |
| `Instance.hermes()` | binary `hermes`                        | — (IBC relayer)                                 | Relaying between two instances |

Image-backed instances run the node from a container by default (Docker required); pass `binary` to run a local executable, or `image` to bind your own. Binary-default **chain** instances accept `image` too (`hermes` is a relayer, not a chain node, so it has no image runtime). See the docs [container runtime guide](./../docs/src/pages/docs/guides/docker.mdx).

> `evmd`'s default image is built by the `publish-images` workflow; until it's published and digest-pinned, run `Instance.evmd({ binary: 'evmd' })` or point `image` at a locally-built tag.

## Install

```bash
pnpm add -D starskiff
```

### Prerequisites

Image-backed instances (`simd`, `wasmd`, `xplad`, `evmd`) need only a running **Docker** — the image is pulled on first use. Binary-backed instances (`gaiad`, `hermes`, and the private `marood`) need their executable on `PATH`; download an official release or build from source, e.g.:

```bash
# gaiad — official release binary
gh release download v27.5.0 --repo cosmos/gaia --pattern "gaiad-v27.5.0-linux-amd64" --dir /tmp
install -m755 /tmp/gaiad-v27.5.0-linux-amd64 ~/go/bin/gaiad
```

Any instance also accepts a `binary` (local executable) or `image` (custom tag) override — the [escape hatch](./../docs/src/pages/docs/guides/docker.mdx#escape-hatches) for local development, e.g. running an image-backed chain from a source build without Docker.

See the [CI guide](./../docs/src/pages/docs/guides/ci.mdx) for provisioning binaries on GitHub Actions.

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
| `start()`             | Start the instance. Returns a stop function.                           |
| `stop()`              | Stop the instance and cleanup temp directory.                          |
| `restart()`           | Stop then start.                                                       |
| `on(event, handler)`  | Listen to events (`message`, `stdout`, `stderr`, `listening`, `exit`). |
| `off(event, handler)` | Remove event listener.                                                 |

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

## TODO

- [ ] `starskiff.config.ts` — config-based chain + relayer declaration
- [ ] `starskiff/vitest` — vitest plugin (automatic setup/teardown via `vitestPlugin(config)`)
- [ ] `starskiff/playwright` — playwright plugin (`playwrightPlugin(config)`)
- [ ] `starskiff/setup-binaries` GitHub Action for CI binary setup

Shipped: `cosmosEvmBase` (EVM JSON-RPC instances), `findFreePorts()` (port allocation), the container runtime (`image` parameter).

## License

MIT
