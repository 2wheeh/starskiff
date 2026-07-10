import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
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
]

export type MaroodParameters = CosmosEvmChainParameters & {
  /** Path to the marood binary. @default "marood" */
  binary?: string
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
  /** Chain-specific genesis patch, chained after marood's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * Defines a marood (maroo) instance.
 *
 * maroo is a cosmos-evm chain with a split denom model: staking is
 * denominated in `(at)maroo` while fees, gov, mint and the EVM run on the
 * 18-decimal `a(t)okrw` — starskiff's `denom` maps to the BOND denom here,
 * and the preset's `feeDenom` is wired into everything else.
 *
 * A plain `marood init` writes cosmos/evm module defaults (evm_denom `aatom`,
 * empty bank metadata / erc20 pairs / precompiles / preinstalls) rather than
 * maroo's app-side defaults, so this instance mirrors the jq patches in the
 * repo's `local_node.sh`: EVM denom + bank metadata, the native OKRW ERC20
 * pair, maroo's static precompiles, and the canonical genesis preinstalls
 * (Multicall3 et al — which viem's `marooTestnet.contracts` assumes at
 * `blockCreated: 0`).
 *
 * @example
 * ```ts
 * const instance = Instance.marood({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000atokrw' }],
 * })
 * await instance.start()
 * // eth_chainId → 450815 (viem marooTestnet); marood({ network: 'mainnet' }) → 815
 * await instance.stop()
 * ```
 */
export const marood = Instance.define((parameters?: MaroodParameters) => {
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
    patchGenesis: userPatch,
    ...rest
  } = params

  const feeDenom = preset.feeDenom

  // Same three-state semantics as evmd: omitted → maroo default set; explicit
  // `undefined` → binary default (empty); `[]` / `[...]` → as given.
  const activeStaticPrecompiles =
    'activeStaticPrecompiles' in params ? params.activeStaticPrecompiles : MAROO_DEFAULT_PRECOMPILES

  return cosmosEvmBase({
    binary, name: 'marood', chainId, denom, prefix, validatorBalance, validatorStake,
    minimumGasPrices, ...rest,
    activeStaticPrecompiles,
    // app.toml's compiled-in default is the mainnet EVM chain id; make the
    // preset authoritative for both networks.
    extraStartArgs: ['--evm.evm-chain-id', String(preset.evmChainId)],
    patchGenesis: (genesis) => {
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
        if (preinstalls.length > 0) evm.preinstalls = preinstalls
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

      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
