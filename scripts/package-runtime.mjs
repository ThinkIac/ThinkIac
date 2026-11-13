#!/usr/bin/env node
/**
 * Builds the portable ThinkIac runtime source archive.
 *
 * This deliberately contains no node_modules, user data, generated caches or
 * credentials. Platform consumers install/ship their compatible Node runtime
 * and native dependencies beside this immutable application payload.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, promises as fs } from 'node:fs'
import { dirname, join, normalize, resolve, sep } from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { ZipArchive } from 'archiver'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const args = new Map()
for (let index = 2; index < process.argv.length; index += 2) {
  const key = process.argv[index]
  if (!key?.startsWith('--')) throw new Error(`Invalid argument: ${key}`)
  args.set(key.slice(2), process.argv[index + 1])
}

const command = (...commandArgs) => {
  const result = spawnSync(commandArgs[0], commandArgs.slice(1), {
    cwd: root,
    encoding: 'utf8',
  })
  if (result.status !== 0) throw new Error(result.stderr?.trim() || `Command failed: ${commandArgs.join(' ')}`)
  return result.stdout.trim()
}

const packageJson = JSON.parse(await fs.readFile(join(root, 'package.json'), 'utf8'))
const commit = args.get('commit') || command('git', 'rev-parse', 'HEAD')
const commitTime = Number(command('git', 'show', '-s', '--format=%ct', commit))
const version = args.get('version') || packageJson.version
const outputDir = resolve(root, args.get('output') || 'dist/runtime')
const safeVersion = version.replace(/[^A-Za-z0-9._-]/g, '-')
if (!safeVersion) throw new Error('Version must contain at least one filename-safe character')

const excludedPrefixes = ['.github/', '.git/', '.codex/', 'dist/', 'node_modules/']
const files = command('git', 'ls-files', '-z')
  .split('\0')
  .filter(Boolean)
  .filter((file) => !excludedPrefixes.some((prefix) => file === prefix.slice(0, -1) || file.startsWith(prefix)))

if (!files.includes('index.js') || !files.includes('package-lock.json')) {
  throw new Error('Runtime archive requires tracked index.js and package-lock.json')
}

const archiveName = `thinkiac-runtime-${safeVersion}.zip`
const archivePath = join(outputDir, archiveName)
const runtimeManifest = {
  schemaVersion: 1,
  name: 'thinkiac-runtime',
  version,
  commit,
  entrypoint: 'index.js',
  packageManager: 'npm',
  node: packageJson.engines?.node || '>=20',
  readinessPath: '/__ready',
  healthPath: '/__health',
  archiveRoot: 'thinkiac-runtime',
  fileCount: files.length,
}

await fs.mkdir(outputDir, { recursive: true })
await fs.rm(archivePath, { force: true })

const output = createWriteStream(archivePath)
const archive = new ZipArchive({ zlib: { level: 9 } })
const completed = new Promise((resolvePromise, rejectPromise) => {
  output.on('close', resolvePromise)
  output.on('error', rejectPromise)
  archive.on('warning', rejectPromise)
  archive.on('error', rejectPromise)
})

archive.pipe(output)
const date = new Date(commitTime * 1000)
for (const file of files) {
  const absolutePath = resolve(root, file)
  const archivePathname = join(runtimeManifest.archiveRoot, file).split(sep).join('/')
  if (!normalize(absolutePath).startsWith(`${root}${sep}`)) throw new Error(`Refusing path outside repository: ${file}`)
  archive.file(absolutePath, { name: archivePathname, date })
}
archive.append(`${JSON.stringify(runtimeManifest, null, 2)}\n`, {
  name: `${runtimeManifest.archiveRoot}/runtime.json`,
  date,
})
await archive.finalize()
await completed

const sha256 = createHash('sha256').update(await fs.readFile(archivePath)).digest('hex')
const releaseManifest = {
  schemaVersion: 1,
  runtime: {
    ...runtimeManifest,
    asset: archiveName,
    sha256,
    bytes: (await fs.stat(archivePath)).size,
  },
}
const manifestPath = join(outputDir, 'runtime-manifest.json')
const checksumsPath = join(outputDir, 'checksums.txt')
await fs.writeFile(manifestPath, `${JSON.stringify(releaseManifest, null, 2)}\n`)
await fs.writeFile(checksumsPath, `${sha256}  ${archiveName}\n`)

process.stdout.write(`${JSON.stringify({ archivePath, manifestPath, checksumsPath, sha256, files: files.length })}\n`)
