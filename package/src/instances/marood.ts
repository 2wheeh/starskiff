import fs from 'node:fs'
import path from 'node:path'
import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'
import type { RuntimeOptions } from '../runtime.js'
import type { InstanceSource } from '../source.js'
import { MAROO_PREINSTALLS, type EvmPreinstall } from './marood-preinstalls.js'

export type { EvmPreinstall }
export { MAROO_PREINSTALLS }

/** Network preset selector for marood instances. */
export type MaroodNetwork = 'mainnet' | 'testnet'

/** Chain identity + denom set selected by a {@link MaroodNetwork}. */
export type MaroodNetworkPreset = {
  /** EIP-155 EVM chain id, exposed as `eth_chainId`. */
  evmChainId: number
  /** Cosmos chain id. */
  chainId: string
  /** Staking/bond denom (gentx, `staking.params.bond_denom`). */
  bondDenom: string
  /** Fee + EVM denom (18 decimals; gov and `evm.params.evm_denom`). */
  feeDenom: string
  /** Display unit of the fee denom (exponent 18). */
  displayDenom: string
  /** Bank metadata symbol of the native currency. */
  symbol: string
  /** Bank metadata name of the native currency. */
  currencyName: string
}

/**
 * maroo network presets.
 *
 * - `mainnet`: `config/config.go` + `config/constants.go` in the maroo repo
 *   (ChainDenom `aokrw`, BondDenom `amaroo`, MainnetChainID 815).
 * - `testnet`: `cmd/marood/cmd/testnet.go` (ChainDenom `atokrw`, BondDenom
 *   `atmaroo`, TestnetChainID 450815) — matches viem's `marooTestnet` chain
 *   definition (id + nativeCurrency).
 */
export const MAROO_NETWORKS: Record<MaroodNetwork, MaroodNetworkPreset> = {
  mainnet: {
    evmChainId: 815,
    chainId: 'maroo_815-1',
    bondDenom: 'amaroo',
    feeDenom: 'aokrw',
    displayDenom: 'okrw',
    symbol: 'OKRW',
    currencyName: 'OKRW Token',
  },
  testnet: {
    evmChainId: 450815,
    chainId: 'maroo_450815-1',
    bondDenom: 'atmaroo',
    feeDenom: 'atokrw',
    displayDenom: 'tokrw',
    symbol: 'tOKRW',
    currencyName: 'Testnet OKRW',
  },
}

/**
 * Default active static precompiles for marood.
 *
 * Mirrors `precompiles/types.DefaultActiveStaticPrecompiles()` in the maroo
 * repo: the cosmos-evm set without Vesting, ICS20, Bank, or ICS02, plus
 * maroo's own precompiles.
 */
export const MAROO_DEFAULT_PRECOMPILES: readonly string[] = [
  '0x0000000000000000000000000000000000000100', // P256
  '0x0000000000000000000000000000000000000400', // Bech32
  '0x0000000000000000000000000000000000000800', // Staking
  '0x0000000000000000000000000000000000000801', // Distribution
  '0x0000000000000000000000000000000000000805', // Gov
  '0x0000000000000000000000000000000000000806', // Slashing
  '0x1000000000000000000000000000000000000001', // OKRW
  '0x1000000000000000000000000000000000000005', // PCL
  '0x1000000000000000000000000000000000000009', // EAS
  '0x100000000000000000000000000000000000000A', // Agent
  '0x100000000000000000000000000000000000000b', // Privacy
]

/**
 * Fixed maroo module params seeded by {@link patchMaroodGenesis}, verbatim
 * from the maroo repo's `local_node.sh`: agent registries (bech32 of
 * 0x8004…0001 / 0x8004…0002) and eas contracts (bech32 of 0x…06 / 07 / 08).
 * Protocol constants, identical across deployments, hence hardcoded — forks
 * can still override them via `patchGenesis`.
 */
const MAROO_AGENT_IDENTITY_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqplfm99t'
const MAROO_AGENT_REPUTATION_REGISTRY = 'maroo1sqzqqqqqqqqqqqqqqqqqqqqqqqqqqqqz36wnt5'
const MAROO_EAS_SCHEMA_REGISTRY_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqxckxhzt'
const MAROO_EAS_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqq89qjzle'
const MAROO_EAS_INDEXER_CONTRACT = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqg6dp7qp'

/** Default ERC-4337 v0.6, v0.8, and v0.9 entrypoints, in bech32. */
export const MAROO_DEFAULT_PCL_ENTRYPOINTS: readonly string[] = [
  'maroo1tlcn049slhx5nh9rp3702ljh3gpx6fufd52r78',
  'maroo1gvmssnv7y40lqupyv88c39wwnca4luggmf5lq0',
  'maroo1gvmsjqymsvc0mgerz803c2h6gqhd35qfx3tslf',
]

export type MaroodPrivacyZkArtifacts = {
  /** Absolute host directory containing a Clairveil v0.6.1 audit-field bundle. */
  directory: string
}

export type MaroodParameters = Omit<CosmosEvmChainParameters, 'image'> & InstanceSource & {
  /**
   * Absolute host path to a fresh Privacy GenesisStateV4 JSON file.
   * Its audit PoP must bind to this instance's chainId and initial height 1;
   * its native asset must use the selected network's fee denom.
   * Starskiff inserts the public JSON into app_state.privacy before gentx.
   */
  privacyGenesis: string
  /**
   * External Clairveil v0.6.1 audit-field artifacts.
   *
   * Omit this for a self-contained image whose artifacts and environment are
   * already configured. Starskiff validates only the host path; marood's
   * strict preflight remains the authority for artifact contents.
   */
  privacyZkArtifacts?: MaroodPrivacyZkArtifacts
  /**
   * Network preset selecting chain ids and denoms. @default "testnet"
   *
   * `testnet` matches viem's `marooTestnet` (`import { marooTestnet } from
   * 'viem/chains'`), so it's the right default for local EVM testing.
   */
  network?: MaroodNetwork
  /**
   * Contracts preinstalled at genesis (`evm.preinstalls`).
   * Pass `[]` to disable. @default {@link MAROO_PREINSTALLS}
   */
  preinstalls?: readonly EvmPreinstall[]
  /**
   * Bech32 address for `pcl.params.policy_admin`, which gates the PCL
   * precompile's admin methods. Also creates or updates the Privacy
   * contract-policy owner, preserving existing policies.
   */
  policyAdmin?: string
  /**
   * Bech32 address for `okrw.params.minter_address`, which gates OKRW
   * `mint`/`burn`. No default.
   */
  minterAddress?: string
  /**
   * Bech32 addresses written to `pcl.params.entrypoints` — the ERC-4337
   * entrypoint contracts the PCL precompile accepts UserOperations from.
   * @default {@link MAROO_DEFAULT_PCL_ENTRYPOINTS}
   */
  entrypoints?: readonly string[]
  /** Chain-specific genesis patch, chained after marood's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

const PRIVACY_ZK_CONTAINER_DIRECTORY = '/starskiff/privacy-zk-artifacts'
const PRIVACY_ZK_ARTIFACT_DIR_ENV = 'CLAIRVEIL_PRIVACY_ZK_ARTIFACT_DIR'
const PRIVACY_ZK_PREFLIGHT_MODE_ENV = 'CLAIRVEIL_PRIVACY_ZK_PREFLIGHT_MODE'
const PRIVACY_ZK_RUNTIME_ENVIRONMENT_ENV = 'CLAIRVEIL_PRIVACY_ZK_RUNTIME_ENVIRONMENT'
const MAROO_PRIVACY_PRECOMPILE = 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqt575gw7'

/** Configures artifact access and keeps init independent of inherited genesis paths. */
export function resolveMaroodPrivacyZkRuntime(
  artifacts: MaroodPrivacyZkArtifacts | undefined,
  containerRuntime: boolean,
): RuntimeOptions {
  // The required privacyGenesis input is installed by starskiff after init.
  const unsetEnvironment = ['MAROO_PRIVACY_GENESIS']
  if (!artifacts) return { unsetEnvironment }

  if (typeof artifacts.directory !== 'string' || !path.isAbsolute(artifacts.directory)) {
    throw new Error('marood: privacyZkArtifacts.directory must be an absolute host path.')
  }

  let isDirectory = false
  try {
    isDirectory = fs.statSync(artifacts.directory).isDirectory()
  } catch {
    // Use the same actionable error for missing and unreadable paths.
  }
  if (!isDirectory) {
    throw new Error(
      `marood: privacyZkArtifacts.directory is not an existing directory: ${artifacts.directory}`,
    )
  }

  const artifactDirectory = containerRuntime
    ? PRIVACY_ZK_CONTAINER_DIRECTORY
    : artifacts.directory
  const environment: Record<string, string> = {
    [PRIVACY_ZK_ARTIFACT_DIR_ENV]: artifactDirectory,
    [PRIVACY_ZK_PREFLIGHT_MODE_ENV]: 'strict',
    [PRIVACY_ZK_RUNTIME_ENVIRONMENT_ENV]: 'development',
  }

  return {
    environment,
    unsetEnvironment,
    mounts: containerRuntime
      ? [{ source: artifacts.directory, target: PRIVACY_ZK_CONTAINER_DIRECTORY, readOnly: true }]
      : undefined,
  }
}

/** Options for {@link patchMaroodGenesis}, mirroring the relevant `MaroodParameters`. */
export type PatchMaroodGenesisOptions = {
  preset: MaroodNetworkPreset
  preinstalls: readonly EvmPreinstall[]
  privacyGenesis: string
  policyAdmin?: string
  minterAddress?: string
  entrypoints?: readonly string[]
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * marood's genesis patch, extracted for unit testing. Mutates `genesis` in
 * place and returns it, like every other patch hook here.
 *
 * Mirrors the jq patches in the maroo repo's `local_node.sh`: EVM denom +
 * bank metadata, genesis preinstalls, and the
 * okrw/pcl/eas/agent module params. Installs the supplied fresh Privacy V4
 * genesis; marood validates the audit key, PoP, and circuit identity at startup.
 *
 * Every module patch is guarded by a presence check (`app[module]?.params`)
 * since callers may run this against other genesis layouts. Runs before
 * `opts.patchGenesis` so caller overrides always win.
 */
export function patchMaroodGenesis(genesis: Genesis, opts: PatchMaroodGenesisOptions): Genesis {
  const { preset, preinstalls, privacyGenesis, policyAdmin, minterAddress, entrypoints, patchGenesis: userPatch } = opts
  const feeDenom = preset.feeDenom

  if (typeof privacyGenesis !== 'string' || !path.isAbsolute(privacyGenesis)) {
    throw new Error('marood: privacyGenesis must be an absolute host path to a fresh Privacy V4 JSON file.')
  }
  const privacy = JSON.parse(fs.readFileSync(privacyGenesis, 'utf-8'))
  if (privacy?.format_version !== 4 || privacy.mode !== 'FRESH' || privacy.initial_height !== 1) {
    throw new Error('marood: privacyGenesis must describe FRESH Privacy V4 genesis at initial_height 1.')
  }
  if (!Array.isArray(privacy.asset_registry) || !privacy.asset_registry.some(
    (asset: { canonical_denom?: string } | null) => asset?.canonical_denom === feeDenom,
  )) {
    throw new Error(`marood: privacyGenesis must register the native fee denom ${feeDenom}.`)
  }
  genesis.app_state.privacy = privacy

  // Governance uses the fee denom, while staking uses the bond denom.
  const gov = genesis.app_state.gov
  if (gov?.params?.min_deposit?.[0]) gov.params.min_deposit[0].denom = feeDenom
  const govParams = gov?.params as
    | { expedited_min_deposit?: { denom: string }[] }
    | undefined
  if (govParams?.expedited_min_deposit?.[0]) {
    govParams.expedited_min_deposit[0].denom = feeDenom
  }

  // Align the EVM denomination with the preset and its bank metadata.
  const evm = (genesis.app_state as Record<string, unknown>).evm as
    | {
        params: { evm_denom?: string; extended_denom_options?: { extended_denom: string } }
        preinstalls?: readonly EvmPreinstall[]
      }
    | undefined
  if (evm?.params) {
    evm.params.evm_denom = feeDenom
    if (evm.params.extended_denom_options) {
      evm.params.extended_denom_options.extended_denom = feeDenom
    }
    evm.preinstalls = [...preinstalls]
  }

  if (genesis.app_state.bank) {
    genesis.app_state.bank.denom_metadata = [
      {
        description: 'The native token for marood.',
        denom_units: [
          { denom: feeDenom, exponent: 0, aliases: [] },
          { denom: preset.displayDenom, exponent: 18, aliases: [] },
        ],
        base: feeDenom,
        display: preset.displayDenom,
        name: preset.currencyName,
        symbol: preset.symbol,
        uri: '',
        uri_hash: '',
      },
    ]
  }

  // The maroo module params (see docblock). mint_denom's compiled-in default
  // is the mainnet aokrw, so the preset must stay authoritative.
  const okrw = (genesis.app_state as Record<string, unknown>).okrw as
    | { params?: { mint_denom?: string; minter_address?: string } }
    | undefined
  if (okrw?.params) {
    okrw.params.mint_denom = feeDenom
    if (minterAddress) okrw.params.minter_address = minterAddress
  }

  const pcl = (genesis.app_state as Record<string, unknown>).pcl as
    | {
        params?: { policy_admin?: string; entrypoints?: string[] }
        contract_policies?: { config: { contract: string; admin: string }; policies?: unknown[] }[]
      }
    | undefined
  if (pcl?.params) {
    if (policyAdmin) pcl.params.policy_admin = policyAdmin
    pcl.params.entrypoints = [...(entrypoints ?? MAROO_DEFAULT_PCL_ENTRYPOINTS)]
  }

  if (policyAdmin && pcl?.params) {
    const policies = pcl.contract_policies ??= []
    const privacyPolicy = policies.find((policy) => policy.config.contract === MAROO_PRIVACY_PRECOMPILE)
    if (privacyPolicy) {
      privacyPolicy.config.admin = policyAdmin
    } else {
      policies.push({ config: { contract: MAROO_PRIVACY_PRECOMPILE, admin: policyAdmin }, policies: [] })
    }
  }

  const eas = (genesis.app_state as Record<string, unknown>).eas as
    | {
        params?: {
          schema_registry_contract?: string
          eas_contract?: string
          indexer_contract?: string
        }
      }
    | undefined
  if (eas?.params) {
    eas.params.schema_registry_contract = MAROO_EAS_SCHEMA_REGISTRY_CONTRACT
    eas.params.eas_contract = MAROO_EAS_CONTRACT
    eas.params.indexer_contract = MAROO_EAS_INDEXER_CONTRACT
  }

  const agent = (genesis.app_state as Record<string, unknown>).agent as
    | { params?: { identity_registry_address?: string; reputation_registry_address?: string } }
    | undefined
  if (agent?.params) {
    agent.params.identity_registry_address = MAROO_AGENT_IDENTITY_REGISTRY
    agent.params.reputation_registry_address = MAROO_AGENT_REPUTATION_REGISTRY
  }

  return userPatch ? userPatch(genesis) : genesis
}

/**
 * Defines a marood (maroo) instance.
 *
 * maroo is a cosmos-evm chain with a split denom model: staking is
 * denominated in `(at)maroo` while fees, gov and the EVM run on the
 * 18-decimal `a(t)okrw` — starskiff's `denom` maps to the BOND denom here,
 * and the preset's `feeDenom` is wired into everything else.
 *
 * marood has **no default image** — the node source is private and must not be
 * redistributed — so the node source must be injected: pass `binary` (a local
 * executable on PATH) or `image` (e.g. a private image where your CI allows
 * it). Constructing without either throws.
 *
 * Targets maroo v0.11. A plain `marood init` writes a genesis draft without
 * Privacy state. This instance installs the supplied fresh V4 JSON and mirrors
 * the repo's `local_node.sh` — including the preinstalls viem's
 * `marooTestnet.contracts` assumes at `blockCreated: 0` (Multicall3 et al)
 * and the okrw/pcl/eas/agent module params the maroo precompiles require.
 *
 * @example
 * ```ts
 * const instance = Instance.marood({
 *   binary: 'marood', // or image: a private image ref
 *   privacyGenesis: '/absolute/path/to/privacy-genesis.json',
 *   privacyZkArtifacts: { directory: '/absolute/path/to/audit-field-artifacts' },
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000atokrw' }],
 * })
 * await instance.start()
 * // eth_chainId → 450815 (viem marooTestnet); marood({ network: 'mainnet' }) → 815
 * await instance.stop()
 * ```
 */
export const marood = Instance.define((parameters: MaroodParameters) => {
  const params = parameters || {}
  const preset = MAROO_NETWORKS[params.network ?? 'testnet']
  const {
    binary = 'marood',
    network: _network,
    chainId = preset.chainId,
    denom = preset.bondDenom,
    prefix = 'maroo',
    // 18-decimal chain: power reduction is 1e18, so stake amounts mirror evmd.
    validatorBalance = '100000000000000000000000', // 1e23
    validatorStake = '10000000000000000000000',    // 1e22
    minimumGasPrices = `0${preset.feeDenom}`,
    preinstalls = MAROO_PREINSTALLS,
    policyAdmin,
    minterAddress,
    entrypoints,
    privacyGenesis,
    privacyZkArtifacts,
    patchGenesis: userPatch,
    ...rest
  } = params

  // No default image (private node source): image or binary required.
  const image = resolveInstanceImage('marood', params)
  if (typeof privacyGenesis !== 'string' || !path.isAbsolute(privacyGenesis)) {
    throw new Error('marood: privacyGenesis must be an absolute host path to a fresh Privacy V4 JSON file.')
  }
  const privacyZkRuntime = resolveMaroodPrivacyZkRuntime(privacyZkArtifacts, Boolean(image))

  // Same three-state semantics as evmd: omitted → maroo default set; explicit
  // `undefined` → binary default; `[]` / `[...]` → as given.
  const activeStaticPrecompiles =
    'activeStaticPrecompiles' in params ? params.activeStaticPrecompiles : MAROO_DEFAULT_PRECOMPILES

  return cosmosEvmBase({
    binary, name: 'marood', chainId, denom, prefix, validatorBalance, validatorStake,
    minimumGasPrices, ...rest,
    image,
    runtime: privacyZkRuntime,
    // app.toml's compiled-in default is the mainnet EVM chain id; make the
    // preset authoritative for both networks.
    evmChainId: preset.evmChainId,
    activeStaticPrecompiles,
    patchGenesis: (genesis) =>
      patchMaroodGenesis(genesis, { preset, preinstalls, privacyGenesis, policyAdmin, minterAddress, entrypoints, patchGenesis: userPatch }),
  })
})
