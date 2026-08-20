import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      include: ['packages/{core,wws}/src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    exclude: [
      '**/dist/**',
      '**/node_modules/**',
      'packages/test/e2e/**',
    ],
    include: ['packages/**/*.test.ts'],
  },
})
