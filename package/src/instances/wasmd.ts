import * as Instance from '../Instance.js'
import { cosmosBase, type CosmosChainParameters } from '../cosmos.js'

export type WasmdParameters = CosmosChainParameters & {
  /** Path to the wasmd binary. @default "wasmd" */
  binary?: string
}

/**
 * Defines a wasmd (CosmWasm) instance.
 *
 * Includes IBC and CosmWasm modules on top of the standard Cosmos SDK modules.
 *
 * @example
 * ```ts
 * const instance = Instance.wasmd({
 *   chainId: 'wasm-test-1',
 *   accounts: [{ mnemonic: '...', coins: '1000000000stake' }],
 * })
 * await instance.start()
 * // instance.chainId → 'wasm-test-1'
 * await instance.stop()
 * ```
 */
export const wasmd = Instance.define((parameters?: WasmdParameters) => {
  const { binary = 'wasmd', ...rest } = parameters || {}
  return cosmosBase({ binary, name: 'wasmd', ...rest })
})
