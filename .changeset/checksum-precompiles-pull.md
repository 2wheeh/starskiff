---
"starskiff": minor
---

`activeStaticPrecompiles` entries are now stored in genesis in EIP-55
checksum form (previously lowercased). cosmos/evm forks decide precompile
activation by comparing the stored strings case-sensitively against
`address.String()` — lowercasing silently disabled any precompile whose
address contains a hex letter (empirically: maroo's agent precompile at
`0x…000A` answered `eth_call` with bare `0x`). The stored list stays
plain-string sorted, which is what the chain's genesis validation checks.
The normalization is internal — callers keep passing addresses in any
casing. `@noble/hashes` becomes a runtime dependency for the keccak-256
the checksumming needs.

New `pull: 'never' | 'missing'` parameter for image-backed instances:
`'never'` skips the doomed registry round-trip for locally-built,
never-published images and fails fast with an actionable error when the
image is absent locally. Default stays `'missing'` (pull when absent).
