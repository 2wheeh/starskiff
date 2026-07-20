const ansiColorRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: _
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/** Strips ANSI color codes from a string. */
export function stripColors(message: string) {
  return message.replace(ansiColorRegex, '')
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
