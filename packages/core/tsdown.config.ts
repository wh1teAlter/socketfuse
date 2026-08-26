/** @socketfuse/core 私有实现包的 TypeScript 构建配置。 */
import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  dts: { sourcemap: true },
  entry: ['src/index.ts'],
  format: ['esm'],
  platform: 'browser',
  sourcemap: true,
  target: 'es2022',
})
