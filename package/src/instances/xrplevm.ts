import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Official XRPL EVM node image (published by Peersyst, the chain's dev shop),
 * pinned to the version running on mainnet (`xrplevm_1440000-1`). Used unless
 * the caller opts into a binary.
 *
 * NOTE: published for linux/amd64 only. On arm64 hosts pre-pull with
 * `docker pull --platform linux/amd64 peersyst/exrp:<tag>` to run it under
 * emulation, or pass a `binary`.
 */
export const XRPLEVM_DEFAULT_IMAGE = 'peersyst/exrp:v10.0.2'

export type XrplevmParameters = CosmosEvmChainParameters & {
  /**
   * Run from a local `exrpd` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "exrpd" (only when opted in)
   */
  binary?: string
  /** Chain-specific genesis patch, chained after xrplevm's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * Defines an xrplevm (XRPL EVM sidechain) instance.
 *
 * XRPL EVM is a cosmos/evm chain (migrated off the Evmos framework at v9) with
 * XRP as its 18-decimal native denom (`axrp`) and the `ethm` bech32 prefix.
 * The default chain id mirrors mainnet (`xrplevm_1440000-1`), so `eth_chainId`
 * is `1440000` — matching viem's XRPL EVM chain definition.
 *
 * Peersyst publishes the official node image, so this instance is
 * container-first on {@link XRPLEVM_DEFAULT_IMAGE} (amd64-only — see the
 * constant's note for arm64 hosts). Docker must be running. As with every
 * instance, pass `binary` to run a local executable, or `image` to bind your
 * own.
 *
 * @example
 * ```ts
 * const instance = Instance.xrplevm({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000axrp' }],
 * })
 * await instance.start()
 * // eth_chainId → 1440000
 * await instance.stop()
 * ```
 */
export const xrplevm = Instance.define((parameters?: XrplevmParameters) => {
  const params = parameters || {}
  const {
    binary = 'exrpd',
    chainId = 'xrplevm_1440000-1',
    denom = 'axrp',
    prefix = 'ethm',
    // 18-decimal denom needs large amounts (power reduction 1e18).
    validatorBalance = '100000000000000000000000', // 1e23
    validatorStake = '10000000000000000000000',    // 1e22
    patchGenesis: userPatch,
    ...rest
  } = params

  const image = resolveInstanceImage('xrplevm', params, XRPLEVM_DEFAULT_IMAGE)

  // eth_chainId is NOT derived from the cosmos chain id — app.toml's
  // compiled-in default is 9999. Mirror mainnet's 1440000 explicitly.
  const evmChainId = Number((chainId.match(/_(\d+)-/) ?? [])[1] ?? 1440000)

  return cosmosEvmBase({
    binary, name: 'xrplevm', chainId, denom, prefix, validatorBalance, validatorStake, ...rest,
    image,
    extraStartArgs: ['--evm.evm-chain-id', String(evmChainId)],
    // exrpd's newApp reads the genesis through CometBFT's GenesisDoc parser,
    // which requires int64 fields to be STRING-encoded — but the SDK writes
    // `initial_height` as a JSON number (and re-writes it on every genesis
    // command). Re-encode after collect-gentxs, the last SDK rewrite, or the
    // node panics on start ("invalid 64-bit integer encoding … expected string").
    finalizeGenesis: (genesis) => {
      const doc = genesis as { initial_height?: number | string }
      doc.initial_height = String(doc.initial_height ?? '1')
      return genesis
    },
    patchGenesis: (genesis) => {
      // A fresh `exrpd init` writes cosmos/evm module defaults: evm_denom
      // `aatom` and no bank denom metadata. Point the EVM at the native denom
      // and provide the 18-decimal metadata the EVM coin-info init requires.
      const evm = (genesis.app_state as Record<string, unknown>).evm as
        | { params: { evm_denom?: string; extended_denom_options?: { extended_denom: string } } }
        | undefined
      if (evm?.params) {
        evm.params.evm_denom = denom
        if (evm.params.extended_denom_options) {
          evm.params.extended_denom_options.extended_denom = denom
        }
      }

      const display = denom.replace(/^a/, '')
      if (genesis.app_state.bank) {
        // If denom has no leading `a` (e.g. plain "stake"), display === denom
        // — a second denom_units entry would duplicate the denom and fail
        // genesis validation, so collapse to a single unit in that case.
        const denomUnits = display === denom
          ? [{ denom, exponent: 0, aliases: [] }]
          : [
              { denom, exponent: 0, aliases: [] },
              { denom: display, exponent: 18, aliases: [] },
            ]
        genesis.app_state.bank.denom_metadata = [{
          description: 'The native token.',
          denom_units: denomUnits,
          base: denom,
          display,
          name: display.toUpperCase(),
          symbol: display.toUpperCase(),
          uri: '',
          uri_hash: '',
        }]
      }

      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
