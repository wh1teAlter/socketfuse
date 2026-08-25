/**
 * 发布包验收脚本。
 *
 * 它检查 tarball 白名单、source map 路径、私有 workspace 引用以及真实消费者的
 * 类型检查、Vite 构建和 SSR import。临时目录在 finally 中清理，避免 artifact
 * 冲突或失败重试污染仓库。
 */
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { isAbsolute, resolve, win32 } from 'node:path'
import { execFile } from 'node:child_process'
import { execPath } from 'node:process'
import { promisify } from 'node:util'
import { gzipSync } from 'node:zlib'
import { tmpdir } from 'node:os'

/** 可 await 的子进程执行函数。 */
const run = promisify(execFile)
/** 验收脚本、workspace 根和待验证发布包路径。 */
const testDir = resolve(import.meta.dirname, '..')
const root = resolve(testDir, '..', '..')
const packageDir = resolve(root, 'packages/wws')
/** 本次验收独占的临时根目录及其消费者/解压子目录。 */
const temporary = await mkdtemp(resolve(tmpdir(), 'wws-release-'))
const consumerDir = resolve(temporary, 'consumer')
const archiveDir = resolve(temporary, 'archive')
/** 发布包必须包含的三个公开入口及其声明/source map。 */
const requiredEntries = [
  'package/dist/index.js',
  'package/dist/index.d.ts',
  'package/dist/index.js.map',
  'package/dist/protocol.js',
  'package/dist/protocol.d.ts',
  'package/dist/protocol.js.map',
  'package/dist/worker.js',
  'package/dist/worker.d.ts',
  'package/dist/worker.js.map',
]
/** 根目录允许的发布元数据。 */
const rootEntries = new Set(['package/LICENSE', 'package/README.md', 'package/package.json'])
/** dist 允许的构建 artifact 命名模式。 */
const distEntryPattern = /^package\/dist\/[A-Za-z0-9_-]+\.(?:js|d\.ts)(?:\.map)?$/

/** 拒绝路径穿越和未批准的发布 artifact。 */
function assertSafeEntryName(entry) {
  if (!entry.startsWith('package/') || entry.split('/').includes('..'))
    throw new Error(`Tarball contains an unsafe path: ${entry}`)
  if (!rootEntries.has(entry) && !distEntryPattern.test(entry))
    throw new Error(`Tarball contains an unrelated build artifact: ${entry}`)
}

/** 验证 source map 不携带工作区绝对路径或 file URL。 */
async function verifySourceMap(entry) {
  const file = resolve(archiveDir, entry)
  const content = await readFile(file, 'utf8')
  if (content.includes(root))
    throw new Error(`${entry} contains the workspace absolute path`)
  const sourceMap = JSON.parse(content)
  const paths = [...(sourceMap.sources ?? []), ...(sourceMap.sourceRoot === undefined ? [] : [sourceMap.sourceRoot])]
  for (const source of paths) {
    if (typeof source !== 'string')
      throw new Error(`${entry} contains a non-string source path`)
    if (isAbsolute(source) || win32.isAbsolute(source) || /^file:/i.test(source))
      throw new Error(`${entry} contains an absolute source path: ${source}`)
  }
}

/** 解压并验证 tarball 内容、必需入口和私有 import 隔离。 */
async function verifyArchive(entries, tarball) {
  for (const entry of entries)
    assertSafeEntryName(entry)
  for (const entry of requiredEntries) {
    if (!entries.includes(entry))
      throw new Error(`Tarball is missing ${entry}`)
  }
  await mkdir(archiveDir, { recursive: true })
  await run('tar', ['-xzf', tarball, '-C', archiveDir])
  for (const entry of entries.filter(entry => entry.endsWith('.map')))
    await verifySourceMap(entry)
  for (const entry of entries.filter(entry => entry.endsWith('.js') || entry.endsWith('.d.ts'))) {
    const content = await readFile(resolve(archiveDir, entry), 'utf8')
    if (content.includes('@wws/core'))
      throw new Error(`${entry} references the private workspace runtime`)
  }
}

/** 在独立目录中模拟消费者，验证公开入口运行时和类型可用。 */
async function verifyConsumer(tarball) {
  await mkdir(consumerDir, { recursive: true })
  await writeFile(resolve(consumerDir, 'package.json'), JSON.stringify({
    name: 'wws-tarball-consumer',
    private: true,
    type: 'module',
    dependencies: { wws: `file:${tarball}` },
    devDependencies: { vite: '8.2.1' },
  }, null, 2))
  await writeFile(resolve(consumerDir, 'tsconfig.json'), JSON.stringify({
    compilerOptions: {
      module: 'NodeNext',
      moduleResolution: 'NodeNext',
      noEmit: true,
      strict: true,
      target: 'ES2022',
    },
    include: ['index.ts'],
  }, null, 2))
  await writeFile(resolve(consumerDir, 'index.ts'), `
import { createWebSocket, type JsonValue, type WebSocketClient } from 'wws'
import { rawProtocol, type ProtocolAdapter } from 'wws/protocol'
import type { SocketData } from 'wws'
import { exposeSharedWebSocketWorker, type SharedWebSocketRuntime } from 'wws/worker'

const client: WebSocketClient = createWebSocket('wss://example.test/socket', { id: 'tarball-check' })
const protocol: ProtocolAdapter<SocketData, SocketData> = rawProtocol
const worker: typeof exposeSharedWebSocketWorker = exposeSharedWebSocketWorker
const runtime: SharedWebSocketRuntime | undefined = undefined
const jsonClient = createWebSocket('wss://example.test/json', {
  id: 'tarball-json',
  protocol: { type: 'json' },
})
const jsonMessage: JsonValue = { type: 'json' }

void jsonClient.sendMessage(jsonMessage)

void client
void protocol
void worker
void runtime
`, 'utf8')
  await writeFile(resolve(consumerDir, 'vite.config.ts'), `
import { defineConfig } from 'vite'

export default defineConfig({
  build: { emptyOutDir: true, lib: { entry: 'src/main.ts', formats: ['es'], fileName: 'consumer' } },
})
`, 'utf8')
  await mkdir(resolve(consumerDir, 'src'), { recursive: true })
  await writeFile(resolve(consumerDir, 'src/main.ts'), `
import { createWebSocket } from 'wws'
import { rawProtocol } from 'wws/protocol'
import { exposeSharedWebSocketWorker } from 'wws/worker'

void createWebSocket
void rawProtocol
void exposeSharedWebSocketWorker
`, 'utf8')
  await run('pnpm', ['install', '--ignore-workspace', '--no-frozen-lockfile'], { cwd: consumerDir })
  await run(execPath, [resolve(testDir, 'node_modules/typescript/bin/tsc'), '--project', resolve(consumerDir, 'tsconfig.json')])
  await run('pnpm', ['exec', 'vite', 'build'], { cwd: consumerDir })
  await run(execPath, ['--input-type=module', '--eval', `
    const root = await import('wws')
    const protocol = await import('wws/protocol')
    const worker = await import('wws/worker')
    if (!root.createWebSocket || !protocol.rawProtocol || !worker.exposeSharedWebSocketWorker)
      throw new Error('A public WWS entry did not evaluate')
    globalThis.WebSocket = class { constructor() { throw new Error('must not connect') } }
    let code
    try { root.createWebSocket('wss://example.test/socket', { id: 'ssr-check', immediate: false }) }
    catch (error) { code = error?.code }
    if (code !== 'ENVIRONMENT_UNSUPPORTED')
      throw new Error('SSR createWebSocket guard was not enforced')
  `], { cwd: consumerDir })
}

try {
  await run('pnpm', ['pack', '--pack-destination', temporary], { cwd: packageDir })
  const files = (await readdir(temporary)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1)
    throw new Error(`Expected one package tarball, found ${files.length}`)
  const tarball = resolve(temporary, files[0])
  const { stdout: listing } = await run('tar', ['-tzf', tarball])
  const entries = listing.split('\n').filter(Boolean)
  await verifyArchive(entries, tarball)
  const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'))
  if (packageJson.dependencies !== undefined && Object.keys(packageJson.dependencies).length > 0)
    throw new Error('Public package must not ship runtime workspace dependencies')
  await verifyConsumer(tarball)
  const clientGzip = gzipSync(await readFile(resolve(archiveDir, 'package/dist/index.js'))).byteLength
  const workerGzip = gzipSync(await readFile(resolve(archiveDir, 'package/dist/worker.js'))).byteLength
  console.log(`gzip sizes: client=${clientGzip} bytes, worker=${workerGzip} bytes`)
  console.log(`release verification passed (${files[0]})`)
}
finally {
  await rm(temporary, { force: true, recursive: true })
}
