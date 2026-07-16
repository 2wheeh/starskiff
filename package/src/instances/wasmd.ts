import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Official CosmWasm image, pinned to an exact release tag (CosmWasm publishes
 * per-version tags, so this tracks a real version rather than a floating tag).
 * Used unless the caller opts into a binary.
 */
export const WASMD_DEFAULT_IMAGE = 'cosmwasm/wasmd:v0.61.14'

export type WasmdParameters = CosmosChainParameters & {
  /**
   * Run from a local `wasmd` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "wasmd" (only when opted in)
   */
  binary?: string
}

/**
 * Defines a wasmd (CosmWasm) instance.
 *
 * Includes IBC and CosmWasm modules on top of the standard Cosmos SDK modules.
 *
 * CosmWasm publishes an official image, so this instance is container-first: it
 * runs {@link WASMD_DEFAULT_IMAGE} out of the box — no Go toolchain, no manual
 * build. Docker must be running. As with every instance, pass `binary` to run a
 * local executable instead, or `image` to bind your own.
 *
 * @example
 * ```ts
 * // container (default)
 * const instance = Instance.wasmd({
 *   chainId: 'wasm-test-1',
 *   accounts: [{ mnemonic: '...', coins: '1000000000stake' }],
 * })
 *
 * // escape hatches
 * Instance.wasmd({ image: 'my-registry/wasmd:custom' }) // bind your own image
 * Instance.wasmd({ binary: 'wasmd' })                   // local binary on PATH
 * ```
 */
export const wasmd = Instance.define((parameters?: WasmdParameters) => {
  const params = parameters || {}
  const { binary = 'wasmd', ...rest } = params
  const image = resolveInstanceImage('wasmd', params, WASMD_DEFAULT_IMAGE)
  // image after ...rest so the resolved value wins over any stray image key.
  return cosmosBase({ binary, name: 'wasmd', ...rest, image })
})
