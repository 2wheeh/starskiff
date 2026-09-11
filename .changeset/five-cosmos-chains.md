---
'starskiff': minor
---

Add `Instance.provenanced`, `Instance.cronosd`, `Instance.dydxprotocold`, `Instance.seid`, and `Instance.thornode` with native account funding and managed node lifecycles. Provenance, Sei, and THORChain default to pinned official images; Cronos and dYdX require an explicit source. Cronos and Sei expose `evmUrl`.

```ts
import { Instance } from 'starskiff'

const chain = Instance.provenanced()
await chain.start()
// Use chain.rpcUrl and chain.apiUrl in your tests.
await chain.stop()

Instance.cronosd({ binary: '/path/to/cronos/bin/cronosd' })
Instance.dydxprotocold({ binary: '/path/to/dydxprotocold' })
Instance.seid() // local EVM chain ID 713714
Instance.thornode() // amd64 image; single validator, no Bifrost
```

dYdX runs with external daemons disabled. Sei rejects public-network chain IDs that load embedded genesis. THORChain does not provision external chains or vault signing.

Custom `cosmosBase` definitions can select `genesisCommand`, replace gentxs with `setupValidators`, and derive `runtime` or `extraStartArgs` from the runtime's temporary home path. `cosmosEvmBase` accepts `extraAppToml` overrides.
