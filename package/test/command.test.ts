import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { commandErrorMessage, createCommandRunner } from '../src/command.js'

function localRunner(signal: AbortSignal) {
  return createCommandRunner({
    binary: process.execPath,
    containerName: 'unused',
    name: 'node-test',
    signal,
  })
}

describe('local command runner', () => {
  it('surfaces command stderr before the generic error message', () => {
    const error = Object.assign(new Error('command failed'), {
      output: { stderr: ' invalid mnemonic\n' },
    })

    expect(commandErrorMessage(error)).toBe('invalid mnemonic')
    expect(commandErrorMessage(new Error('fallback'))).toBe('fallback')
  })

  it('bounds command stderr to its last 50 lines', () => {
    const error = Object.assign(new Error('command failed'), {
      output: {
        stderr: Array.from({ length: 60 }, (_, index) => `line-${index}`).join('\n'),
      },
    })

    const message = commandErrorMessage(error)
    expect(message).not.toContain('line-9\n')
    expect(message).toMatch(/^line-10\n/)
    expect(message).toMatch(/line-59$/)
  })

  it('passes stdin without blocking the event loop', async () => {
    const controller = new AbortController()
    const output = await localRunner(controller.signal).run(
      os.tmpdir(),
      ['-e', 'process.stdin.pipe(process.stdout)', '--'],
      { input: 'recovery phrase\n' },
    )

    expect(output.stdout).toBe('recovery phrase\n')
  })

  it('surfaces stderr from failed one-shot commands', async () => {
    const controller = new AbortController()
    const operation = localRunner(controller.signal).run(os.tmpdir(), [
      '-e',
      'process.stderr.write("invalid genesis\\n"); process.exit(7)',
      '--',
    ])

    await expect(operation).rejects.toThrow('invalid genesis')
  })

  it('appends the selected home directory', async () => {
    const controller = new AbortController()
    const homeDir = path.join(os.tmpdir(), 'starskiff-command-home')
    const output = await localRunner(controller.signal).run(homeDir, [
      '-e',
      'process.stdout.write(process.argv.at(-1) ?? "")',
      '--',
    ])

    expect(output.stdout).toBe(homeDir)
  })

  it('terminates a one-shot command when startup is aborted', async () => {
    const controller = new AbortController()
    const operation = localRunner(controller.signal).run(os.tmpdir(), [
      '-e',
      'setInterval(() => {}, 1_000)',
      '--',
    ])

    const reason = new Error('startup timed out')
    controller.abort(reason)

    await expect(operation).rejects.toBe(reason)
  })
})
