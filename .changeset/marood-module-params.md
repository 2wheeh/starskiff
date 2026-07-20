---
"starskiff": minor
---

`marood` now seeds the maroo module genesis params by default, mirroring the
maroo repo's `local_node.sh`: the `agent` registry addresses, the `eas`
contract addresses, `pcl.entrypoints` (the Entrypoint v8 preinstall, in
bech32), and `okrw.mint_denom` per network preset. Previously a bare init
genesis left these at Go defaults, so the maroo precompiles' constructors
failed at startup and the precompiles were silently dropped from the EVM's
available set — consumers had to reverse-engineer the seeding themselves.
User-specific knobs are new parameters: `policyAdmin` (`pcl.policy_admin`),
`minterAddress` (`okrw.minter_address`), and `entrypoints` to override the
default.
The patch logic is exported as `patchMaroodGenesis` for testing.

Also:

- Multi-coin `accounts[].coins` strings are now sorted by denom automatically
  (the SDK rejects unsorted denoms).
- A failed image pull now throws an actionable error naming the image,
  including docker's stderr tail, and pointing out that locally-built images
  (e.g. a private node image) must be built/loaded before starting.
