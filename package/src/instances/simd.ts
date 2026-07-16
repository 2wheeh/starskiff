import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'

export type SimdParameters = CosmosChainParameters & {
  /** Path to the simd binary. @default "simd" */
  binary?: string
}

/**
 * Defines a simd (Cosmos SDK simapp) instance.
 *
 * @example
 * ```ts
 * const instance = Instance.simd({
 *   chainId: 'test-1',
 *   accounts: [{ mnemonic: '...', coins: '1000000000stake' }],
 * })
 * await instance.start()
 * // instance.chainId → 'test-1'
 * await instance.stop()
 * ```
 */
export const simd = Instance.define((parameters?: SimdParameters) => {
  const { binary = 'simd', ...rest } = parameters || {}
  return cosmosBase({ binary, name: 'simd', ...rest })
})
