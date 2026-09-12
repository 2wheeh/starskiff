import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    reporters: ['dot'],
    projects: ['first', 'second'].map((name) => ({
      test: {
        name,
        include: [fileURLToPath(new URL('./context.test.ts', import.meta.url))],
        globalSetup: [fileURLToPath(new URL('./global-setup.ts', import.meta.url))],
      },
    })),
  },
})
