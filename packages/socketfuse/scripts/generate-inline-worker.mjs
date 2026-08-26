/**
 * 将 Worker 入口打包为可内联的单一 browser IIFE artifact。
 *
 * 生成边界必须保持单 chunk、无 workspace import 和 browser platform，产物由脚本
 * 全量覆盖，避免手工修改生成字符串后与 Worker 源码失配。
 */
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { rolldown } from 'rolldown'

/** 当前公开包目录和生成目标路径。 */
const packageDir = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const workspaceRoot = resolve(packageDir, '..', '..')
const output = resolve(packageDir, 'src/worker/source.generated.ts')
const entry = resolve(packageDir, 'src/worker/entry.ts')

const bundle = await rolldown({
  input: entry,
  platform: 'browser',
  resolve: {
    alias: {
      '@socketfuse/core': resolve(workspaceRoot, 'packages/core/src/index.ts'),
    },
  },
})
const generated = await bundle.generate({
  format: 'iife',
  minify: true,
})
await bundle.close()

/** 只接受单一 chunk，防止 data URL 漏掉动态依赖。 */
const chunks = generated.output.filter(item => item.type === 'chunk')
if (chunks.length !== 1)
  throw new Error(`Expected one inline Worker chunk, received ${chunks.length}`)

const source = chunks[0].code

await mkdir(dirname(output), { recursive: true })
await writeFile(output, `/**
 * 由 generate-inline-worker.mjs 生成的 inline Worker artifact。
 *
 * 该字符串必须保持单一 IIFE、browser platform 且不含 workspace import，供页面
 * 通过稳定 data: URL 构造 SharedWorker；请修改入口或生成器后重新生成。
 */
export const INLINE_WORKER_SOURCE: string = ${JSON.stringify(source)}\n`, 'utf8')
