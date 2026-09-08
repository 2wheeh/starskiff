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
  /** Fee + EVM denom (18 decimals; gov, mint, `evm.params.evm_denom`). */
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

/** ERC20 representation of maroo's native fee denom (erc20 native precompile). */
export const MAROO_NATIVE_ERC20 = '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE'

/**
 * Default active static precompiles for marood.
 *
 * Mirrors `precompiles/types.DefaultActiveStaticPrecompiles()` in the maroo
 * repo: the cosmos-evm `x/vm` available set minus Vesting (0x…0803), plus
 * maroo's own precompiles.
 */
export const MAROO_DEFAULT_PRECOMPILES: readonly string[] = [
  '0x0000000000000000000000000000000000000100', // P256
  '0x0000000000000000000000000000000000000400', // Bech32
  '0x0000000000000000000000000000000000000800', // Staking
  '0x0000000000000000000000000000000000000801', // Distribution
  '0x0000000000000000000000000000000000000802', // ICS20
  '0x0000000000000000000000000000000000000804', // Bank
  '0x0000000000000000000000000000000000000805', // Gov
  '0x0000000000000000000000000000000000000806', // Slashing
  '0x0000000000000000000000000000000000000807', // ICS02
  '0x1000000000000000000000000000000000000001', // OKRW
  '0x1000000000000000000000000000000000000005', // PCL
  '0x1000000000000000000000000000000000000009', // EAS
  '0x100000000000000000000000000000000000000A', // Agent
  '0x100000000000000000000000000000000000000b', // Privacy (maroo v0.8+)
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

/**
 * Default `pcl.params.entrypoints` — the "Entrypoint v8" preinstall
 * (0x4337084d9e255ff0702461cf8895ce9e3b5ff108) in bech32, which
 * {@link MAROO_PREINSTALLS} already seeds at genesis.
 */
export const MAROO_DEFAULT_PCL_ENTRYPOINTS: readonly string[] = [
  'maroo1gvmssnv7y40lqupyv88c39wwnca4luggmf5lq0',
]

export type MaroodPrivacyZkArtifacts =
  | {
      kind: 'generated-test'
      /** Absolute host path containing generated, non-production test artifacts. */
      directory: string
    }
  | {
      kind: 'release'
      /** Absolute host path containing an approved release artifact bundle. */
      directory: string
    }

export type MaroodParameters = Omit<CosmosEvmChainParameters, 'image'> & InstanceSource & {
  /**
   * External Privacy ZK artifacts required by maroo v0.8+.
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
   * precompile's admin methods. Also updates the existing Privacy contract-policy
   * admin in maroo v0.8 genesis, preserving its policies. Omit to retain genesis admins.
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
const TEST_PRIVACY_RELEASE_ENV = 'MAROO_TEST_PRIVACY_RELEASE_FROM_ARTIFACTS'

/** Translates the marood-specific option into custom-chain runtime options. */
export function resolveMaroodPrivacyZkRuntime(
  artifacts: MaroodPrivacyZkArtifacts | undefined,
  containerRuntime: boolean,
): RuntimeOptions | undefined {
  if (!artifacts) return undefined

  if (artifacts.kind !== 'generated-test' && artifacts.kind !== 'release') {
    throw new Error(
      'marood: privacyZkArtifacts.kind must be "generated-test" or "release".',
    )
  }
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
  }

  if (artifacts.kind === 'generated-test') {
    environment[TEST_PRIVACY_RELEASE_ENV] = '1'
  } else {
    environment[PRIVACY_ZK_RUNTIME_ENVIRONMENT_ENV] = 'production'
  }

  return {
    environment,
    unsetEnvironment: artifacts.kind === 'release' ? [TEST_PRIVACY_RELEASE_ENV] : undefined,
    mounts: containerRuntime
      ? [{ source: artifacts.directory, target: PRIVACY_ZK_CONTAINER_DIRECTORY, readOnly: true }]
      : undefined,
  }
}

/** Options for {@link patchMaroodGenesis}, mirroring the relevant `MaroodParameters`. */
export type PatchMaroodGenesisOptions = {
  preset: MaroodNetworkPreset
  preinstalls: readonly EvmPreinstall[]
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
 * bank metadata, the native OKRW ERC20 pair, genesis preinstalls, and the
 * okrw/pcl/eas/agent module params — their precompile constructors read those
 * at startup, and on a bare `marood init` genesis (cosmos/evm defaults, not
 * maroo's) they fail, silently dropping the maroo precompiles from the EVM's
 * available set.
 *
 * Every module patch is guarded by a presence check (`app[module]?.params`)
 * since callers may run this against other genesis layouts. Runs before
 * `opts.patchGenesis` so caller overrides always win.
 */
export function patchMaroodGenesis(genesis: Genesis, opts: PatchMaroodGenesisOptions): Genesis {
  const { preset, preinstalls, policyAdmin, minterAddress, entrypoints, patchGenesis: userPatch } = opts
  const feeDenom = preset.feeDenom

  // cosmosBase's patchDenom pointed mint/gov at the bond denom; maroo
  // denominates those in the fee denom.
  if (genesis.app_state.mint?.params) {
    genesis.app_state.mint.params.mint_denom = feeDenom
  }
  const gov = genesis.app_state.gov
  if (gov?.params?.min_deposit?.[0]) gov.params.min_deposit[0].denom = feeDenom
  const govParams = gov?.params as
    | { expedited_min_deposit?: { denom: string }[] }
    | undefined
  if (govParams?.expedited_min_deposit?.[0]) {
    govParams.expedited_min_deposit[0].denom = feeDenom
  }

  // EVM denom: init default is aatom; startup panics unless it points at
  // a denom with bank metadata.
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

  // Native OKRW ERC20 representation (app/genesis.go NewErc20GenesisState).
  const erc20 = (genesis.app_state as Record<string, unknown>).erc20 as
    | { token_pairs?: unknown[]; native_precompiles?: string[] }
    | undefined
  if (erc20) {
    erc20.token_pairs = [
      { contract_owner: 1, erc20_address: MAROO_NATIVE_ERC20, denom: feeDenom, enabled: true },
    ]
    erc20.native_precompiles = [MAROO_NATIVE_ERC20]
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
        contract_policies?: { config: { contract: string; admin: string } }[]
      }
    | undefined
  if (pcl?.params) {
    if (policyAdmin) pcl.params.policy_admin = policyAdmin
    pcl.params.entrypoints = [...(entrypoints ?? MAROO_DEFAULT_PCL_ENTRYPOINTS)]
  }

  if (policyAdmin) {
    // v0.8 seeds this separately from the PCL module admin. Keep its mandatory
    // EAS/denylist baseline and all unrelated contract policies intact.
    for (const policy of pcl?.contract_policies ?? []) {
      if (policy.config.contract === 'maroo1zqqqqqqqqqqqqqqqqqqqqqqqqqqqqqqt575gw7') {
        policy.config.admin = policyAdmin
      }
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
 * denominated in `(at)maroo` while fees, gov, mint and the EVM run on the
 * 18-decimal `a(t)okrw` — starskiff's `denom` maps to the BOND denom here,
 * and the preset's `feeDenom` is wired into everything else.
 *
 * marood has **no default image** — the node source is private and must not be
 * redistributed — so the node source must be injected: pass `binary` (a local
 * executable on PATH) or `image` (e.g. a private image where your CI allows
 * it). Constructing without either throws.
 *
 * A plain `marood init` writes cosmos/evm module defaults rather than
 * maroo's app-side defaults, so this instance runs {@link patchMaroodGenesis}
 * to mirror the repo's `local_node.sh` — including the preinstalls viem's
 * `marooTestnet.contracts` assumes at `blockCreated: 0` (Multicall3 et al)
 * and the okrw/pcl/eas/agent module params the maroo precompiles require.
 *
 * @example
 * ```ts
 * const instance = Instance.marood({
 *   binary: 'marood', // or image: a private image ref
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
    privacyZkArtifacts,
    patchGenesis: userPatch,
    ...rest
  } = params

  // No default image (private node source): image or binary required.
  const image = resolveInstanceImage('marood', params)
  const privacyZkRuntime = resolveMaroodPrivacyZkRuntime(privacyZkArtifacts, Boolean(image))

  // Same three-state semantics as evmd: omitted → maroo default set; explicit
  // `undefined` → binary default (empty); `[]` / `[...]` → as given.
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
      patchMaroodGenesis(genesis, { preset, preinstalls, policyAdmin, minterAddress, entrypoints, patchGenesis: userPatch }),
  })
})
