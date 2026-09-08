---
"starskiff": patch
---

Synchronize `Instance.marood({ policyAdmin })` with the existing Privacy contract-policy admin in maroo v0.8 genesis while preserving its policies. Skip the default `grpc-web.address` patch when newer Cosmos SDK configurations share the API listener, while retaining legacy listener configuration and warnings for missing explicit overrides.
