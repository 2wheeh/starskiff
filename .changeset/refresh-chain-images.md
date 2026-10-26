---
'starskiff': patch
---

Update default images to XPLA v1.14.0, Gaia v28.3.1, MANTRA v8.7.0-pre.1, XRPL EVM v11.2.0, cosmos/evm v0.7.3, simapp v0.55, and wasmd v0.70.5. XPLA references the official `ghcr.io/xpladev/xpla:v1.14.0` image.

Align XPLA's default precompiles with mainnet, enabling ICS20 and removing WasmDelegate. Avoid a spurious gas-price configuration warning when the chain no longer exposes that setting; explicit unsupported overrides still warn.
