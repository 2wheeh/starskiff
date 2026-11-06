---
'starskiff': minor
---

**Breaking:** Updated `Instance.marood` for maroo v0.11 with required `privacyGenesis` input (also required by `patchMaroodGenesis`) and a directory-only `privacyZkArtifacts` option. Supply fresh public Privacy V4 JSON and a matching Clairveil v0.6.1 audit-field bundle. Updated precompiles, all 19 preinstalls, and the PCL EntryPoint allowlist; `policyAdmin` now creates the Privacy contract-policy owner when absent. Removed `MAROO_NATIVE_ERC20`.

```ts
const maroo = Instance.marood({
  image: 'ghcr.io/hashed-open-finance/maroo:v0.11.0',
  privacyGenesis: '/fixtures/privacy-genesis.json',
  privacyZkArtifacts: { directory: '/fixtures/clairveil-v0.6.1-artifacts' },
});
await maroo.start();
```
