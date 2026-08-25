/** `wws` 三个公开入口的发布构建与类型声明配置。 */
import { defineConfig } from 'tsdown'

/** 三个入口共用的 browser ESM、dts 和内联 core 构建边界。 */
const shared = {
  clean: true,
  deps: {
    alwaysBundle: ['@wws/core'],
  },
  dts: { sourcemap: true },
  format: ['esm'],
  platform: 'browser',
  publint: { level: 'error' },
  sourcemap: true,
  target: 'es2022',
} as const

export default defineConfig([
  { ...shared, entry: { index: 'src/index.ts', worker: 'src/worker.ts' } },
  // protocol 入口单独构建，保证 Rolldown 保留独立 JS/source map artifact，
  // 发布验收可以逐入口验证而不依赖空 chunk 推断。
  { ...shared, clean: false, entry: { protocol: 'src/protocol.ts' } },
])
