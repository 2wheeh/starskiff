import { defineConfig } from 'vocs/config';

import pkg from 'starskiff/package.json' with { type: 'json' };

export default defineConfig({
  title: 'starskiff',
  description:
    'Real Cosmos SDK nodes as ephemeral test instances — child processes, no Docker, no Kubernetes.',
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
        { text: 'evmd', link: '/docs/instances/evmd' },
        { text: 'hermes (relayer)', link: '/docs/instances/hermes' },
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
