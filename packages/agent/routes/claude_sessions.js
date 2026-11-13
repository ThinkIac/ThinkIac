




















import { readFileSync, readdirSync, existsSync, statSync, openSync, readSync, closeSync } from 'fs'
import { join, dirname, basename } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { spawnSync } from 'child_process'
import { discoverTerminalProfileAccounts } from '../llm/terminal_accounts.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')

const UUID_RE = /^[0-9a-fA-F-]{16,64}$/
const HEAD_BYTES = 64 * 1024 
const MAX_SESSIONS = 300      



const pendingOpens = []



function expandHome(p) {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

/** Aspas seguras pra um argumento de shell (paths podem ter espaço). */
function shq(s) {
  return `'${String(s).replace(/'/g, `'\\''`)}'`
}

/** Contas manuais registradas em agent.config.json (pool claude-cli). */
function manualAccounts() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    const pools = config?.llm?.pools ?? []
    const pool = pools.find(p => p.provider === 'claude-cli') ?? null
    const accts = pool?.cli?.accounts ?? []
    return accts.map(a => ({
      name: a.name,
      config_dir: expandHome(a.config_dir),
      kind: 'manual',
      profileId: null,
      source: 'manual',
    }))
  } catch {
    return []
  }
}

/**
 * Todas as contas com sessões: perfis do Terminal (resume via HOME=<perfil>) +
 * contas manuais (resume via CLAUDE_CONFIG_DIR=<dir>). Deduplicado por
 * config_dir; a manual prevalece (permite override explícito).
 */
function allAccounts() {
  const terminal = discoverTerminalProfileAccounts().map(a => ({
    name: a.name,                              
    config_dir: a.config_dir,                  
    kind: 'terminal',
    profileId: a.name.startsWith('terminal:') ? a.name.slice('terminal:'.length) : a.name,
    source: 'terminal-profile',
  }))
  const manual = manualAccounts()
  const seen = new Set(manual.map(a => a.config_dir))
  return [...manual, ...terminal.filter(a => !seen.has(a.config_dir))]
}

/** Lê só o começo do arquivo (não carrega transcripts de MBs inteiros). */
function readHead(file) {
  let fd
  try {
    fd = openSync(file, 'r')
    const buf = Buffer.allocUnsafe(HEAD_BYTES)
    const n = readSync(fd, buf, 0, HEAD_BYTES, 0)
    return buf.toString('utf8', 0, n)
  } catch {
    return ''
  } finally {
    if (fd !== undefined) try { closeSync(fd) } catch {}
  }
}

function firstText(content) {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    for (const part of content) {
      if (typeof part === 'string') return part
      if (part && typeof part === 'object' && typeof part.text === 'string') return part.text
    }
  }
  return ''
}

/**
 * Extrai metadados de um transcript sem parsear ele todo: cwd real + título (1ª
 * mensagem de usuário). Devolve null se não houver conteúdo de usuário (sessões
 * vazias/só queue-operation ficam de fora).
 */
function extractMeta(file) {
  const head = readHead(file)
  if (!head) return null
  let cwd = null
  let title = null
  let summary = null
  for (const line of head.split('\n')) {
    if (!line.trim()) continue
    let obj
    try { obj = JSON.parse(line) } catch { continue }
    if (obj.type === 'summary' && typeof obj.summary === 'string' && !summary) summary = obj.summary
    if (obj.type === 'user' && obj.message) {
      if (!cwd && typeof obj.cwd === 'string') cwd = obj.cwd
      const text = firstText(obj.message.content).trim()
      
      if (!title && text && !text.startsWith('<') && !text.startsWith('Caveat:')) {
        title = text
      }
      if (cwd && title) break
    }
  }
  if (!cwd) return null 
  return { cwd, title: (title || summary || '').slice(0, 120) }
}

/** Varre os transcripts .jsonl em <config_dir>/projects de uma conta. */
function scanAccount(account) {
  const projectsDir = join(account.config_dir, 'projects')
  if (!existsSync(projectsDir)) return []
  const out = []
  let dirs
  try { dirs = readdirSync(projectsDir, { withFileTypes: true }) } catch { return [] }
  for (const d of dirs) {
    if (!d.isDirectory()) continue
    const projDir = join(projectsDir, d.name)
    let files
    try { files = readdirSync(projDir) } catch { continue }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue
      const id = basename(f, '.jsonl')
      if (!UUID_RE.test(id)) continue
      const file = join(projDir, f)
      let mtime, size
      try { const st = statSync(file); mtime = st.mtimeMs; size = st.size } catch { continue }
      const meta = extractMeta(file)
      if (!meta) continue
      
      
      
      if (!meta.title) continue
      out.push({
        id,
        cwd: meta.cwd,
        title: meta.title,
        mtime,
        size,
        account: account.name,
        accountKind: account.kind,
        profileId: account.profileId,
        config_dir: account.config_dir,
      })
    }
  }
  return out
}













function thinkClaude(subcmd, params) {
  return `think agent:${subcmd} --params ${shq(JSON.stringify(params))}`
}

/** Monta o comando de launch (server-side; nunca confia em cwd do cliente). */
function buildLaunch(session) {
  const params = { dir: session.cwd, claude_args: `--resume ${session.id}` }
  const cmd = thinkClaude('claude', params)
  let initCommand
  let profileId
  if (session.accountKind === 'terminal') {
    
    
    
    profileId = session.profileId || 'default'
    initCommand = cmd
  } else {
    
    profileId = 'default'
    initCommand = `CLAUDE_CONFIG_DIR=${shq(session.config_dir)} ${cmd}`
  }
  return { profileId, initCommand, label: session.title }
}

function scanAll() {
  const sessions = []
  for (const account of allAccounts()) {
    sessions.push(...scanAccount(account))
  }
  sessions.sort((a, b) => b.mtime - a.mtime)
  return sessions.slice(0, MAX_SESSIONS)
}









const AGENTS_TIMEOUT_MS = 8000
const ACTIVE_CACHE_MS = 5000

/** Env pra rodar o `claude` na conta certa (mesma lógica do buildLaunch). */
function agentsEnv(account) {
  const env = { ...process.env }
  if (account.kind === 'terminal') {
    
    env.HOME = dirname(account.config_dir)
    delete env.CLAUDE_CONFIG_DIR
  } else {
    env.CLAUDE_CONFIG_DIR = account.config_dir
  }
  return env
}

/** Sessões ativas (uuid) de uma conta via `claude agents --json`. Best-effort. */
function listActiveAgents(account) {
  try {
    const res = spawnSync('claude', ['agents', '--json'], {
      env: agentsEnv(account),
      encoding: 'utf8',
      timeout: AGENTS_TIMEOUT_MS,
      maxBuffer: 8 * 1024 * 1024,
    })
    if (res.status !== 0 || !res.stdout) return []
    const arr = JSON.parse(res.stdout)
    return Array.isArray(arr) ? arr : []
  } catch {
    return []
  }
}








function agentState(a) {
  const state = String(a?.state || '').toLowerCase()
  const status = String(a?.status || '').toLowerCase()
  if (state === 'working' || status === 'busy' || status === 'running') return 'working'
  return 'input'
}

/** Ids (uuid + id curto) das sessões ativas de uma conta. */
function activeIdsForAccount(account) {
  const ids = new Set()
  for (const a of listActiveAgents(account)) {
    if (a?.sessionId) ids.add(a.sessionId)
    if (a?.id) ids.add(a.id)
  }
  return ids
}





let _activeCache = { ts: 0, ids: [], states: {} }
function refreshActive() {
  const now = Date.now()
  if (now - _activeCache.ts < ACTIVE_CACHE_MS) return _activeCache
  const ids = new Set()
  const states = {}
  for (const account of allAccounts()) {
    for (const a of listActiveAgents(account)) {
      const st = agentState(a)
      for (const key of [a?.sessionId, a?.id]) {
        if (!key) continue
        ids.add(key)
        
        if (states[key] !== 'working') states[key] = st
      }
    }
  }
  _activeCache = { ts: now, ids: [...ids], states }
  return _activeCache
}
function activeSessionIds() {
  return refreshActive().ids
}

/** Launch que abre o gerenciador de agents (anexa a sessão que já roda). */
function buildAgentsLaunch(session) {
  const cmd = thinkClaude('claude:agents', { dir: session.cwd })
  let initCommand, profileId
  if (session.accountKind === 'terminal') {
    profileId = session.profileId || 'default'
    initCommand = cmd
  } else {
    profileId = 'default'
    initCommand = `CLAUDE_CONFIG_DIR=${shq(session.config_dir)} ${cmd}`
  }
  return { profileId, initCommand, label: `Agents · ${session.title}` }
}



export async function listClaudeSessions(req, res) {
  /**
   * @register_router claude-sessions
   * @method GET
   */
  try {
    const sessions = scanAll().map(s => ({
      id: s.id,
      title: s.title,
      cwd: s.cwd,
      mtime: s.mtime,
      account: s.account,
      accountKind: s.accountKind,
      profileId: s.profileId,
    }))
    return { success: true, sessions }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function openClaudeSession(req, res) {
  /**
   * @register_router claude-sessions/open
   * @method POST
   */
  const { sessionId, configDir } = req.body ?? {}
  if (!sessionId || !UUID_RE.test(sessionId)) {
    return { success: false, error: 'sessionId inválido' }
  }
  try {
    
    
    const wantDir = configDir ? expandHome(configDir) : null
    const match = scanAll().find(s => s.id === sessionId && (!wantDir || s.config_dir === wantDir))
    if (!match) return { success: false, error: 'sessão não encontrada' }

    
    
    
    const account = { kind: match.accountKind, config_dir: match.config_dir }
    const isRunning = activeIdsForAccount(account).has(match.id)

    const launch = isRunning ? buildAgentsLaunch(match) : buildLaunch(match)
    pendingOpens.push({ ...launch, ts: Date.now() })
    return {
      success: true,
      action: isRunning ? 'agents' : 'resume',
      launch: { profileId: launch.profileId, label: launch.label },
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function activeClaudeSessions(req, res) {
  /**
   * @register_router claude-sessions/active
   * @method GET
   */
  
  
  
  try {
    const { ids, states } = refreshActive()
    return { success: true, active: ids, states }
  } catch (e) {
    return { success: false, error: e.message, active: [], states: {} }
  }
}

export async function launchClaudeCommand(req, res) {
  /**
   * @register_router claude-sessions/launch
   * @method POST
   */
  
  
  const { kind } = req.body ?? {}
  
  
  
  const commands = {
    new: { initCommand: 'think agent:claude', label: 'Nova sessão' },
    agents: { initCommand: 'think agent:claude:agents', label: 'Agents' },
  }
  const cfg = commands[kind]
  if (!cfg) return { success: false, error: 'kind inválido (use "new" ou "agents")' }
  pendingOpens.push({ profileId: 'default', ...cfg, ts: Date.now() })
  return { success: true }
}

export async function pendingClaudeSessions(req, res) {
  /**
   * @register_router claude-sessions/pending
   * @method GET
   */
  
  
  const items = pendingOpens.splice(0, pendingOpens.length)
  return { success: true, opens: items }
}
