import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    testTimeout: 30_000,
    projects: [
      {
        test: {
          name: 'unit',
          include: ['test/Instance.test.ts', 'test/smoke.test.ts'],
        },
      },
      {
        test: {
          name: 'integration',
          include: ['test/simd.test.ts', 'test/wasmd.test.ts', 'test/xplad.test.ts', 'test/evmd.test.ts', 'test/ibc.test.ts'],
          fileParallelism: false,
          globalSetup: './test/global-setup.ts',
        },
      },
    ],
    reporters: ['default', 'verbose'],
  },
});
