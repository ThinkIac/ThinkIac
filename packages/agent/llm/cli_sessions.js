
























import { randomUUID } from 'node:crypto'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { userInfo } from 'node:os'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))

const STORE_FILE = process.env.AGENT_CLI_SESSIONS_FILE
  || join(PKG_DIR, '..', 'memory', 'cli_sessions.json')







const WORKSPACE_ROOT = process.env.AGENT_CLI_WORKSPACE_ROOT
  || join(userInfo().homedir, '.agent', 'cli-workspaces')


/** @type {Map<string, {uuid:string, cwd:string, createdAt:string, lastUsed:string, turns:number}>} */
let store = null

function keyOf(provider, sessionId) {
  return `${provider}:${sessionId}`
}

function load() {
  if (store) return store
  store = new Map()
  try {
    if (existsSync(STORE_FILE)) {
      const raw = JSON.parse(readFileSync(STORE_FILE, 'utf8'))
      for (const [k, v] of Object.entries(raw || {})) {
        if (v && typeof v.uuid === 'string') store.set(k, v)
      }
    }
  } catch (e) {
    
    console.warn(`[cli_sessions] falha ao ler ${STORE_FILE}, começando vazio: ${e.message}`)
  }
  return store
}

function persist() {
  try {
    const dir = dirname(STORE_FILE)
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    const obj = {}
    for (const [k, v] of load()) obj[k] = v
    writeFileSync(STORE_FILE, JSON.stringify(obj, null, 2))
  } catch (e) {
    
    
    console.warn(`[cli_sessions] falha ao gravar ${STORE_FILE}: ${e.message}`)
  }
}

function sanitize(sessionId) {
  return String(sessionId).replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 120) || 'default'
}

/**
 * Garante o cwd (workspace) determinístico de uma sessão e o cria em disco.
 * @returns {string} caminho absoluto do workspace
 */
export function ensureSessionWorkspace(sessionId) {
  const cwd = join(WORKSPACE_ROOT, sanitize(sessionId))
  try {
    if (!existsSync(cwd)) mkdirSync(cwd, { recursive: true })
  } catch (e) {
    console.warn(`[cli_sessions] não consegui criar workspace ${cwd}: ${e.message}`)
  }
  return cwd
}

/**
 * Registro da sessão CLI de (provider, sessionId), criando um se não existir.
 * @param {string} provider  ex.: 'claude-cli'
 * @param {string} sessionId sessão de chat da Agent
 * @returns {{ uuid:string, cwd:string, isNew:boolean, turns:number }}
 *   isNew=true no 1º uso (usar `--session-id`); false depois (usar `--resume`).
 */
export function ensureCliSession(provider, sessionId) {
  const m = load()
  const key = keyOf(provider, sessionId)
  const cwd = ensureSessionWorkspace(sessionId)
  const existing = m.get(key)
  
  
  
  
  if (existing && existing.uuid && existing.cwd && existing.cwd !== cwd) {
    m.delete(key)
  } else if (existing && existing.uuid) {
    if (!existing.cwd) existing.cwd = cwd
    return { uuid: existing.uuid, cwd: existing.cwd, isNew: false, turns: existing.turns || 0 }
  }
  const rec = {
    uuid: randomUUID(),
    cwd,
    createdAt: new Date().toISOString(),
    lastUsed: new Date().toISOString(),
    turns: 0,
  }
  m.set(key, rec)
  persist()
  return { uuid: rec.uuid, cwd: rec.cwd, isNew: true, turns: 0 }
}

/** Marca um turno concluído (lastUsed/turns) pra observabilidade. */
export function touchCliSession(provider, sessionId) {
  const m = load()
  const rec = m.get(keyOf(provider, sessionId))
  if (!rec) return
  rec.lastUsed = new Date().toISOString()
  rec.turns = (rec.turns || 0) + 1
  persist()
}

/**
 * "Novo chat": esquece o UUID atual pra o próximo turno começar uma sessão
 * Claude Code limpa. O workspace em disco é preservado (histórico de arquivos).
 * @returns {boolean} true se havia sessão registrada
 */
export function resetCliSession(provider, sessionId) {
  const m = load()
  const key = keyOf(provider, sessionId)
  if (!m.has(key)) return false
  m.delete(key)
  persist()
  return true
}

/** Metadados da sessão CLI, ou null. Não cria nada. */
export function peekCliSession(provider, sessionId) {
  const m = load()
  return m.get(keyOf(provider, sessionId)) || null
}






const locks = new Map() 

/**
 * Roda `fn` com exclusão mútua sobre (provider, sessionId).
 * @template T
 * @param {string} provider
 * @param {string} sessionId
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withCliSessionLock(provider, sessionId, fn) {
  const key = keyOf(provider, sessionId)
  const prev = locks.get(key) || Promise.resolve()
  
  const run = prev.then(() => fn(), () => fn())
  
  
  const link = run.then(() => {}, () => {})
  locks.set(key, link)
  
  link.then(() => { if (locks.get(key) === link) locks.delete(key) })
  return run
}
