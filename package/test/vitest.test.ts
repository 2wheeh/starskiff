import { beforeEach, describe, expect, it, vi } from 'vitest'
import { defineConfig, Instance, type CosmosChainParameters, type DefinedStarskiffConfig } from '../src/index.js'
import { createGlobalSetup, type StarskiffContext } from '../src/vitest.js'
import { reservePort } from '../src/ports.js'

vi.mock('../src/ports.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/ports.js')>(),
  reservePort: vi.fn(),
}))

type TestParameters = CosmosChainParameters & { evmPort?: number; marker?: string }
const events: string[] = []
const releases: ReturnType<typeof vi.fn>[] = []

function chainFactory(name: string, hooks: {
  start?: () => Promise<void>
  stop?: () => Promise<void>
  evm?: boolean
} = {}) {
  return vi.fn(Instance.define((parameters?: TestParameters) => ({
    name,
    host: '127.0.0.1',
    port: parameters?.rpcPort ?? 26657,
    chainId: parameters?.chainId ?? name,
    prefix: 'cosmos',
    denom: 'stake',
    grpcPort: parameters?.grpcPort ?? 9090,
    apiPort: parameters?.apiPort ?? 1317,
    rpcUrl: `http://127.0.0.1:${parameters?.rpcPort}`,
    grpcUrl: `http://127.0.0.1:${parameters?.grpcPort}`,
    apiUrl: `http://127.0.0.1:${parameters?.apiPort}`,
    ...(hooks.evm ? { evmUrl: `http://127.0.0.1:${parameters?.evmPort}` } : {}),
    async start() {
      events.push(`start ${name}`)
      await hooks.start?.()
      events.push(`ready ${name}`)
    },
    async stop() {
      events.push(`stop ${name}`)
      await hooks.stop?.()
      events.push(`stopped ${name}`)
    },
  })))
}

function withRelayer(config: DefinedStarskiffConfig, hooks: {
  start?: () => Promise<void>
  stop?: () => Promise<void>
} = {}) {
  const factory = vi.fn(Instance.define((_parameters: Parameters<typeof Instance.hermes>[0]) => ({
    name: 'hermes', host: '127.0.0.1', port: 3001,
    async start() {
      events.push('start hermes')
      await hooks.start?.()
    },
    async stop() {
      events.push('stop hermes')
      await hooks.stop?.()
      events.push('stopped hermes')
    },
  })))
  config.relayers[0].factory = factory
  return factory
}

beforeEach(() => {
  events.length = 0
  releases.length = 0
  let nextPort = 40_000
  vi.mocked(reservePort).mockReset().mockImplementation(async (excluded) => {
    while (excluded.has(nextPort)) nextPort++
    const release = vi.fn(async () => {})
    releases.push(release)
    return { port: nextPort++, release }
  })
})

describe('createGlobalSetup', () => {
  it('preserves explicit parameters, allocates missing ports, and provides serializable endpoints', async () => {
    const factory = chainFactory('wasm')
    const evm = chainFactory('evm', { evm: true })
    const parameters = { chainId: 'wasm-1', rpcPort: 40_000, grpcPort: undefined, marker: 'retained' }
    const config = defineConfig({ chains: {
      wasm: { factory, parameters, options: { timeout: 1500 } },
      evm: { factory: evm },
    } })
    const provide = vi.fn()
    expect(factory).not.toHaveBeenCalled()
    const teardown = await createGlobalSetup(config)({ provide })
    const [actualParameters, actualOptions] = factory.mock.calls[0]
    expect(actualParameters).toMatchObject({ chainId: 'wasm-1', rpcPort: 40_000, marker: 'retained' })
    expect(actualParameters?.grpcPort).toBeTypeOf('number')
    expect(actualOptions).toEqual({ timeout: 1500 })
    expect(parameters).toEqual({ chainId: 'wasm-1', rpcPort: 40_000, grpcPort: undefined, marker: 'retained' })
    const [key, context] = provide.mock.calls[0] as ['starskiff', StarskiffContext]
    expect(key).toBe('starskiff')
    expect(context.chains.wasm.rpcUrl).toBe('http://127.0.0.1:40000')
    expect(context.chains.evm.evmUrl).toBeTypeOf('string')
    expect(context.chains.wasm).not.toHaveProperty('start')
    expect(context.chains.wasm).not.toHaveProperty('marker')
    expect(structuredClone(context)).toEqual(context)
    expect(context.relayers).toEqual([])
    expect(releases.every((release) => release.mock.calls.length > 0)).toBe(true)
    await teardown()
  })

  it('waits for every chain before starting Hermes and stops it before the chains', async () => {
    const a = chainFactory('a')
    const b = chainFactory('b')
    const config = defineConfig({
      chains: { a: { factory: a }, b: { factory: b } },
      relayers: { hermes: { mnemonic: 'test', channels: [['a', 'b'], ['a', 'b']] } },
    })
    const hermes = withRelayer(config, { start: async () => {
      expect(events).toContain('ready a')
      expect(events).toContain('ready b')
    } })
    const teardown = await createGlobalSetup(config)({ provide: vi.fn() })
    expect(hermes.mock.calls[0][0]?.channels).toEqual([
      [a.mock.results[0].value, b.mock.results[0].value],
      [a.mock.results[0].value, b.mock.results[0].value],
    ])
    expect(hermes.mock.calls[0][0]?.telemetryPort).not.toBe(3001)
    await Promise.all([teardown(), teardown()])
    expect(events.filter((event) => event.startsWith('stop'))).toEqual([
      'stop hermes', 'stopped hermes', 'stop b', 'stopped b', 'stop a', 'stopped a',
    ])
  })

  it('waits for in-flight starts before rolling back a partial failure', async () => {
    const failure = new Error('chain a failed')
    const pending = Promise.withResolvers<void>()
    const a = chainFactory('a', { start: async () => { throw failure } })
    const b = chainFactory('b', { start: () => pending.promise })
    const config = defineConfig({ chains: { a: { factory: a }, b: { factory: b } } })
    const provide = vi.fn()
    const setup = createGlobalSetup(config)({ provide })
    const rejected = expect(setup).rejects.toBe(failure)
    await vi.waitFor(() => expect(events).toContain('start b'))
    expect(events).not.toContain('stop a')
    pending.resolve()
    await rejected
    expect(events.indexOf('stop b')).toBeGreaterThan(events.indexOf('ready b'))
    expect(events).toContain('stopped a')
    expect(provide).not.toHaveBeenCalled()
  })

  it('stops a failed relayer and all its chains when relayer setup fails', async () => {
    const failure = new Error('handshake failed')
    const config = defineConfig({
      chains: { a: { factory: chainFactory('a') }, b: { factory: chainFactory('b') } },
      relayers: { hermes: { mnemonic: 'test', channels: [['a', 'b']] } },
    })
    withRelayer(config, { start: async () => { throw failure } })
    await expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toBe(failure)
    expect(events.slice(-6)).toEqual(['stop hermes', 'stopped hermes', 'stop b', 'stopped b', 'stop a', 'stopped a'])
  })

  it('settles other starts when a custom instance throws synchronously', async () => {
    const failure = new Error('synchronous start failure')
    const pending = Promise.withResolvers<void>()
    const factory = chainFactory('failed')
    const failed = factory()
    failed.start = () => { throw failure }
    const config = defineConfig({ chains: {
      pending: { factory: chainFactory('pending', { start: () => pending.promise }) },
      failed: { factory: () => failed },
    } })
    const rejected = expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toBe(failure)
    await vi.waitFor(() => expect(events).toContain('start pending'))
    expect(events).not.toContain('stop pending')
    pending.resolve()
    await rejected
    expect(events).toContain('stopped pending')
  })

  it('continues teardown after a stop error and reports both startup and cleanup errors', async () => {
    const failure = new Error('startup failed')
    const stopError = new Error('stop failed')
    const config = defineConfig({ chains: {
      a: { factory: chainFactory('a') },
      b: { factory: chainFactory('b', {
        start: async () => { throw failure },
        stop: async () => { throw stopError },
      }) },
    } })
    const error = await createGlobalSetup(config)({ provide: vi.fn() }).catch((error: AggregateError) => error)
    expect(error).toBeInstanceOf(AggregateError)
    expect((error as AggregateError).cause).toBe(failure)
    expect((error as AggregateError).errors[1].errors).toContain(stopError)
    expect(events).toContain('stopped a')
    expect(releases.every((release) => release.mock.calls.length > 0)).toBe(true)
  })

  it('rolls back if Vitest refuses the provided context', async () => {
    const failure = new Error('provide failed')
    const config = defineConfig({ chains: { a: { factory: chainFactory('a') } } })
    await expect(createGlobalSetup(config)({ provide() { throw failure } })).rejects.toBe(failure)
    expect(events).toContain('stopped a')
  })

  it('releases reserved ports if constructing a factory fails', async () => {
    const failure = new Error('missing binary source')
    const config = defineConfig({ chains: {
      a: { factory: chainFactory('a') },
      b: { factory: () => { throw failure } },
    } })
    await expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toBe(failure)
    expect(releases.length).toBeGreaterThan(0)
    expect(releases.every((release) => release.mock.calls.length > 0)).toBe(true)
    expect(events).not.toContain('start a')
    expect(events).toContain('stopped a')
  })

  it('releases earlier reservations when allocating another port fails', async () => {
    const failure = new Error('no ports')
    const release = vi.fn(async () => {})
    vi.mocked(reservePort).mockReset()
      .mockResolvedValueOnce({ port: 40_000, release })
      .mockRejectedValueOnce(failure)
    const config = defineConfig({ chains: { a: { factory: chainFactory('a') } } })
    await expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toBe(failure)
    expect(release).toHaveBeenCalledOnce()
  })

  it('rejects duplicate chain IDs used by Hermes before starting nodes', async () => {
    const config = defineConfig({
      chains: {
        a: { factory: chainFactory('a'), parameters: { chainId: 'same' } },
        b: { factory: chainFactory('b'), parameters: { chainId: 'same' } },
      },
      relayers: { hermes: { mnemonic: 'test', channels: [['a', 'b']] } },
    })
    await expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toThrow('share chainId "same"')
    expect(events.some((event) => event.startsWith('start'))).toBe(false)
    expect(releases.every((release) => release.mock.calls.length > 0)).toBe(true)
  })

  it.each([0, -1, NaN, 65_536, 1.5])('rejects invalid explicit port %s before allocation', async (rpcPort) => {
    const config = defineConfig({ chains: { a: { factory: chainFactory('a'), parameters: { rpcPort } } } })
    await expect(createGlobalSetup(config)({ provide: vi.fn() })).rejects.toThrow('rpcPort must be an integer')
    expect(reservePort).not.toHaveBeenCalled()
  })

  it('creates independent instances for each project using the same setup function', async () => {
    const factory = chainFactory('a')
    const setup = createGlobalSetup(defineConfig({ chains: { a: { factory } } }))
    const first = await setup({ provide: vi.fn() })
    const second = await setup({ provide: vi.fn() })
    expect(factory.mock.results[0].value).not.toBe(factory.mock.results[1].value)
    expect(factory.mock.calls[0][0]?.rpcPort).not.toBe(factory.mock.calls[1][0]?.rpcPort)
    await first()
    expect(factory.mock.results[1].value.status).toBe('started')
    await second()
  })
})
