import { execFile } from 'node:child_process'
import { access, mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { resolve } from 'node:path'
import { execPath } from 'node:process'
import { promisify } from 'node:util'

const run = promisify(execFile)
const root = resolve(import.meta.dirname, '..')
const packageDir = resolve(root, 'packages/wws')
const temporary = await mkdtemp(resolve(tmpdir(), 'wws-release-'))

try {
  await access(resolve(packageDir, 'dist/index.js'))
  await run('pnpm', ['pack', '--pack-destination', temporary], { cwd: packageDir })
  const files = (await readdir(temporary)).filter(file => file.endsWith('.tgz'))
  if (files.length !== 1)
    throw new Error(`Expected one package tarball, found ${files.length}`)
  const tarball = resolve(temporary, files[0])
  const { stdout: listing } = await run('tar', ['-tzf', tarball])
  if (listing.includes('node_modules/@wws/core') || listing.includes('packages/core'))
    throw new Error('Tarball contains a private workspace runtime package')
  for (const entry of ['package/dist/index.js', 'package/dist/index.d.ts', 'package/dist/protocol.js', 'package/dist/worker.js']) {
    if (!listing.split('\n').includes(entry))
      throw new Error(`Tarball is missing ${entry}`)
  }
  const packageJson = JSON.parse(await readFile(resolve(packageDir, 'package.json'), 'utf8'))
  if (packageJson.dependencies !== undefined && Object.keys(packageJson.dependencies).length > 0)
    throw new Error('Public package must not ship runtime workspace dependencies')
  await run(execPath, ['-e', 'import(\'./packages/wws/dist/index.js\')'], { cwd: root })
  console.log(`release verification passed (${files[0]})`)
}
finally {
  await rm(temporary, { force: true, recursive: true })
}
