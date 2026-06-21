import fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import os from 'node:os'
import path from 'node:path'
import { x } from 'tinyexec'
import * as Instance from './Instance.js'
import { createProcess } from './process.js'

export type CosmosAccount = {
  /** BIP39 mnemonic for key derivation. */
  mnemonic: string
  /** Coins to fund (e.g. "1000000000stake"). */
  coins: string
  /** Account name for keyring. @default "test-{index}" */
  name?: string
}

/** Default pk proto URL for ethermint-derivation chains (cosmos-evm module). */
export const DEFAULT_COSMOS_EVM_PK_TYPE_URL = '/cosmos.evm.crypto.v1.ethsecp256k1.PubKey'

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
  /** Chain ID. @default "cosmock-1" */
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
  /** gRPC-Web listen port. @default 9091 */
  grpcWebPort?: number
  /** pprof listen port. @default 6060 */
  pprofPort?: number
  /**
   * Hermes relayer hints. Usually set by the instance wrapper (e.g.
   * `cosmosEvmBase`), callers only override for custom chains.
   */
  relayerHints?: CosmosRelayerHints
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
}

/**
 * Genesis JSON structure — covers fields cosmock reads/writes.
 *
 * Field names follow cosmos-sdk proto JSON representation (snake_case).
 * Note: cosmjs-types uses camelCase — these types are intentionally
 * snake_case to match the raw genesis.json output from cosmos binaries.
 */
export type Genesis = {
  app_state: {
    staking: { params: { bond_denom: string } }
    mint: { params: { mint_denom: string } }
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

/** Internal parameters for cosmosBase. Extends CosmosChainParameters with binary, name, and hooks. */
export type CosmosBaseParameters = CosmosChainParameters & {
  /** Path to the binary. */
  binary: string
  /** Instance name. */
  name: string
  /** Hook to patch genesis after default denom patching. */
  patchGenesis?: (genesis: Genesis) => Genesis
  /** Additional app.toml patches. Merged after default patches. */
  extraAppToml?: Record<string, string>
  /** Additional config.toml patches. Merged after default patches. */
  extraConfigToml?: Record<string, string>
  /** Extra args appended to the `start` command (e.g. `['--chain-id', id]`). */
  extraStartArgs?: string[]
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
    chainId = 'cosmock-1',
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
    extraAppToml,
    extraConfigToml,
    extraStartArgs,
    relayerHints,
  } = parameters

  const process = createProcess(name)
  let homeDir: string | undefined

  return {
    name,
    host: 'localhost',
    port: rpcPort,
    chainId,
    prefix,
    denom,
    grpcPort,
    apiPort,
    relayerHints,

    async start(
      { port = rpcPort }: Instance.InstanceStartOptions,
      { emitter }: Instance.InstanceStartContext,
    ) {
      homeDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmock-'))

      const run = (args: string[]) =>
        x(binary, [...args, '--home', homeDir!], {
          throwOnError: true,
          nodeOptions: { stdio: 'pipe' },
        })

      // 1. Init chain
      await run(['init', 'validator', '--chain-id', chainId])

      // 2. Patch genesis
      const genesisPath = path.join(homeDir, 'config', 'genesis.json')
      let genesis: Genesis = JSON.parse(fs.readFileSync(genesisPath, 'utf-8'))

      genesis = patchDenom(genesis, denom)
      if (patchGenesis) genesis = patchGenesis(genesis)

      fs.writeFileSync(genesisPath, JSON.stringify(genesis, null, 2))

      // 3. Validator + accounts
      await run(['keys', 'add', 'validator', '--keyring-backend', 'test'])
      await run([
        'genesis', 'add-genesis-account', 'validator',
        `${validatorBalance}${denom}`, '--keyring-backend', 'test',
      ])

      for (let i = 0; i < accounts.length; i++) {
        const account = accounts[i]
        const keyName = account.name || `test-${i}`

        const result = spawnSync(binary, [
          'keys', 'add', keyName, '--recover',
          '--keyring-backend', 'test', '--home', homeDir!,
        ], { input: account.mnemonic + '\n', stdio: ['pipe', 'pipe', 'pipe'] })

        if (result.status !== 0) {
          throw new Error(`Failed to recover key "${keyName}": ${result.stderr?.toString()}`)
        }

        await run([
          'genesis', 'add-genesis-account', keyName,
          account.coins, '--keyring-backend', 'test',
        ])
      }

      // 4. Gentx (default validator) + any extra validators, then collect.
      await run([
        'genesis', 'gentx', 'validator', `${validatorStake}${denom}`,
        '--chain-id', chainId, '--keyring-backend', 'test',
      ])

      // Each extra validator needs a DISTINCT consensus key. A single `init`
      // only yields one priv_validator_key, so derive each extra validator's
      // consensus pubkey from a throwaway home and pass it via `gentx --pubkey`.
      for (let i = 1; i <= extraValidators; i++) {
        const valName = `validator-${i}`
        await run(['keys', 'add', valName, '--keyring-backend', 'test'])
        await run([
          'genesis', 'add-genesis-account', valName,
          `${validatorBalance}${denom}`, '--keyring-backend', 'test',
        ])

        const consHome = fs.mkdtempSync(path.join(os.tmpdir(), 'cosmock-cons-'))
        try {
          await x(binary, ['init', valName, '--chain-id', chainId, '--home', consHome], {
            throwOnError: true,
            nodeOptions: { stdio: 'pipe' },
          })
          // `comet show-validator` (SDK ≥ v0.50); older binaries only expose
          // the `tendermint` alias, so fall back to it.
          const showValidator = (sub: string) =>
            x(binary, [sub, 'show-validator', '--home', consHome], {
              throwOnError: true,
              nodeOptions: { stdio: 'pipe' },
            })
          let pubkey: string
          try {
            pubkey = (await showValidator('comet')).stdout
          } catch {
            pubkey = (await showValidator('tendermint')).stdout
          }
          // Minority stake: extra validators are bonded but run no node, so the
          // single live (primary) validator must keep >2/3 of total voting power
          // or CometBFT consensus halts. 1/10 of the primary stake each keeps the
          // primary in supermajority for any small number of extra validators.
          const extraStake = (BigInt(validatorStake) / 10n).toString()
          await run([
            'genesis', 'gentx', valName, `${extraStake}${denom}`,
            '--pubkey', pubkey.trim(),
            '--moniker', valName,
            // All gentx share this home's node key, so the default
            // `gentx-<nodeID>.json` filename collides — write a distinct file.
            '--output-document',
            path.join(homeDir!, 'config', 'gentx', `gentx-${valName}.json`),
            '--chain-id', chainId, '--keyring-backend', 'test',
          ])
        } finally {
          fs.rmSync(consHome, { recursive: true, force: true })
        }
      }

      await run(['genesis', 'collect-gentxs'])

      // 5. Patch configs for port bindings
      patchToml(path.join(homeDir, 'config', 'config.toml'), {
        'rpc.laddr': `tcp://0.0.0.0:${port}`,
        'p2p.laddr': `tcp://0.0.0.0:${p2pPort}`,
        'rpc.pprof_laddr': `localhost:${pprofPort}`,
        'consensus.timeout_commit': '1s',
        ...extraConfigToml,
      })

      patchToml(path.join(homeDir, 'config', 'app.toml'), {
        'api.enable': 'true',
        'api.address': `tcp://0.0.0.0:${apiPort}`,
        'grpc.address': `0.0.0.0:${grpcPort}`,
        'grpc-web.address': `0.0.0.0:${grpcWebPort}`,
        'minimum-gas-prices': minimumGasPrices ?? `0${denom}`,
        ...extraAppToml,
      })

      // 6. Start and wait for first block
      return process.start(binary, ['start', '--home', homeDir, ...(extraStartArgs ?? [])], {
        emitter,
        resolver({ process: proc, resolve, reject }) {
          const rpcUrl = `http://localhost:${port}`
          const interval = setInterval(async () => {
            try {
              const res = await fetch(`${rpcUrl}/status`)
              if (res.ok) {
                const data = await res.json() as { result?: { sync_info?: { latest_block_height?: string } } }
                const height = Number(
                  data.result?.sync_info?.latest_block_height ?? 0,
                )
                if (height > 0) {
                  clearInterval(interval)
                  resolve()
                }
              }
            } catch {
              // Node not ready yet
            }
          }, 250)

          proc.process?.on('exit', (code: number | null) => {
            clearInterval(interval)
            if (code !== 0) reject(`${name} exited with code ${code}`)
          })
        },
      })
    },

    async stop() {
      await process.stop()
      if (homeDir) {
        fs.rmSync(homeDir, { recursive: true, force: true })
        homeDir = undefined
      }
    },
  }
}

/** Patch common denom fields across SDK versions. */
function patchDenom(genesis: Genesis, denom: string): Genesis {
  genesis.app_state.staking.params.bond_denom = denom
  genesis.app_state.mint.params.mint_denom = denom

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

/** Simple TOML patcher for `[section]\nkey = "value"` patterns. */
function patchToml(filePath: string, patches: Record<string, string>): void {
  let currentSection = ''
  const lines = fs.readFileSync(filePath, 'utf-8').split('\n')
  const result: string[] = []

  for (const line of lines) {
    const sectionMatch = line.match(/^\[([^\]]+)\]/)
    if (sectionMatch) {
      currentSection = sectionMatch[1]
    }

    let patched = false
    for (const [patchKey, patchValue] of Object.entries(patches)) {
      const dotIdx = patchKey.indexOf('.')
      const section = dotIdx >= 0 ? patchKey.slice(0, dotIdx) : ''
      const key = dotIdx >= 0 ? patchKey.slice(dotIdx + 1) : patchKey

      if (currentSection === section) {
        const keyPattern = new RegExp(`^(\\s*${key}\\s*=\\s*)(.*)$`)
        const match = line.match(keyPattern)
        if (match) {
          const needsQuotes = patchValue !== 'true' && patchValue !== 'false'
          result.push(`${match[1]}${needsQuotes ? `"${patchValue}"` : patchValue}`)
          patched = true
          break
        }
      }
    }

    if (!patched) result.push(line)
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
}

/** Internal parameters for cosmosEvmBase. */
export type CosmosEvmBaseParameters = CosmosEvmChainParameters & {
  binary: string
  name: string
  patchGenesis?: (genesis: Genesis) => Genesis
  /** Additional config.toml patches, forwarded to cosmosBase. */
  extraConfigToml?: Record<string, string>
  /** Extra `start` command args, forwarded to cosmosBase. */
  extraStartArgs?: string[]
}

/**
 * Shared setup for EVM-enabled Cosmos SDK chains (e.g. xpla, evmos).
 *
 * Extends cosmosBase with JSON-RPC (EVM) port configuration in app.toml.
 */
export function cosmosEvmBase(parameters: CosmosEvmBaseParameters) {
  const { evmPort = 8545, relayerHints, activeStaticPrecompiles, patchGenesis: userPatch, ...rest } = parameters
  const base = cosmosBase({
    ...rest,
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
          // cosmos-evm genesis validation requires the list to be sorted by
          // bytes20 order. Normalize to lowercase + ascending sort so callers
          // don't have to think about it.
          evm.params.active_static_precompiles = activeStaticPrecompiles
            .map((a) => a.toLowerCase())
            .sort()
        }
      }
      return userPatch ? userPatch(genesis) : genesis
    },
  })
  return { ...base, evmPort }
}
