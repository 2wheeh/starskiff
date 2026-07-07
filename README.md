# starskiff

> [!WARNING]
> This project is under active development. APIs may change without notice until v1.0.

Real Cosmos SDK nodes as ephemeral test instances — spawned as child processes, no Docker, no Kubernetes.

starskiff is the lightweight skiff to [Starship](https://github.com/cosmology-tech/starship)'s heavy vessel: where Starship stands up multi-chain environments on Kubernetes, starskiff boots a single real chain node in seconds — for integration tests and CI. Not a mock; the actual Go binary.

Inspired by [prool](https://github.com/wevm/prool) (test instances for Ethereum).

## Features

- Spawn real Cosmos SDK nodes as child processes
- No Docker, no Kubernetes — just a Go binary
- Genesis account injection with mnemonic recovery
- Full lifecycle management (start/stop/restart)
- Compatible with [@cosmjs/stargate](https://github.com/cosmos/cosmjs) and [@cosmjs/cosmwasm-stargate](https://github.com/cosmos/cosmjs) for testing
- Extensible to any Cosmos SDK chain binary via `cosmosBase`

## Instances

| Instance           | Binary  | Modules                                         | Use case                     |
| ------------------ | ------- | ----------------------------------------------- | ---------------------------- |
| `Instance.simd()`  | `simd`  | bank, staking, gov, mint                        | Basic Cosmos SDK testing     |
| `Instance.wasmd()` | `wasmd` | bank, staking, gov, mint, **IBC**, **CosmWasm** | Contract deploy/execute, IBC |

## Install

```bash
pnpm add -D starskiff
```

### Prerequisites

Install the binary for the instance you need. Requires [Go](https://go.dev/dl/) >= 1.25.

**simd** (Cosmos SDK simapp):

```bash
git clone --depth 1 https://github.com/cosmos/cosmos-sdk.git /tmp/cosmos-sdk
cd /tmp/cosmos-sdk/simapp && go build -o ~/go/bin/simd ./simd/
```

**wasmd** (CosmWasm — includes IBC):

```bash
git clone --depth 1 https://github.com/CosmWasm/wasmd.git /tmp/wasmd
cd /tmp/wasmd && go build -o ~/go/bin/wasmd ./cmd/wasmd/
```

### Prebuilt binaries (CI)

Prebuilt `linux/amd64` binaries are available in [GitHub Releases](https://github.com/2wheeh/starskiff/releases/tag/binaries/latest) for CI environments:

```bash
# Download and install (e.g. in GitHub Actions)
gh release download "binaries/latest" --repo 2wheeh/starskiff --pattern "*.gz" --dir /tmp
gunzip -c /tmp/simd-linux-amd64.gz > /usr/local/bin/simd
gunzip -c /tmp/wasmd-linux-amd64.gz > /usr/local/bin/wasmd
chmod +x /usr/local/bin/simd /usr/local/bin/wasmd
```

> For local development on macOS/Windows, build from source using the instructions above.

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
const client = await StargateClient.connect(`http://localhost:${instance.port}`);
const balance = await client.getBalance(address, 'stake');

await instance.stop();
```

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

const client = await SigningCosmWasmClient.connectWithSigner(`http://localhost:${instance.port}`, wallet, {
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

  provide('rpcUrl', `http://localhost:${instance.port}`);

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

```ts
const chain1 = Instance.wasmd({
  chainId: 'wasm-1',
  rpcPort: 26657,
  grpcPort: 9090,
  apiPort: 1317,
  p2pPort: 26656,
});

const chain2 = Instance.wasmd({
  chainId: 'wasm-2',
  rpcPort: 26660,
  grpcPort: 9092,
  apiPort: 1318,
  p2pPort: 26661,
});

await Promise.all([chain1.start(), chain2.start()]);
```

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
| Infra        | Kubernetes + Helm + Docker | None (child process) |
| Startup      | 2-5 min                    | 3-5 sec              |
| Dependencies | K8s cluster                | Go binary            |
| State reset  | Helm redeploy (minutes)    | kill + restart (~3s) |
| Best for     | Production simulation      | Dev/test             |

## TODO

- [ ] `cosmosEvmBase` — EVM JSON-RPC port support for EVM-enabled chains (e.g. xpla, evmos)
- [ ] `starskiff.config.ts` — config-based chain + relayer declaration
- [ ] `starskiff/vitest` — vitest plugin (automatic setup/teardown via `vitestPlugin(config)`)
- [ ] `starskiff/playwright` — playwright plugin (`playwrightPlugin(config)`)
- [ ] Automatic port allocation (avoid port conflicts in parallel tests)
- [ ] `findFreePorts()` utility for direct `Instance` users
- [ ] `starskiff/setup-binaries` GitHub Action for CI binary setup

## License

MIT
