/** @socketfuse/core 浏览器无关单元测试配置。 */
import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    coverage: {
      enabled: false,
      include: ['src/**/*.ts'],
      provider: 'v8',
      reporter: ['text', 'html'],
    },
    exclude: ['**/dist/**', '**/node_modules/**'],
    include: ['src/**/*.test.ts'],
  },
})
