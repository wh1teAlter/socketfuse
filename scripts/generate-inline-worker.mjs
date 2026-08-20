import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const output = resolve(root, 'packages/wws/src/inline-worker-source.generated.ts')
const entry = resolve(root, 'packages/wws/src/inline-worker-entry.ts')

const bundle = await rolldown({
  input: entry,
  platform: 'browser',
  resolve: {
    alias: {
      '@wws/core': resolve(root, 'packages/core/src/index.ts'),
    },
  },
})
const generated = await bundle.generate({
  format: 'iife',
  minify: true,
})
await bundle.close()

const chunks = generated.output.filter(item => item.type === 'chunk')
if (chunks.length !== 1)
  throw new Error(`Expected one inline Worker chunk, received ${chunks.length}`)

const source = chunks[0].code

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `export const INLINE_WORKER_SOURCE: string = ${JSON.stringify(source)}\n`, 'utf8')
