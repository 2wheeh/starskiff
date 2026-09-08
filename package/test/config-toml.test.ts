import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { patchToml } from '../src/cosmos.js'

describe('SDK config compatibility', () => {
  const directories: string[] = []
  afterEach(() => {
    vi.restoreAllMocks()
    for (const directory of directories.splice(0)) fs.rmSync(directory, { recursive: true, force: true })
  })

  function config(contents: string) {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'starskiff-config-'))
    directories.push(directory)
    const file = path.join(directory, 'app.toml')
    fs.writeFileSync(file, contents)
    return file
  }

  const optionalDefaults = { 'grpc-web.address': '0.0.0.0:19091' }

  it('uses the API listener without warnings for SDKs without a separate gRPC-Web address', () => {
    const file = config('[api]\naddress = "tcp://localhost:1317"\n[grpc-web]\nenable = true\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    patchToml(file, { 'api.address': 'tcp://0.0.0.0:11317' }, 'marood', optionalDefaults)
    expect(fs.readFileSync(file, 'utf8')).toBe('[api]\naddress = "tcp://0.0.0.0:11317"\n[grpc-web]\nenable = true\n')
    expect(warn).not.toHaveBeenCalled()
  })

  it('still patches a legacy separate listener and lets explicit values override the default', () => {
    const file = config('[grpc-web]\naddress = "localhost:9091"\n')
    patchToml(file, {}, 'legacy', optionalDefaults)
    expect(fs.readFileSync(file, 'utf8')).toContain('address = "0.0.0.0:19091"')
    patchToml(file, { 'grpc-web.address': '127.0.0.1:29091' }, 'legacy', optionalDefaults)
    expect(fs.readFileSync(file, 'utf8')).toContain('address = "127.0.0.1:29091"')
  })

  it('still warns for missing required keys, including explicit gRPC-Web overrides', () => {
    const file = config('[grpc-web]\nenable = true\n')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    patchToml(file, { 'api.address': 'tcp://localhost:1317', 'grpc-web.address': 'localhost:9091' }, 'marood', optionalDefaults)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('no matching key for api.address, grpc-web.address'))
  })
})
