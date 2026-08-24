import { defineConfig } from 'tsdown'

export default defineConfig({
  clean: true,
  deps: {
    alwaysBundle: ['@wws/core'],
  },
  dts: { sourcemap: true },
  entry: {
    index: 'src/index.ts',
    protocol: 'src/protocol.ts',
    worker: 'src/worker.ts',
  },
  format: ['esm'],
  platform: 'browser',
  publint: { level: 'error' },
  sourcemap: true,
  target: 'es2022',
})
