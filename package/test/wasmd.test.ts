import { describe, it, expect, inject } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { GasPrice } from '@cosmjs/stargate'

const rpcUrl = inject('wasmARpcUrl')
const mnemonic = inject('testMnemonic')

describe('wasmd instance', () => {
  it('responds to RPC /status', async () => {
    const res = await fetch(`${rpcUrl}/status`)
    expect(res.ok).toBe(true)
  })

  it('uploads, instantiates, and executes a wasm contract', async () => {
    const { SigningCosmWasmClient } = await import('@cosmjs/cosmwasm-stargate')
    const { DirectSecp256k1HdWallet } = await import('@cosmjs/proto-signing')

    const wallet = await DirectSecp256k1HdWallet.fromMnemonic(mnemonic, {
      prefix: 'wasm',
    })
    const [account] = await wallet.getAccounts()

    const client = await SigningCosmWasmClient.connectWithSigner(
      rpcUrl,
      wallet,
      { gasPrice: GasPrice.fromString('0stake') },
    )

    // Upload
    const wasmPath = path.join(import.meta.dirname, 'testdata', 'hackatom.wasm')
    const wasmCode = fs.readFileSync(wasmPath)

    const { codeId } = await client.upload(account.address, wasmCode, 'auto')
    expect(codeId).toBeGreaterThan(0)

    // Instantiate
    const { contractAddress } = await client.instantiate(
      account.address,
      codeId,
      { verifier: account.address, beneficiary: account.address },
      'hackatom-test',
      'auto',
    )
    expect(contractAddress).toBeTruthy()

    // Execute
    const result = await client.execute(
      account.address,
      contractAddress,
      { release: {} },
      'auto',
    )
    expect(result.transactionHash).toBeTruthy()

    client.disconnect()
  }, 60_000)
})
