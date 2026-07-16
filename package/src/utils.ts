const ansiColorRegex =
  // biome-ignore lint/suspicious/noControlCharactersInRegex: _
  /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g

/** Strips ANSI color codes from a string. */
export function stripColors(message: string) {
  return message.replace(ansiColorRegex, '')
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
