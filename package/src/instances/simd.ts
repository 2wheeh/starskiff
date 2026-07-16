import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'
import { resolveInstanceImage } from '../docker.js'

/**
 * Official Cosmos SDK simapp image. Pinned to a MINOR line (`v0.53`), not a
 * patch — `ghcr.io/cosmos/simapp` only tags minor lines, so this follows the
 * latest patch of that line rather than an exact version. Used unless the
 * caller opts into a binary.
 */
export const SIMD_DEFAULT_IMAGE = 'ghcr.io/cosmos/simapp:v0.53'

export type SimdParameters = CosmosChainParameters & {
  /**
   * Run from a local `simd` binary on `PATH` instead of the image.
   * Passing this at all opts out of the container runtime.
   * @default "simd" (only when opted in)
   */
  binary?: string
}

/**
 * Defines a simd (Cosmos SDK simapp) instance.
 *
 * Container-first on the official simapp image ({@link SIMD_DEFAULT_IMAGE}) —
 * no Go toolchain, just Docker. Note the image only pins a minor line, so it
 * tracks the latest patch of `v0.53`. Pass `binary` to run a local executable
 * (e.g. an exact-version build), or `image` to bind your own.
 *
 * @example
 * ```ts
 * const instance = Instance.simd({
 *   chainId: 'test-1',
 *   accounts: [{ mnemonic: '...', coins: '1000000000stake' }],
 * })
 * await instance.start()
 * await instance.stop()
 * ```
 */
export const simd = Instance.define((parameters?: SimdParameters) => {
  const params = parameters || {}
  const { binary = 'simd', ...rest } = params
  const image = resolveInstanceImage(params, SIMD_DEFAULT_IMAGE)
  return cosmosBase({ binary, name: 'simd', ...rest, image })
})
