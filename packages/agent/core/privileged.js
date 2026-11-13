

import { readFileSync, writeFileSync, existsSync, readdirSync, statSync, lstatSync, realpathSync, mkdirSync } from 'fs'
import { join, resolve, relative, dirname, basename, isAbsolute }                    from 'path'
import { fileURLToPath }                                                              from 'url'
import { createRequire }                                                              from 'module'
import { execFile }                                                                   from 'child_process'
import { promisify }                                                                  from 'util'
import { saveSnapshot }                                                               from '../memory/history.js'
import { bagReadCache } from './bag_read_cache.js'




const { findBySession } = (() => {
  try {
    return createRequire(import.meta.url)('../../variants/lib/registry.js')
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND') throw err
    return { findBySession: () => null }
  }
})()

const execAsync     = promisify(execFile)
const PKG_DIR     = dirname(fileURLToPath(import.meta.url))
const PROJECT_DIR = resolve(PKG_DIR, '..', '..', '..')


const CORE_FILES = new Set([
  'agent.js', 'builtin_tools.js', 'channels.js', 'config.js',
  'history.js', 'llm.js', 'llm_keys.js', 'memory.js',
  'metacognition.js', 'privileged.js', 'registry.js',
  'runtime_bridge.js', 'sandbox.js',
  'timezone.js', 'provider.js',
])

function isCoreFile(absPath) {
  let physicalPath = absPath
  try { physicalPath = realpathSync(absPath) } catch {}
  return CORE_FILES.has(basename(physicalPath)) && isWithin(PKG_DIR, physicalPath)
}

let _currentCtx = { session_id: 'unknown', tool_call: 'unknown' }
export function setPrivilegedContext(ctx) { _currentCtx = { ..._currentCtx, ...ctx } }
export function clearPrivilegedContext()  { _currentCtx = { session_id: 'unknown', tool_call: 'unknown' } }
export function getPrivilegedContext()    { return _currentCtx }





function currentRoot() {
  try {
    const variant = findBySession(_currentCtx.session_id)
    if (variant) return join(variant.worktreePath, 'apps', 'runtime')
  } catch {}
  return PROJECT_DIR
}

function isWithin(root, candidate) {
  const rel = relative(root, candidate)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) && !isAbsolute(rel))
}

function assertContained(root, p) {
  const lexicalRoot = resolve(root)
  const candidate = resolve(lexicalRoot, p)
  if (!isWithin(lexicalRoot, candidate)) throw new Error(`Path fora do projeto: ${p}`)

  const physicalRoot = realpathSync(lexicalRoot)
  let existing = candidate
  while (true) {
    try {
      lstatSync(existing)
      break
    } catch (err) {
      if (err?.code !== 'ENOENT') throw err
      const parent = dirname(existing)
      if (parent === existing) throw err
      existing = parent
    }
  }

  let physicalExisting
  try {
    physicalExisting = realpathSync(existing)
  } catch {
    throw new Error(`Path fora do projeto: ${p}`)
  }
  if (!isWithin(physicalRoot, physicalExisting)) throw new Error(`Path fora do projeto: ${p}`)
  return candidate
}

const assertRead  = (p) => assertContained(currentRoot(), p)
const assertWrite = (p) => assertContained(currentRoot(), p)

async function checkJsSyntax(absPath) {
  if (!/\.(js|mjs|cjs|ts)$/.test(absPath)) return null
  try {
    await execAsync('node', ['--check', absPath], { timeout: 5000, maxBuffer: 64 * 1024 })
    return null
  } catch (e) {
    return e.stderr?.trim() || e.message
  }
}

export async function handleReadFile({ path: p }, hostContext = {}) {
  const abs = assertRead(p)
  if (!existsSync(abs)) return { success: false, error: `Nao encontrado: ${p}` }
  try {
    const read = hostContext.bagReadScope
      ? bagReadCache.read(abs, hostContext.bagReadScope)
      : { content: readFileSync(abs, 'utf8') }
    return { success: true, absolute: abs, path: relative(currentRoot(), abs), lines: read.content.split('\n').length, ...read }
  } catch (e) { return { success: false, error: e.message } }
}

export async function handleWriteFile({ path: p, content, append = false }) {
  const abs = assertWrite(p)

  
  if (isCoreFile(abs)) {
    console.warn(`[Agent] ⛔ write_file bloqueado em arquivo core: ${basename(abs)}`)
    return {
      success: false,
      error: `"${basename(abs)}" é um arquivo core protegido. Use patch_file para edições cirúrgicas. write_file em arquivos core é bloqueado pelo sistema de segurança.`,
      core_protected: true,
    }
  }

  try {
    const snap = saveSnapshot(abs, { ..._currentCtx, reason: append ? 'write_file (append)' : 'write_file (overwrite)' })
    mkdirSync(dirname(abs), { recursive: true })
    writeFileSync(abs, append && existsSync(abs) ? readFileSync(abs, 'utf8') + content : content, 'utf8')
    const syntaxErr = await checkJsSyntax(abs)
    if (syntaxErr) {
      if (snap) {
        writeFileSync(abs, snap.content, 'utf8')
        return { success: false, path: relative(currentRoot(), abs), error: `Sintaxe inválida — rollback automático para ${snap.timestamp}`, syntax_error: syntaxErr, rolled_back: true, rolled_back_to: snap.timestamp }
      }
      return { success: false, path: relative(currentRoot(), abs), error: 'Sintaxe inválida', syntax_error: syntaxErr }
    }
    return { success: true, path: relative(currentRoot(), abs), bytes: Buffer.byteLength(content, 'utf8'), snapshot_at: snap?.timestamp ?? null }
  } catch (e) { return { success: false, error: e.message } }
}

export async function handlePatchFile({ path: p, old_str, new_str }) {
  const abs = assertWrite(p)
  if (!existsSync(abs)) return { success: false, error: `Nao encontrado: ${p}` }

  const isCoreWrite = isCoreFile(abs)
  if (isCoreWrite) {
    console.log(`[Agent] 🔐 patch_file em arquivo core: ${basename(abs)} — snapshot obrigatório`)
  }

  try {
    const original = readFileSync(abs, 'utf8')
    const snap     = saveSnapshot(abs, { ..._currentCtx, reason: isCoreWrite ? 'patch_file (CORE)' : 'patch_file' })
    const escaped  = old_str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const count    = (original.match(new RegExp(escaped, 'g')) ?? []).length
    if (count === 0) return { success: false, error: 'old_str nao encontrado' }
    if (count > 1)   return { success: false, error: `old_str aparece ${count}x — precisa ser unico` }
    const patched = original.replace(old_str, new_str)
    writeFileSync(abs, patched, 'utf8')
    const syntaxErr = await checkJsSyntax(abs)
    if (syntaxErr) {
      writeFileSync(abs, original, 'utf8')
      return { success: false, path: relative(currentRoot(), abs), error: 'Sintaxe inválida após patch — rollback automático', syntax_error: syntaxErr, rolled_back: true }
    }
    return {
      success:    true,
      path:       relative(currentRoot(), abs),
      snapshot_at: snap?.timestamp ?? null,
      core_file:  isCoreWrite,
    }
  } catch (e) { return { success: false, error: e.message } }
}

const IGNORE = ['node_modules', '.git', '.turbo', 'dist', '.cache', 'embeddings.json']

function walk(dir, depth, max, root = currentRoot()) {
  if (depth > max) return []
  const out = []
  for (const name of readdirSync(dir)) {
    if (IGNORE.includes(name)) continue
    const abs = join(dir, name)
    assertContained(root, abs)
    const rel = relative(root, abs), stat = statSync(abs)
    if (stat.isDirectory()) { out.push({ type: 'dir',  path: rel, name }); out.push(...walk(abs, depth + 1, max, root)) }
    else                      out.push({ type: 'file', path: rel, name, bytes: stat.size })
  }
  return out
}

export async function handleListDir({ path: p = '.', depth = 3 }) {
  const abs = assertRead(p)
  const root = currentRoot()
  try { return { success: true, root: relative(root, abs) || '.', entries: walk(abs, 0, depth, root) } }
  catch (e) { return { success: false, error: e.message } }
}

export const __privilegedTest = { assertContained, walk }

export async function handleSearchCode({ query, path: p = '.', file_pattern = '*.js,*.ts,*.md,*.json' }) {
  const abs     = assertRead(p)
  const include = file_pattern.split(',').map(x => `--include="${x.trim()}"`).join(' ')
  const cmd     = `grep -rn --color=never ${include} -i "${query.replace(/"/g, '\\"')}" .`
  try {
    const { stdout } = await execAsync('sh', ['-c', cmd], { cwd: abs, timeout: 8000, maxBuffer: 1024 * 256 })
    const matches = stdout.trim().split('\n').filter(Boolean).map(line => {
      const c1 = line.indexOf(':'), c2 = line.indexOf(':', c1 + 1)
      return { file: relative(currentRoot(), resolve(abs, line.slice(0, c1))), line: parseInt(line.slice(c1 + 1, c2)), match: line.slice(c2 + 1).trim() }
    })
    return { success: true, query, count: matches.length, matches }
  } catch (e) {
    if (e.code === 1) return { success: true, query, count: 0, matches: [] }
    return { success: false, error: e.message }
  }
}

export async function handleReloadConfig() {
  try {
    const { clearConfigCache } = await import('../utils/config.js')
    const { clearAgentCache  } = await import('./agent.js')
    clearConfigCache?.(); clearAgentCache?.()
    return { success: true, message: 'Config reloaded.' }
  } catch { return { success: true, message: 'Reinicie o servidor para aplicar mudanças.' } }
}
