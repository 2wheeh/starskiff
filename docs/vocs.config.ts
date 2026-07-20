import { ScriptTarget } from 'typescript';
import { defineConfig } from 'vocs/config';

import pkg from 'starskiff/package.json' with { type: 'json' };

export default defineConfig({
  // Pin the twoslash target below ESNext: @typescript/vfs 1.6.4's known-lib
  // list for ESNext includes lib.es2025.* names that typescript 5.9 doesn't
  // ship, so the default target makes every twoslash block fail with
  // "TSVFS: … lib.es2025.iterator.d.ts … not found in the file map".
  twoslash: {
    twoslashOptions: {
      compilerOptions: {
        target: ScriptTarget.ES2024,
      },
    },
  },
  title: 'starskiff',
  description:
    'Real Cosmos SDK nodes as ephemeral test instances — from a binary or an official chain image, no Kubernetes.',
  renderStrategy: 'full-static',
  sidebar: [
    {
      text: 'Introduction',
      items: [
        { text: 'Getting Started', link: '/docs/getting-started' },
        { text: 'Why starskiff', link: '/docs/why' },
      ],
    },
    {
      text: 'Instances',
      items: [
        { text: 'Overview', link: '/docs/instances' },
        { text: 'simd', link: '/docs/instances/simd' },
        { text: 'wasmd', link: '/docs/instances/wasmd' },
        { text: 'evmd', link: '/docs/instances/evmd' },
        { text: 'hermes (relayer)', link: '/docs/instances/hermes' },
        { text: 'Chains', link: '/docs/chains' },
      ],
    },
    {
      text: 'Guides',
      items: [
        { text: 'Container Runtime', link: '/docs/guides/docker' },
        { text: 'Test Accounts', link: '/docs/guides/accounts' },
        { text: 'Multi-Chain & Ports', link: '/docs/guides/multi-chain' },
        { text: 'vitest Setup', link: '/docs/guides/vitest' },
        { text: 'CI Setup', link: '/docs/guides/ci' },
        { text: 'Multiple Validators', link: '/docs/guides/multi-validator' },
        { text: 'Custom Chains', link: '/docs/guides/custom-chains' },
        { text: 'IBC Relaying', link: '/docs/guides/ibc' },
      ],
    },
    {
      text: 'API Reference',
      items: [{ text: 'Instance', link: '/docs/api/instance' }],
    },
  ],
  socials: [
    {
      icon: 'github',
      link: 'https://github.com/2wheeh/starskiff',
    },
  ],
  topNav: [
    {
      text: 'Docs',
      link: '/docs/getting-started',
      match: (path) => Boolean(path?.startsWith('/docs')),
    },
    {
      text: pkg.version,
      items: [
        {
          text: 'Changelog',
          link: 'https://github.com/2wheeh/starskiff/blob/main/package/CHANGELOG.md',
        },
      ],
    },
  ],
});
