import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import { Instance } from '../src/index.js'

it.each(['keys', 'channel', 'success'] as const)('cleans up Hermes processes after %s setup', async (mode) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-hermes-lifecycle-'))
  const marker = path.join(directory, 'blocked.json')
  const log = path.join(directory, 'commands.jsonl')
  const binary = path.join(directory, 'hermes.cjs')
  fs.writeFileSync(binary, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(4);
const marker = ${JSON.stringify(marker)};
fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(args) + '\\n');
const shouldBlock = ${JSON.stringify(mode)} === 'keys' ? args[0] === 'keys'
  : ${JSON.stringify(mode)} === 'channel' && args[1] === 'channel';
if (shouldBlock && !fs.existsSync(marker)) {
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, config: process.argv[3] }));
  if (${JSON.stringify(mode)} === 'channel') process.on('SIGTERM', () => {});
  setTimeout(() => process.exit(0), ${mode === 'keys' ? 2500 : 10_000});
} else if (args[0] === 'start') {
  fs.writeFileSync(marker, JSON.stringify({ pid: process.pid, config: process.argv[3] }));
  console.log('Hermes has started');
  setTimeout(() => process.exit(0), 10_000);
} else {
  console.log('07-tendermint-0 connection-0');
}
`, { mode: 0o755 })
  const relayer = Instance.hermes({
    binary,
    channels: [[Instance.simd({ chainId: 'a' }), Instance.simd({ chainId: 'b' })]],
    mnemonic: 'test mnemonic',
    commandTimeoutMs: 15_000,
    commandRetries: 1,
    commandRetryDelayMs: 10_000,
  }, { timeout: mode === 'success' ? 10_000 : mode === 'keys' ? 1000 : 2000 })
  try {
    const began = Date.now()
    if (mode === 'success') {
      await relayer.start()
      expect(relayer.status).toBe('started')
    } else {
      await expect(relayer.start()).rejects.toThrow('failed to start in time')
    }
    await relayer.stop()
    const blocked = JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number; config: string }
    expect(() => process.kill(blocked.pid, 0)).toThrow()
    expect(fs.existsSync(path.dirname(blocked.config))).toBe(false)
    if (mode === 'keys') expect(Date.now() - began).toBeLessThan(2000)
    const commands = fs.readFileSync(log, 'utf8')
    await new Promise((resolve) => setTimeout(resolve, 50))
    expect(fs.readFileSync(log, 'utf8')).toBe(commands)
  } finally {
    // The regression is a leaked child. Clean it up even when testing the old code.
    if (fs.existsSync(marker)) {
      const { pid } = JSON.parse(fs.readFileSync(marker, 'utf8')) as { pid: number }
      try { process.kill(pid, 'SIGKILL') } catch {}
    }
    await relayer.stop()
    fs.rmSync(directory, { recursive: true, force: true })
  }
}, 15_000)

it('reports a missing Hermes executable without waiting for the instance timeout', async () => {
  const relayer = Instance.hermes({
    binary: '/starskiff-test-no-such-hermes',
    mnemonic: 'test mnemonic',
    channels: [[Instance.simd({ chainId: 'a' }), Instance.simd({ chainId: 'b' })]],
    commandRetries: 0,
  }, { timeout: 1000 })
  try {
    await expect(relayer.start()).rejects.toThrow('ENOENT')
  } finally {
    await relayer.stop()
  }
})
