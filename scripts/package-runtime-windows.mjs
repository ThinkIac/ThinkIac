import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const version = process.env.RUNTIME_VERSION
const output = join(root, 'dist', 'runtime')
if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error('RUNTIME_VERSION inválida.')
if (process.platform !== 'win32' || basename(process.execPath).toLowerCase() !== 'node.exe') throw new Error('Execute em runner Windows com node.exe.')

const ignored = new Set(['.git', '.local', '.pm2', '.private', 'data', 'dist', 'generated', 'memory', 'node_modules'])
const keep = (source) => {
  const path = relative(root, source)
  if (!path || path.startsWith('..')) return true
  return !ignored.has(path.split(/[\\/]/)[0]) && !path.endsWith('.env') && !path.endsWith('.log')
}
const digest = async (path) => createHash('sha256').update(await readFile(path)).digest('hex')
const archiveName = `thinkiac-runtime-win-x64-${version}.zip`
const archivePath = join(output, archiveName)
const stage = join(output, `.stage-${version}`)

await rm(stage, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(stage, { recursive: true })
try {
  const runtime = join(stage, 'thinkiac-runtime')
  await cp(root, runtime, { recursive: true, filter: keep })
  await cp(join(root, 'node_modules'), join(runtime, 'node_modules'), { recursive: true })
  await mkdir(join(runtime, 'node'), { recursive: true })
  await cp(process.execPath, join(runtime, 'node', 'node.exe'))
  await writeFile(join(runtime, '.thinkiac-runtime.json'), JSON.stringify({ version, platform: 'win32', arch: 'x64' }, null, 2))
  await new Promise((resolvePromise, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const stream = createWriteStream(archivePath)
    stream.once('close', resolvePromise)
    archive.once('error', reject)
    archive.pipe(stream)
    archive.directory(runtime, 'thinkiac-runtime')
    archive.finalize()
  })
} finally { await rm(stage, { recursive: true, force: true }) }

const platform = { asset: archiveName, sha256: await digest(archivePath), nodeEntrypoint: 'node/node.exe', size: (await stat(archivePath)).size }
const manifest = { schemaVersion: 2, runtime: { version, entrypoint: 'index.js', readinessPath: '/__ready', platforms: { 'win32-x64': platform } } }
await writeFile(join(output, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(output, 'checksums.txt'), `${platform.sha256}  ${archiveName}\n`)
