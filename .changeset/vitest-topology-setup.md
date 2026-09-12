---
'starskiff': minor
---

Added `createGlobalSetup()` and `StarskiffContext` from `starskiff/vitest` for automatic project-scoped chain and Hermes setup. The adapter allocates missing ports, provides serializable endpoints, and stops instances after tests or a setup failure.

```ts
// test/global-setup.ts
import { createGlobalSetup } from 'starskiff/vitest';
import config from '../starskiff.config.js';

export default createGlobalSetup(config);
```
