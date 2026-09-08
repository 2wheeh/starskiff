import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import * as Instance from './Instance.js'
import { commandErrorMessage, createCommandRunner, type CommandRunner } from './command.js'
import { sortCoins, toChecksumAddress } from './utils.js'
import { CONTAINER_HOME } from './docker.js'
import type { RuntimeOptions } from './runtime.js'

/**
 * Runtime inputs required by a custom Cosmos chain. Environment settings
 * apply to every local and container command; read-only mounts apply only to
 * container commands.
 */
export type CosmosRuntimeOptions = RuntimeOptions

export type CosmosAccount = {
  /** BIP39 mnemonic for key derivation. */
  mnemonic: string
  /**
   * Coins to fund (e.g. "1000000000stake"). Multi-coin strings are allowed;
   * denoms are sorted for you (the SDK requires ascending order).
   */
  coins: string
  /** Account name for keyring. @default "test-{index}" */
  name?: string
}

/** Default pk proto URL for ethermint-derivation chains (cosmos-evm module). */
export const DEFAULT_COSMOS_EVM_PK_TYPE_URL = '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey'

const EVM_CHAIN_ID_FLAG = '--evm.evm-chain-id'

/**
 * Hermes relayer hints advertised by an instance. Mirrors the `AddressType`
 * enum in ibc-rs: `cosmos` is a unit variant (secp256k1 only, no custom
 * pk_type possible at the Hermes level), `ethermint` carries a `pk_type` URL.
 *
 * Instances get their defaults from `cosmosBase` / `cosmosEvmBase` and can
 * override per-instance via the `relayerHints` parameter.
 */
export type CosmosRelayerHints =
  | {
      /** @default 'cosmos' */
      addressDerivation?: 'cosmos'
      /** @default "m/44'/118'/0'/0/0" */
      hdPath?: string
    }
  | {
      addressDerivation: 'ethermint'
      /** @default "m/44'/60'/0'/0/0" */
      hdPath?: string
      /** @default {@link DEFAULT_COSMOS_EVM_PK_TYPE_URL} */
      pkTypeUrl?: string
    }

/** Common parameters shared by all Cosmos SDK chain instances. */
export type CosmosChainParameters = {
  /** Chain ID. @default "starskiff-1" */
  chainId?: string
  /** Default denom. @default "stake" */
  denom?: string
  /** Bech32 address prefix. @default "cosmos" */
  prefix?: string
  /** Accounts to fund in genesis. */
  accounts?: CosmosAccount[]
  /** Minimum gas prices. @default "0{denom}" */
  minimumGasPrices?: string
  /** Validator account initial balance (amount only, denom appended). @default "100000000000" */
  validatorBalance?: string
  /** Validator self-delegation amount (amount only, denom appended). @default "10000000" */
  validatorStake?: string
  /**
   * Number of ADDITIONAL validators to create at genesis, beyond the default
   * one (keys `validator-1`, `validator-2`, …). Each gets its own consensus key
   * and is funded with `validatorBalance` / self-delegates `validatorStake`.
   * Needed by tests that require multiple bonded validators (e.g. redelegation).
   * @default 0
   */
  extraValidators?: number
  /** RPC listen address port. @default 26657 */
  rpcPort?: number
  /** gRPC listen port. @default 9090 */
  grpcPort?: number
  /** API (REST) listen port. @default 1317 */
  apiPort?: number
  /** P2P listen port. @default 26656 */
  p2pPort?: number
  /** Legacy gRPC-Web listen port. Newer SDKs share apiPort. @default 9091 */
  grpcWebPort?: number
  /** pprof listen port. @default 6060 */
  pprofPort?: number
  /**
   * Hermes relayer hints. Usually set by the instance wrapper (e.g.
   * `cosmosEvmBase`), callers only override for custom chains.
   */
  relayerHints?: CosmosRelayerHints
  /**
   * Run the node from a container image instead of a binary on `PATH`
   * (e.g. `"ghcr.io/xpladev/xpla:v1.10.0"`).
   *
   * Chains that publish an official image default to it — no Go toolchain, no
   * `go build`, and the image is the artifact the network itself ships. Docker
   * must be running.
   *
   * The image is only the *source of the node*: starskiff still drives the
   * chain CLI, patches genesis on the host, and streams stdout/stderr from a
   * child process — there's no orchestrator here.
   */
  image?: string
}

/** A Cosmos chain instance with chain-specific config exposed. */
export type CosmosInstance = Instance.Instance & {
  chainId: string
  denom: string
  prefix: string
  grpcPort: number
  apiPort: number
  /** Relayer hints advertised by the instance for Hermes configuration. */
  relayerHints?: CosmosRelayerHints
  /** `http://{host}:{port}` — CometBFT RPC endpoint. */
  rpcUrl: string
  /** `http://{host}:{grpcPort}` — gRPC endpoint. */
  grpcUrl: string
  /** `http://{host}:{apiPort}` — REST (Cosmos SDK API) endpoint. */
  apiUrl: string
}

/**
 * Genesis JSON structure — covers fields starskiff reads/writes.
 *
 * Field names follow cosmos-sdk proto JSON representation (snake_case).
 * Note: cosmjs-types uses camelCase — these types are intentionally
 * snake_case to match the raw genesis.json output from cosmos binaries.
 */
export type Genesis = {
  app_state: {
    staking?: { params?: { bond_denom: string } }
    mint?: { params?: { mint_denom: string } }
    crisis?: { constant_fee?: { denom: string } }
    gov?: {
      deposit_params?: { min_deposit?: { denom: string }[] }
      params?: { min_deposit?: { denom: string }[] }
    }
    bank?: { denom_metadata?: unknown[] }
    feemarket?: {
      params: { fee_denom: string; min_base_gas_price: string; [k: string]: unknown }
      state: { base_gas_price: string; [k: string]: unknown }
    }
    [module: string]: unknown
  }
}

/** Parameters for defining a custom chain with cosmosBase. */
export type CosmosBaseParameters = CosmosChainParameters & {
  /** Path to the binary. */
  binary: string
  /** Instance name. */
  name: string
  /** Hook to patch genesis after default denom patching. */
  patchGenesis?: (genesis: Genesis) => Genesis
  /**
   * Hook to patch genesis AFTER `collect-gentxs` — the last SDK command that
   * rewrites genesis.json. The SDK re-marshals top-level fields on every
   * genesis command (e.g. `initial_height` back to a JSON number), so edits to
   * those fields must happen here; `patchGenesis` edits to `app_state` survive
   * because the SDK carries it as a raw message.
   */
  finalizeGenesis?: (genesis: Genesis) => Genesis
  /** Additional app.toml patches. Merged after default patches. */
  extraAppToml?: Record<string, string>
  /** Additional config.toml patches. Merged after default patches. */
  extraConfigToml?: Record<string, string>
  /** Extra args appended to the `start` command (e.g. `['--chain-id', id]`). */
  extraStartArgs?: string[]
  /**
   * Additional ports to publish when running from an image (e.g. the EVM
   * JSON-RPC port, added by `cosmosEvmBase`). Ignored by the binary runtime,
   * which needs no port mapping.
   */
  extraPorts?: number[]
  /**
   * Additional readiness check ANDed with the default CometBFT height check
   * before `start()` resolves. Used by `cosmosEvmBase` to also wait for the
   * JSON-RPC (EVM) endpoint to come up.
   */
  extraReadinessCheck?: () => Promise<boolean>
  /**
   * Runtime inputs for every chain CLI invocation. Environment applies to
   * local and container commands; mounts apply only to containers. Intended
   * for custom chain definitions; high-level Instance interfaces expose
   * domain-specific options instead.
   */
  runtime?: CosmosRuntimeOptions
}

function commandDisplay(binary: string, args: readonly string[]): string {
  const displayArg = (arg: string) =>
    /^[A-Za-z0-9_./:@=+-]+$/.test(arg) ? arg : JSON.stringify(arg)
  return [binary, ...args].map(displayArg).join(' ')
}

/**
 * Shared setup for any Cosmos SDK chain binary.
 *
 * Handles the common flow: init → genesis patch → key creation →
 * gentx → config patch → start → health check polling.
 *
 * Used internally by instance definitions (e.g. simd).
 * For custom chains, provide a `patchGenesis` hook for chain-specific genesis modifications.
 */
export function cosmosBase(parameters: CosmosBaseParameters) {
  const {
    binary,
    name,
    chainId = 'starskiff-1',
    denom = 'stake',
    prefix = 'cosmos',
    accounts = [],
    minimumGasPrices,
    validatorBalance = '100000000000',
    validatorStake = '10000000',
    extraValidators = 0,
    rpcPort = 26657,
    grpcPort = 9090,
    apiPort = 1317,
    p2pPort = 26656,
    grpcWebPort = 9091,
    pprofPort = 6060,
    patchGenesis,
    finalizeGenesis,
    extraAppToml,
    extraConfigToml,
    extraStartArgs,
    extraPorts,
    extraReadinessCheck,
    relayerHints,
    image,
    runtime,
  } = parameters

  if (!Number.isSafeInteger(extraValidators) || extraValidators < 0) {
    throw new Error('extraValidators must be a finite non-negative integer.')
  }

  const host = 'localhost'
  let homeDir: string | undefined
  let healthPollTimer: ReturnType<typeof setTimeout> | undefined
  let runner: CommandRunner | undefined
  let cleanupOperation: Promise<void> | undefined

  // Container name for the docker runtime. Unique per instance so concurrent
  // chains (and leftovers from a crashed run) never collide.
  const containerName = `starskiff-${name}-${globalThis.process.pid}-${Math.random().toString(36).slice(2, 8)}`

  // Shared by stop() and start()'s failure path so a half-started instance
  // (bootstrap threw, or the start timeout fired) leaves nothing behind:
  // the health-poll timer, the child process, the container, and the temp
  // home dir.
  function cleanup() {
    if (cleanupOperation) return cleanupOperation

    cleanupOperation = (async () => {
      if (healthPollTimer) {
        clearTimeout(healthPollTimer)
        healthPollTimer = undefined
      }
      try {
        await runner?.stop()
      } catch {
        // best-effort: tolerate an already-dead process or container
      }
      runner = undefined
      if (homeDir) {
        try {
          fs.rmSync(homeDir, { recursive: true, force: true })
        } catch {
          // best-effort: preserve the original start/stop error
        }
        homeDir = undefined
      }
    })().finally(() => {
      cleanupOperation = undefined
    })

    return cleanupOperation
  }

  return {
    name,
    host,
    port: rpcPort,
    chainId,
    prefix,
    denom,
    grpcPort,
    apiPort,
    relayerHints,
    get rpcUrl() { return `http://${host}:${rpcPort}` },
    get grpcUrl() { return `http://${host}:${grpcPort}` },
    get apiUrl() { return `http://${host}:${apiPort}` },

    async start(
      { port = rpcPort }: Instance.InstanceStartOptions,
      { emitter, signal, setStartDiagnostics }: Instance.InstanceStartContext,
    ) {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-'))

      try {
        runner = createCommandRunner({
          binary,
          containerName,
          image,
          name,
          runtime,
          signal,
        })
        setStartDiagnostics({ phase: 'runtime preparation' })
        await runner.prepare((message) => emitter.emit('message', message))

        // Both runtimes execute the same chain CLI against the same home dir —
        // docker just runs it inside a disposable container with that dir bind
        // mounted, so every step below (and the host-side genesis/config
        // patching) is runtime-agnostic.
        const run = (phase: string, args: string[], options?: { input?: string }) => {
          setStartDiagnostics({ phase, command: commandDisplay(binary, args) })
          return runner!.run(homeDir!, args, options)
        }

        // 1. Init chain
        await run('init', ['init', 'validator', '--chain-id', chainId])

        // 2. Patch genesis
        setStartDiagnostics({ phase: 'genesis patch' })
        const genesisPath = path.join(homeDir, 'config', 'genesis.json')
        let genesis: Genesis = JSON.parse(fs.readFileSync(genesisPath, 'utf-8'))

        genesis = patchDenom(genesis, denom)
        if (patchGenesis) genesis = patchGenesis(genesis)

        fs.writeFileSync(genesisPath, JSON.stringify(genesis, null, 2))

        // 3. Validator + accounts
        await run('validator setup', ['keys', 'add', 'validator', '--keyring-backend', 'test'])
        await run('validator setup', [
          'genesis', 'add-genesis-account', 'validator',
          `${validatorBalance}${denom}`, '--keyring-backend', 'test',
        ])

        for (let i = 0; i < accounts.length; i++) {
          const account = accounts[i]
          const keyName = account.name || `test-${i}`

          // `keys add --recover` prompts for the mnemonic; the runner writes it
          // to stdin asynchronously so start cancellation remains effective.
          const recoverArgs = ['keys', 'add', keyName, '--recover', '--keyring-backend', 'test']
          try {
            await run('account recovery', recoverArgs, { input: `${account.mnemonic}\n` })
          } catch (error) {
            throw new Error(
              `Failed to recover key "${keyName}".\n${commandErrorMessage(error)}`,
              { cause: error },
            )
          }

          await run('genesis accounts', [
            'genesis', 'add-genesis-account', keyName,
            sortCoins(account.coins), '--keyring-backend', 'test',
          ])
        }

        // 4. Gentx (default validator) + any extra validators, then collect.
        await run('gentx', [
          'genesis', 'gentx', 'validator', `${validatorStake}${denom}`,
          '--chain-id', chainId, '--keyring-backend', 'test',
        ])

        // Each extra validator needs a DISTINCT consensus key. A single `init`
        // only yields one priv_validator_key, so derive each extra validator's
        // consensus pubkey from a throwaway home and pass it via `gentx --pubkey`.
        const extraStake = computeExtraValidatorStake(validatorStake, extraValidators)
        for (let i = 1; i <= extraValidators; i++) {
          const valName = `validator-${i}`
          await run('validator setup', ['keys', 'add', valName, '--keyring-backend', 'test'])
          await run('genesis accounts', [
            'genesis', 'add-genesis-account', valName,
            `${validatorBalance}${denom}`, '--keyring-backend', 'test',
          ])

          const consHome = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-cons-'))
          // The throwaway home is a *different* directory, so under docker it
          // needs its own bind mount rather than the instance's.
          const runInConsHome = (phase: string, args: string[]) => {
            setStartDiagnostics({ phase, command: commandDisplay(binary, args) })
            return runner!.run(consHome, args)
          }
          try {
            await runInConsHome('validator consensus setup', ['init', valName, '--chain-id', chainId])
            // `comet show-validator` (SDK ≥ v0.50); older binaries only expose
            // the `tendermint` alias, so fall back to it.
            let pubkey: string
            try {
              pubkey = (await runInConsHome('validator consensus setup', ['comet', 'show-validator'])).stdout
            } catch {
              signal.throwIfAborted()
              pubkey = (await runInConsHome('validator consensus setup', ['tendermint', 'show-validator'])).stdout
            }
            await run('gentx', [
              'genesis', 'gentx', valName, `${extraStake}${denom}`,
              '--pubkey', pubkey.trim(),
              '--moniker', valName,
              // All gentx share this home's node key, so the default
              // `gentx-<nodeID>.json` filename collides — write a distinct file.
              // The path is resolved by the chain CLI, so it must be expressed
              // in the container's filesystem when running from an image.
              '--output-document',
              image
                ? `${CONTAINER_HOME}/config/gentx/gentx-${valName}.json`
                : path.join(homeDir!, 'config', 'gentx', `gentx-${valName}.json`),
              '--chain-id', chainId, '--keyring-backend', 'test',
            ])
          } finally {
            try {
              fs.rmSync(consHome, { recursive: true, force: true })
            } catch {
              // best-effort: preserve the command error, if any
            }
          }
        }

        await run('gentx collection', ['genesis', 'collect-gentxs'])

        if (finalizeGenesis) {
          setStartDiagnostics({ phase: 'genesis finalization' })
          const finalized = finalizeGenesis(JSON.parse(fs.readFileSync(genesisPath, 'utf8')))
          fs.writeFileSync(genesisPath, JSON.stringify(finalized, null, 2))
        }

        // 5. Patch configs for port bindings
        setStartDiagnostics({ phase: 'configuration patch' })
        patchToml(path.join(homeDir, 'config', 'config.toml'), {
          'rpc.laddr': `tcp://0.0.0.0:${port}`,
          'p2p.laddr': `tcp://0.0.0.0:${p2pPort}`,
          'rpc.pprof_laddr': `localhost:${pprofPort}`,
          'consensus.timeout_commit': '1s',
          ...extraConfigToml,
        }, binary)

        patchToml(path.join(homeDir, 'config', 'app.toml'), {
          'api.enable': 'true',
          'api.address': `tcp://0.0.0.0:${apiPort}`,
          'grpc.address': `0.0.0.0:${grpcPort}`,
          'minimum-gas-prices': minimumGasPrices ?? `0${denom}`,
          ...extraAppToml,
        }, binary, {
          // Newer SDKs serve gRPC-Web on api.address; older ones have a separate listener.
          'grpc-web.address': `0.0.0.0:${grpcWebPort}`,
        })

        // 6. Start and wait for first block.
        // The container runs attached, so `docker run` forwards the node's
        // stdout/stderr to the child process — message buffering, events and
        // exit detection below are identical for both runtimes.
        const startCliArgs = ['start', ...(extraStartArgs ?? [])]
        setStartDiagnostics({
          phase: 'readiness check',
          command: commandDisplay(binary, startCliArgs),
        })
        return await runner.start(homeDir, startCliArgs, {
          emitter,
          ports: [port, p2pPort, apiPort, grpcPort, grpcWebPort, ...(extraPorts ?? [])],
          resolver({ process: proc, resolve, reject }) {
            const rpcUrl = `http://localhost:${port}`

            // Tail recent output so an exit-during-startup rejection carries
            // context instead of a bare exit code.
            const recentOutput: string[] = []
            const bufferOutput = (line: string) => {
              recentOutput.push(line)
              if (recentOutput.length > 20) recentOutput.shift()
            }
            emitter.on('stdout', bufferOutput)
            emitter.on('stderr', bufferOutput)

            let settled = false
            const finish = () => {
              settled = true
              if (healthPollTimer) clearTimeout(healthPollTimer)
              healthPollTimer = undefined
              emitter.off('stdout', bufferOutput)
              emitter.off('stderr', bufferOutput)
            }
            const poll = async () => {
              try {
                const res = await fetch(`${rpcUrl}/status`, { signal })
                if (res.ok) {
                  const data = await res.json() as { result?: { sync_info?: { latest_block_height?: string } } }
                  const height = Number(
                    data.result?.sync_info?.latest_block_height ?? 0,
                  )
                  if (height > 0 && (extraReadinessCheck ? await extraReadinessCheck() : true)) {
                    finish()
                    resolve()
                    return
                  }
                }
              } catch {
                // Node not ready yet
              }
              if (!settled && !signal.aborted) healthPollTimer = setTimeout(poll, 250)
            }
            void poll()

            proc.process?.on('exit', (code: number | null) => {
              if (settled) return
              finish()
              const tail = recentOutput.join('').trim().split('\n').slice(-5).join(' | ')
              reject(`${name} exited before readiness with code ${code}${tail ? `: ${tail}` : ''}`)
            })
          },
        })
      } catch (error) {
        await cleanup()
        throw error
      }
    },

    async stop() {
      await cleanup()
    },
  }
}

/**
 * Computes the self-delegation stake for each extra validator so the primary
 * (the only validator running a live node) keeps a supermajority of voting
 * power. Extra validators are bonded but never sign blocks, so if their
 * combined stake reaches `validatorStake / 2` the primary drops to <=2/3 and
 * CometBFT halts at genesis.
 *
 * Invariant: `primaryStake > 2 * extraValidators * extraStake` must hold.
 * Solving for `extraStake` with a 2x safety margin gives
 * `extraStake = primaryStake / (4 * extraValidators)`, which holds for any
 * `extraValidators >= 1` — a fixed fraction (e.g. the old 1/10) only stays
 * safe up to 4 extra validators.
 */
export function computeExtraValidatorStake(validatorStake: string, extraValidators: number): bigint {
  if (extraValidators <= 0) return 0n

  const stake = BigInt(validatorStake) / (4n * BigInt(extraValidators))
  if (stake < 1n) {
    throw new Error(
      `extraValidators=${extraValidators} is too large for validatorStake=${validatorStake}: ` +
      `computed per-validator stake rounds to 0. Increase validatorStake or reduce extraValidators.`,
    )
  }
  return stake
}

/** Patch common denom fields across SDK versions. */
function patchDenom(genesis: Genesis, denom: string): Genesis {
  if (genesis.app_state.staking?.params) {
    genesis.app_state.staking.params.bond_denom = denom
  }
  if (genesis.app_state.mint?.params) {
    genesis.app_state.mint.params.mint_denom = denom
  }

  if (genesis.app_state.crisis?.constant_fee) {
    genesis.app_state.crisis.constant_fee.denom = denom
  }

  if (genesis.app_state.gov?.deposit_params?.min_deposit?.[0]) {
    genesis.app_state.gov.deposit_params.min_deposit[0].denom = denom
  } else if (genesis.app_state.gov?.params?.min_deposit?.[0]) {
    genesis.app_state.gov.params.min_deposit[0].denom = denom
  }

  return genesis
}

/** Internal config patcher. Optional defaults apply only when the key exists. */
export function patchToml(
  filePath: string,
  patches: Record<string, string>,
  binary: string,
  optionalDefaults: Record<string, string> = {},
): void {
  const effectivePatches = { ...optionalDefaults, ...patches }
  let currentSection = ''
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  const result: string[] = []
  const matchedKeys = new Set<string>()

  for (const line of lines) {
    const sectionMatch = line.match(/^\[([^\]]+)\]/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
    }

    let patched = false
    for (const [patchKey, patchValue] of Object.entries(effectivePatches)) {
      const dotIdx = patchKey.indexOf('.')
      const section = dotIdx >= 0 ? patchKey.slice(0, dotIdx) : ''
      const key = dotIdx >= 0 ? patchKey.slice(dotIdx + 1) : patchKey

      if (currentSection === section) {
        const keyPattern = new RegExp(`^(\\s*${key}\\s*=\\s*)(.*)$`)
        const match = line.match(keyPattern)
        if (match) {
          const needsQuotes = patchValue !== 'true' && patchValue !== 'false'
          result.push(`${match[1]}${needsQuotes ? `"${patchValue}"` : patchValue}`)
          matchedKeys.add(patchKey)
          patched = true
          break
        }
      }
    }

    if (!patched) result.push(line)
  }

  // SDK versions drift on section/key names; a silent no-op here just shows
  // up later as a confusing readiness timeout, so warn instead.
  const unmatched = Object.keys(patches).filter((key) => !matchedKeys.has(key))
  if (unmatched.length > 0) {
    console.warn(
      `[starskiff:${binary}] ${path.basename(filePath)}: no matching key for ${unmatched.join(', ')} (SDK config layout may have drifted)`,
    )
  }

  fs.writeFileSync(filePath, result.join('\n'))
}

/** Parameters for EVM-enabled Cosmos SDK chains. */
export type CosmosEvmChainParameters = Omit<CosmosChainParameters, 'relayerHints'> & {
  /** JSON-RPC (EVM) listen port. @default 8545 */
  evmPort?: number
  /**
   * Ethermint-only overrides. `addressDerivation` is fixed to `'ethermint'`
   * by `cosmosEvmBase`; only `hdPath` and `pkTypeUrl` are user-controllable.
   */
  relayerHints?: { hdPath?: string; pkTypeUrl?: string }
  /**
   * EVM static precompiles written to `evm.params.active_static_precompiles`.
   *
   * - `undefined` (omitted): genesis untouched, binary's compiled-in default applies.
   * - `[]`: explicitly disable all precompiles.
   * - `[...]`: overwrite with the given set.
   *
   * Instance wrappers (e.g. `xplad`) provide a chain-specific default.
   */
  activeStaticPrecompiles?: readonly string[]
}

/** A Cosmos EVM chain instance with evmPort exposed. */
export type CosmosEvmInstance = CosmosInstance & {
  evmPort: number
  /** `http://{host}:{evmPort}` — JSON-RPC (EVM) endpoint. */
  evmUrl: string
}

/** Parameters for defining a custom EVM chain with cosmosEvmBase. */
export type CosmosEvmBaseParameters = CosmosEvmChainParameters & {
  binary: string
  name: string
  /** EIP-155 chain ID passed to the cosmos/evm start command. */
  evmChainId?: number
  patchGenesis?: (genesis: Genesis) => Genesis
  /** Post-`collect-gentxs` genesis patch, forwarded to cosmosBase. */
  finalizeGenesis?: (genesis: Genesis) => Genesis
  /** Additional config.toml patches, forwarded to cosmosBase. */
  extraConfigToml?: Record<string, string>
  /** Extra `start` command args, forwarded to cosmosBase. */
  extraStartArgs?: string[]
  /**
   * Runtime inputs for every chain CLI invocation. Environment applies to
   * local and container commands; mounts apply only to containers. Intended
   * for custom chain definitions; high-level Instance interfaces expose
   * domain-specific options instead.
   */
  runtime?: CosmosRuntimeOptions
}

/**
 * Normalizes an `active_static_precompiles` list to the form cosmos-evm
 * genesis validation requires: EIP-55 checksummed — the chain's activation
 * check compares the stored strings case-sensitively against
 * `address.String()`, so lowercasing silently disables any precompile whose
 * address contains a hex letter — and plain-sorted, since validation runs
 * `slices.IsSorted` on those exact strings (a lowercase-keyed sort could
 * fail it). Exported for unit testing; not part of the package root.
 */
export function normalizeActiveStaticPrecompiles(precompiles: readonly string[]): string[] {
  return precompiles.map((a) => toChecksumAddress(a)).sort()
}

/**
 * Shared setup for EVM-enabled Cosmos SDK chains (e.g. xpla, evmos).
 *
 * Extends cosmosBase with JSON-RPC (EVM) port configuration in app.toml.
 */
export function cosmosEvmBase(parameters: CosmosEvmBaseParameters) {
  const {
    evmChainId,
    evmPort = 8545,
    extraStartArgs = [],
    relayerHints,
    activeStaticPrecompiles,
    patchGenesis: userPatch,
    ...rest
  } = parameters

  if (
    evmChainId !== undefined &&
    (!Number.isSafeInteger(evmChainId) || evmChainId <= 0)
  ) {
    throw new Error('evmChainId must be a positive safe integer.')
  }
  if (
    evmChainId !== undefined &&
    extraStartArgs.some((argument) =>
      argument === EVM_CHAIN_ID_FLAG || argument.startsWith(`${EVM_CHAIN_ID_FLAG}=`),
    )
  ) {
    throw new Error(
      `evmChainId cannot be combined with ${EVM_CHAIN_ID_FLAG} in extraStartArgs.`,
    )
  }

  const base = cosmosBase({
    ...rest,
    extraStartArgs: [
      ...(evmChainId === undefined
        ? []
        : [EVM_CHAIN_ID_FLAG, String(evmChainId)]),
      ...extraStartArgs,
    ],
    // Docker runtime: the JSON-RPC listener needs its port published too.
    extraPorts: [evmPort],
    extraAppToml: {
      'json-rpc.enable': 'true',
      'json-rpc.address': `0.0.0.0:${evmPort}`,
    },
    // EVM-enabled Cosmos chains use eth_secp256k1 keys and ETH coin type 60.
    // Default `pkTypeUrl` targets the cosmos-evm module proto (current
    // upstream used by xpla, etc.). Legacy ethermint forks (evmos,
    // injective, ...) can override with their own proto URL.
    relayerHints: {
      hdPath: "m/44'/60'/0'/0/0",
      addressDerivation: 'ethermint',
      pkTypeUrl: DEFAULT_COSMOS_EVM_PK_TYPE_URL,
      ...relayerHints,
    },
    patchGenesis: (genesis) => {
      if (activeStaticPrecompiles !== undefined) {
        const evm = (genesis.app_state as Record<string, unknown>).evm as
          | { params: { active_static_precompiles?: readonly string[] } }
          | undefined
        if (evm?.params) {
          evm.params.active_static_precompiles = normalizeActiveStaticPrecompiles(activeStaticPrecompiles)
        }
      }
      return userPatch ? userPatch(genesis) : genesis
    },
    // CometBFT reporting a block doesn't mean the JSON-RPC server is up yet
    // (it's a separate listener started after the app is ready) — poll it too.
    extraReadinessCheck: async () => {
      try {
        const res = await fetch(`http://localhost:${evmPort}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ jsonrpc: '2.0', method: 'eth_blockNumber', params: [], id: 1 }),
        })
        if (!res.ok) return false
        const data = await res.json() as { result?: string }
        return typeof data.result === 'string'
      } catch {
        return false
      }
    },
  })
  return {
    ...base,
    evmPort,
    get evmUrl() { return `http://localhost:${evmPort}` },
  }
}
