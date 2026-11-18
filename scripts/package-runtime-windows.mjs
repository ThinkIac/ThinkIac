import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'
import { pipeline } from 'node:stream/promises'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const version = process.env.RUNTIME_VERSION
const output = join(root, 'dist', 'runtime')
if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) throw new Error('RUNTIME_VERSION inválida.')
if (process.platform !== 'win32' || basename(process.execPath).toLowerCase() !== 'node.exe') throw new Error('Execute em runner Windows com node.exe.')

const ignored = new Set(['.git', '.github', '.local', '.logs', '.pm2', '.private', '.svelte-cache', 'data', 'dist', 'generated', 'memory', 'node_modules'])
const keep = (source) => {
  const path = relative(root, source)
  if (!path || path.startsWith('..')) return true
  return !ignored.has(path.split(/[\\/]/)[0]) && !/^\.env(?:$|\.(?!example$))/.test(basename(path))
    && !basename(path).startsWith('.database') && !path.endsWith('.log')
}
async function digest(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}
const archiveName = `thinkiac-runtime-win-x64-${version}.zip`
const archivePath = join(output, archiveName)
const stage = join(output, `.stage-${version}`)

await rm(stage, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(stage, { recursive: true })
try {
  const runtime = join(stage, 'thinkiac-runtime')
  await cp(root, runtime, { recursive: true, filter: keep })
  // npm file dependencies are junctions on Windows. Materialize them so the
  // archive can run with no references to the runner checkout.
  // Provider setup expects a writable config. Ship an empty pool list so
  // credentials and Cloud gateway placeholders stay out of the desktop.
  await writeFile(join(runtime, 'packages', 'agent', 'agent.config.json'), JSON.stringify({ llm: { pools: [] } }, null, 2))
  await cp(join(root, 'node_modules'), join(runtime, 'node_modules'), { recursive: true, dereference: true })
  // Lógos resolves capability modules beside its own package. Include
  // them beside the materialized npm packages as well as in vendor/.
  await cp(join(root, 'vendor', 'packages', 'modules'), join(runtime, 'node_modules', 'modules'), { recursive: true })
  await mkdir(join(runtime, 'node'), { recursive: true })
  await cp(process.execPath, join(runtime, 'node', 'node.exe'))
  await writeFile(join(runtime, '.thinkiac-runtime.json'), JSON.stringify({ version, platform: 'win32', arch: 'x64' }, null, 2))
  const archive = new ZipArchive({ zlib: { level: 6 } })
  archive.directory(runtime, 'thinkiac-runtime')
  await Promise.all([pipeline(archive, createWriteStream(archivePath)), archive.finalize()])
} finally { await rm(stage, { recursive: true, force: true }) }

const platform = { asset: archiveName, sha256: await digest(archivePath), nodeEntrypoint: 'node/node.exe', size: (await stat(archivePath)).size }
const manifest = { schemaVersion: 2, runtime: { version, entrypoint: 'index.js', readinessPath: '/__ready', platforms: { 'win32-x64': platform } } }
await writeFile(join(output, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(output, 'checksums.txt'), `${platform.sha256}  ${archiveName}\n`)
