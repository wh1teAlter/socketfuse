import { defineConfig } from 'tsdown'

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
  // Keep the no-transform re-export in a dedicated build so Rolldown emits
  // its own JavaScript source map instead of eliding it as an empty chunk.
  { ...shared, clean: false, entry: { protocol: 'src/protocol.ts' } },
])
