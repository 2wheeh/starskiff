import { execFile } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { expect, it } from 'vitest'

it('runs the public adapter in Vitest projects and releases every listener on exit', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'starskiff-vitest-'))
  const lifecycle = path.join(directory, 'lifecycle.jsonl')
  try {
    await promisify(execFile)(process.execPath, [
      fileURLToPath(new URL('../node_modules/vitest/vitest.mjs', import.meta.url)),
      'run', '--config', fileURLToPath(new URL('./fixtures/vitest/vitest.config.ts', import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL('..', import.meta.url)),
      env: { ...process.env, STARSKIFF_TEST_LIFECYCLE: lifecycle },
      timeout: 25_000,
    })
    const events = (await readFile(lifecycle, 'utf8')).trim().split('\n')
      .map((line) => JSON.parse(line) as { event: string; ports: number[] })
    const starts = events.filter(({ event }) => event === 'start')
    const stops = events.filter(({ event }) => event === 'stop')
    expect(starts).toHaveLength(2)
    expect(stops).toHaveLength(2)
    const ports = starts.flatMap((entry) => entry.ports)
    expect(new Set(ports).size).toBe(ports.length)
    expect(stops.map((entry) => entry.ports)).toEqual(expect.arrayContaining(starts.map((entry) => entry.ports)))
    for (const port of ports) {
      await new Promise<void>((resolve, reject) => {
        const server = net.createServer()
        server.once('error', reject)
        server.listen(port, '127.0.0.1', () => server.close((error) => error ? reject(error) : resolve()))
      })
    }
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}, 30_000)
