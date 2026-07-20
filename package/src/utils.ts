import { keccak_256 } from '@noble/hashes/sha3.js'
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils.js'

const ansiColorRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: _
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/** Strips ANSI color codes from a string. */
export function stripColors(message: string) {
  return message.replace(ansiColorRegex, '')
}

const addressPattern = /^(0x|0X)?[0-9a-fA-F]{40}$/

/**
 * EIP-55 checksum-cases a hex address: keccak-256 the lowercase hex digits
 * (no `0x`, ASCII), then uppercase each hex letter whose corresponding
 * checksum nibble is >= 8. Idempotent — checksumming an already-checksummed
 * address returns it unchanged. Digit-only addresses are unaffected, since
 * EIP-55 only cases `a-f` letters.
 *
 * Requires exactly 40 hex digits (an optional `0x`/`0X` prefix is stripped
 * first) — anything shorter, longer, or non-hex throws rather than silently
 * "checksumming" garbage.
 */
export function toChecksumAddress(address: string): string {
  if (!addressPattern.test(address)) {
    throw new Error(`toChecksumAddress: "${address}" is not a 40-hex-digit address (optionally 0x-prefixed).`)
  }

  const hex = (address.startsWith('0x') || address.startsWith('0X') ? address.slice(2) : address).toLowerCase()
  const hashHex = bytesToHex(keccak_256(utf8ToBytes(hex)))

  let checksummed = ''
  for (let i = 0; i < hex.length; i++) {
    const char = hex[i]
    checksummed += /[a-f]/.test(char) && Number.parseInt(hashHex[i], 16) >= 8 ? char.toUpperCase() : char
  }
  return `0x${checksummed}`
}

type ParsedCoin = { amount: string; denom: string }

/** Parses one comma-separated coin string into `{amount, denom}` entries. */
function parseCoins(coins: string): ParsedCoin[] | undefined {
  const entries = coins.split(',').map((entry) => entry.trim())
  const parsed: ParsedCoin[] = []

  for (const entry of entries) {
    const match = entry.match(/^(\d+)(.+)$/)
    if (!match) return undefined
    parsed.push({ amount: match[1], denom: match[2] })
  }

  return parsed
}

/**
 * Sorts a comma-separated coin string ascending by denom in byte order —
 * `genesis add-genesis-account` rejects unsorted multi-coin strings. Input
 * that doesn't parse as `{amount}{denom}` entries is returned unchanged; the
 * chain CLI stays the validator of record.
 */
export function sortCoins(coins: string): string {
  const parsed = parseCoins(coins)
  if (!parsed) return coins

  return parsed
    .slice()
    .sort((a, b) => (a.denom < b.denom ? -1 : a.denom > b.denom ? 1 : 0))
    .map((coin) => `${coin.amount}${coin.denom}`)
    .join(',')
}

/**
 * Converts an object to CLI flag arguments.
 *
 * @example
 * ```ts
 * toArgs({ chainId: 'test-1', port: 8545 })
 * // => ['--chain-id', 'test-1', '--port', '8545']
 * ```
 */
export function toArgs(
  obj: Record<string, unknown>,
  options: { casing?: 'kebab' | 'snake' } = {},
): string[] {
  const { casing = 'kebab' } = options
  const separator = casing === 'kebab' ? '-' : '_'

  return Object.entries(obj).flatMap(([key, value]) => {
    if (value === undefined) return []

    const flag = `--${key
      .replace(/([a-z])([A-Z])/g, `$1${separator}$2`)
      .toLowerCase()}`

    if (value === true) return [flag]
    if (value === false) return []

    return [flag, String(value)]
  })
}
