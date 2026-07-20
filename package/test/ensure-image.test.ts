import { describe, it, expect, vi, beforeEach } from 'vitest'

// `x` calls are recorded here so assertions can check exactly which docker
// subcommands ran.
const { calls, mockState } = vi.hoisted(() => ({
  calls: [] as { command: string; args: string[] }[],
  mockState: { imagePresent: true, pullExitCode: 0, pullStderr: '' },
}))

vi.mock('tinyexec', () => ({
  x: vi.fn((command: string, args: string[] = []) => {
    calls.push({ command, args })
    if (args[0] === 'image' && args[1] === 'inspect') {
      return Promise.resolve({ exitCode: mockState.imagePresent ? 0 : 1, stdout: '', stderr: '' })
    }
    if (args[0] === 'pull') {
      return Promise.resolve({ exitCode: mockState.pullExitCode, stdout: '', stderr: mockState.pullStderr })
    }
    return Promise.resolve({ exitCode: 0, stdout: '', stderr: '' })
  }),
}))

import { ensureImage } from '../src/docker.js'

beforeEach(() => {
  calls.length = 0
  mockState.imagePresent = true
  mockState.pullExitCode = 0
  mockState.pullStderr = ''
})

describe('ensureImage', () => {
  it('returns without pulling when the image is already present locally', async () => {
    mockState.imagePresent = true

    await ensureImage('my/img:1')

    expect(calls.some((c) => c.args[0] === 'pull')).toBe(false)
  })

  it('invokes docker pull and emits a message when the image is absent', async () => {
    mockState.imagePresent = false
    const messages: string[] = []

    await ensureImage('my/img:1', (message) => messages.push(message))

    expect(calls).toContainEqual({ command: 'docker', args: ['pull', 'my/img:1'] })
    expect(messages.some((message) => message.includes('pulling my/img:1'))).toBe(true)
  })

  it('throws an actionable error when the image is absent and the registry pull fails', async () => {
    mockState.imagePresent = false
    mockState.pullExitCode = 1
    mockState.pullStderr = 'unauthorized: authentication required'

    await expect(ensureImage('my/img:1')).rejects.toThrow(/registry pull failed/)
    await expect(ensureImage('my/img:1')).rejects.toThrow(/unauthorized: authentication required/)
  })
})
