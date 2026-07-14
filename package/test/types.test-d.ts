import { Instance } from '../src/index.js'
import { expectTypeOf } from 'vitest'

// CosmosInstance extra fields should be inferred
const chain = Instance.wasmd({ chainId: 'test', prefix: 'wasm' })
expectTypeOf(chain.chainId).toBeString()
expectTypeOf(chain.prefix).toBeString()
expectTypeOf(chain.denom).toBeString()
expectTypeOf(chain.grpcPort).toBeNumber()
expectTypeOf(chain.apiPort).toBeNumber()

// Base Instance fields still work
expectTypeOf(chain.host).toBeString()
expectTypeOf(chain.port).toBeNumber()
expectTypeOf(chain.name).toBeString()
expectTypeOf(chain.start).toBeFunction()
expectTypeOf(chain.stop).toBeFunction()

// simd too
const simdChain = Instance.simd({ chainId: 'test' })
expectTypeOf(simdChain.chainId).toBeString()
expectTypeOf(simdChain.grpcPort).toBeNumber()

// Plain define without extras — no extra fields
const plain = Instance.define(() => ({
  name: 'plain',
  host: 'localhost',
  port: 3000,
  async start() {},
  async stop() {},
}))()

expectTypeOf(plain.host).toBeString()
expectTypeOf(plain.start).toBeFunction()
