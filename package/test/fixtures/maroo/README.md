# Maroo test inputs

The checked-in genesis JSON files contain synthetic values for unit tests of
host-side parsing, denomination checks, and genesis patching.

Node startup tests use locally supplied Privacy V4 genesis files and a matching
Clairveil artifact directory:

```sh
MAROO_IMAGE=your-registry/maroo:v0.11.0 \
MAROO_PRIVACY_GENESIS=/absolute/path/to/privacy-genesis.testnet.json \
MAROO_MAINNET_PRIVACY_GENESIS=/absolute/path/to/privacy-genesis.mainnet.json \
MAROO_PRIVACY_ZK_ARTIFACT_DIR=/absolute/path/to/artifacts \
  pnpm --filter starskiff exec vitest run --project feature test/marood.test.ts
```

Use `MAROO_BINARY` instead of `MAROO_IMAGE` for a host binary. Each network's
tests run when its source and genesis path are configured.
`MAROO_TEST_PORT_BASE` can select a port range outside Docker Desktop's ephemeral
ports. The `.local/` and `artifacts/` directories here are excluded from Git
for local startup inputs.

Mutable invalid-input cases and node homes use temporary directories and are
removed after the tests.
