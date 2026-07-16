import * as Instance from '../Instance.js'
import { cosmosEvmBase, type CosmosEvmChainParameters, type Genesis } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Default active static precompiles for evmd.
 *
 * Mirrors `x/vm/types.AvailableStaticPrecompiles` in cosmos/evm (the canonical
 * reference chain), sorted ascending as required by cosmos-evm genesis
 * validation. NOTE: a plain `evmd init` leaves `active_static_precompiles`
 * EMPTY — none of the precompiles are callable unless this list is written to
 * genesis. evmd therefore defaults to the full available set so the bank,
 * staking, distribution and gov precompiles work out of the box.
 */
export const EVMD_DEFAULT_PRECOMPILES: readonly string[] = [
  '0x0000000000000000000000000000000000000100', // P256
  '0x0000000000000000000000000000000000000400', // Bech32
  '0x0000000000000000000000000000000000000800', // Staking
  '0x0000000000000000000000000000000000000801', // Distribution
  '0x0000000000000000000000000000000000000802', // ICS20
  '0x0000000000000000000000000000000000000803', // Vesting
  '0x0000000000000000000000000000000000000804', // Bank
  '0x0000000000000000000000000000000000000805', // Gov
  '0x0000000000000000000000000000000000000806', // Slashing
  '0x0000000000000000000000000000000000000807', // ICS02
]

/**
 * Image starskiff publishes for evmd, pinned to the upstream ref built by
 * `.github/workflows/publish-images.yml` (source of truth: `config/images.json`).
 *
 * cosmos/evm ships no official image, so — unlike a chain that publishes its
 * own — starskiff builds and redistributes this one to its public GHCR
 * namespace. Pinned to the multi-arch manifest **digest** (immutable: a
 * re-pushed tag can't change what this resolves to); CI asserts it equals
 * `config/images.json`. The digest corresponds to upstream cosmos/evm v0.7.0.
 */
export const EVMD_DEFAULT_IMAGE =
  'ghcr.io/2wheeh/starskiff/evmd@sha256:609d198aa5407cebf06b0abfa6b092b3241dbbffe420d8657a7cd597d4b3b1d6'

export type EvmdParameters = CosmosEvmChainParameters & {
  /**
   * Run from a local `evmd` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "evmd" (only when opted in)
   */
  binary?: string
  /** Chain-specific genesis patch, chained after evmd's defaults. */
  patchGenesis?: (genesis: Genesis) => Genesis
}

/**
 * Defines an evmd instance.
 *
 * `evmd` is the canonical Cosmos EVM reference chain (cosmos/evm `./cmd/evmd`).
 * Its precompiles sit at their default `x/vm` addresses (bank at `0x…0804`,
 * staking at `0x…0800`, etc.), which makes it the most faithful target for
 * testing the standard cosmos-evm precompile ABIs.
 *
 * cosmos/evm publishes no image, so this instance is container-first on an
 * image **starskiff builds and redistributes** ({@link EVMD_DEFAULT_IMAGE}) —
 * no Go toolchain, no `go build`. Docker must be running. As with every
 * instance, pass `binary` to run a local executable instead, or `image` to
 * bind your own.
 *
 * A fresh `evmd init` produces a genesis denominated entirely in `stake`
 * (bond, mint, gov and `evm.evm_denom`), with an empty precompile set and no
 * bank denom metadata. This instance fills those gaps: it enables the full set
 * of static precompiles and writes 18-decimal denom metadata required by the
 * EVM coin-info initialization. The compiled-in EVM chain ID is `262144`
 * (`x/vm/types.DefaultEVMChainID`), exposed over JSON-RPC as `eth_chainId`.
 *
 * @example
 * ```ts
 * // container (default)
 * const instance = Instance.evmd({
 *   accounts: [{ mnemonic: '...', coins: '1000000000000000000000stake' }],
 * })
 *
 * // escape hatches
 * Instance.evmd({ image: 'my-registry/evmd:custom' }) // bind your own image
 * Instance.evmd({ binary: 'evmd' })                   // local binary on PATH
 * ```
 */
export const evmd = Instance.define((parameters?: EvmdParameters) => {
  const params = parameters || {}
  const {
    binary = 'evmd',
    chainId = 'cosmos_262144-1',
    denom = 'atest',
    prefix = 'cosmos',
    // 18-decimal denom needs large amounts: evmd power reduction is 1e18.
    validatorBalance = '100000000000000000000000', // 1e23
    validatorStake = '10000000000000000000000',    // 1e22
    patchGenesis: userPatch,
    ...rest
  } = params

  const image = resolveInstanceImage('evmd', params, EVMD_DEFAULT_IMAGE)

  // Preserve the three-state semantics of `activeStaticPrecompiles`:
  // omitted → evmd default (full set); explicit `undefined` → pass through
  // (binary default, which is empty); `[]` → disable all; `[...]` → overwrite.
  const activeStaticPrecompiles =
    'activeStaticPrecompiles' in params ? params.activeStaticPrecompiles : EVMD_DEFAULT_PRECOMPILES

  return cosmosEvmBase({
    binary, name: 'evmd', chainId, denom, prefix, validatorBalance, validatorStake, ...rest,
    image,
    activeStaticPrecompiles,
    // evmd enables the app-side EVM mempool, which requires comet-bft's
    // config.toml `mempool.type = "app"` (a fresh init writes "flood").
    extraConfigToml: { 'mempool.type': 'app' },
    // Cosmos SDK ≥ v0.54 validates the baseapp chain id against genesis on
    // InitChain; pass --chain-id on start so the handshake matches. (Older SDK
    // chains like simd/xplad don't accept this flag, hence it's evmd-scoped.)
    extraStartArgs: ['--chain-id', chainId],
    patchGenesis: (genesis) => {
      // The EVM coin-info init reads bank denom_metadata to resolve the
      // display/base units of the evm_denom. A fresh evmd genesis ships no
      // metadata, so provide an 18-decimal entry for the native denom.
      // evmd denoms are atto-prefixed (e.g. atest → test).
      const display = denom.replace(/^[au]/, '')
      if (genesis.app_state.bank) {
        // If denom has no leading a/u (e.g. plain "stake"), display === denom
        // — a second denom_units entry would duplicate the denom and fail
        // genesis validation, so collapse to a single unit in that case.
        const denomUnits = display === denom
          ? [{ denom, exponent: 0, aliases: [] }]
          : [
              { denom, exponent: 0, aliases: [] },
              { denom: display, exponent: 18, aliases: [] },
            ]
        genesis.app_state.bank.denom_metadata = [{
          description: 'The native staking and EVM token.',
          denom_units: denomUnits,
          base: denom,
          display,
          name: display.toUpperCase(),
          symbol: display.toUpperCase(),
          uri: '',
          uri_hash: '',
        }]
      }

      // Keep evm_denom aligned with the native denom (a plain init leaves it
      // as `stake`; patchDenom does not touch evm_denom, so set it here).
      const evm = (genesis.app_state as Record<string, unknown>).evm as
        | { params: { evm_denom?: string } }
        | undefined
      if (evm?.params) evm.params.evm_denom = denom

      return userPatch ? userPatch(genesis) : genesis
    },
  })
})
