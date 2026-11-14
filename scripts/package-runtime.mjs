import { createHash } from 'node:crypto'
import { createWriteStream, existsSync } from 'node:fs'
import { cp, mkdir, rm, stat, writeFile } from 'node:fs/promises'
import { basename, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import archiver from 'archiver'

const root = resolve(fileURLToPath(new URL('..', import.meta.url)))
const output = join(root, 'dist')
const version = process.env.RUNTIME_VERSION || process.argv.find((arg) => arg.startsWith('--version='))?.slice(10)

if (!version || !/^[A-Za-z0-9._-]+$/.test(version)) {
  throw new Error('Defina RUNTIME_VERSION com letras, números, ponto, hífen ou sublinhado.')
}

if (process.platform !== 'win32') {
  throw new Error('O runtime Windows precisa ser montado em um runner Windows.')
}

const nodeExecutable = process.execPath
if (!existsSync(nodeExecutable) || basename(nodeExecutable).toLowerCase() !== 'node.exe') {
  throw new Error('node.exe não foi encontrado no runner Windows.')
}

const ignoredRoots = new Set(['.git', '.local', '.pm2', '.private', 'data', 'dist', 'generated', 'memory', 'node_modules'])
function shouldCopy(source) {
  const path = relative(root, source)
  if (!path || path.startsWith('..')) return true
  const first = path.split(/[\\/]/)[0]
  return !ignoredRoots.has(first) && !path.endsWith('.env') && !path.endsWith('.log')
}

async function zipDirectory(source, destination) {
  await new Promise((resolvePromise, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const stream = createWriteStream(destination)
    stream.once('close', resolvePromise)
    archive.once('error', reject)
    archive.pipe(stream)
    archive.directory(source, 'thinkiac-runtime')
    archive.finalize()
  })
}

async function sha256(path) {
  return createHash('sha256').update(await (await import('node:fs/promises')).readFile(path)).digest('hex')
}

const stage = join(output, `.runtime-stage-${version}`)
const archiveName = `thinkiac-runtime-win-x64-${version}.zip`
const archivePath = join(output, archiveName)

await rm(stage, { recursive: true, force: true })
await rm(archivePath, { force: true })
await mkdir(stage, { recursive: true })

try {
  const runtimeDir = join(stage, 'thinkiac-runtime')
  await cp(root, runtimeDir, { recursive: true, filter: shouldCopy })
  await cp(join(root, 'node_modules'), join(runtimeDir, 'node_modules'), { recursive: true })
  await mkdir(join(runtimeDir, 'node'), { recursive: true })
  await cp(nodeExecutable, join(runtimeDir, 'node', 'node.exe'))
  await writeFile(join(runtimeDir, '.thinkiac-runtime.json'), JSON.stringify({ version, platform: 'win32', arch: 'x64' }, null, 2))
  await zipDirectory(runtimeDir, archivePath)
} finally {
  await rm(stage, { recursive: true, force: true })
}

const size = (await stat(archivePath)).size
const manifest = {
  schemaVersion: 2,
  runtime: {
    version,
    entrypoint: 'index.js',
    readinessPath: '/__ready',
    platforms: {
      'win32-x64': {
        asset: archiveName,
        sha256: await sha256(archivePath),
        nodeEntrypoint: 'node/node.exe',
        size
      }
    }
  }
}
await writeFile(join(output, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
await writeFile(join(output, 'checksums.txt'), `${manifest.runtime.platforms['win32-x64'].sha256}  ${archiveName}\n`)
console.log(`Runtime Windows pronto: ${archivePath}`)
