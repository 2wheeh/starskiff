import { expect, inject, it } from 'vitest'
import type { StarskiffContext } from 'starskiff/vitest'

declare module 'vitest' {
  export interface ProvidedContext {
    starskiff: StarskiffContext
  }
}

it('receives the running dependency through the worker context', async () => {
  const { chains, relayers } = inject('starskiff')
  const response = await fetch(chains.local.rpcUrl)
  expect(await response.json()).toEqual({ chainId: 'fixture-1' })
  expect(chains.local).not.toHaveProperty('start')
  expect(relayers).toEqual([])
})

it('shares the same instance throughout the project', async () => {
  const { chains } = inject('starskiff')
  expect((await fetch(chains.local.rpcUrl)).ok).toBe(true)
})
