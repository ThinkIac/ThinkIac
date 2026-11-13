















import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { execFile } from 'child_process'
import { discoverTerminalProfileAccounts } from '../llm/terminal_accounts.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')

const USAGE_TIMEOUT_MS = 45000
const CACHE_MS = 30000 

function expandHome(p) {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

function manualAccounts() {
  try {
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf8'))
    const pool = (config?.llm?.pools ?? []).find(p => p.provider === 'claude-cli') ?? null
    return (pool?.cli?.accounts ?? []).map(a => ({
      name: a.name, config_dir: expandHome(a.config_dir), kind: 'manual',
    }))
  } catch { return [] }
}

function allAccounts() {
  const terminal = discoverTerminalProfileAccounts().map(a => ({
    name: a.name, config_dir: a.config_dir, kind: 'terminal',
  }))
  const manual = manualAccounts()
  const seen = new Set(manual.map(a => a.config_dir))
  return [...manual, ...terminal.filter(a => !seen.has(a.config_dir))]
}

function accountShort(name) {
  return name?.startsWith('terminal:') ? name.slice('terminal:'.length) : name
}

/** Metadados do plano (não sensível) do .credentials.json — só pra exibir. */
function planMeta(account) {
  try {
    const creds = JSON.parse(readFileSync(join(account.config_dir, '.credentials.json'), 'utf8'))
    const o = creds?.claudeAiOauth || {}
    return { subscriptionType: o.subscriptionType || null, hasLogin: !!o.accessToken, expiresAt: o.expiresAt || null }
  } catch {
    return { subscriptionType: null, hasLogin: false, expiresAt: null }
  }
}

/** Env pra rodar o `claude` na conta certa (idem widget de sessões). */
function quotaEnv(account) {
  const env = { ...process.env }
  if (account.kind === 'terminal') {
    env.HOME = dirname(account.config_dir)
    delete env.CLAUDE_CONFIG_DIR
  } else {
    env.CLAUDE_CONFIG_DIR = account.config_dir
  }
  return env
}


const ANSI_RE = /\[[0-9;]*m/g

/** Parseia o texto do /usage em janelas {label, utilization(0-100), resetText}. */
function parseUsage(text) {
  const windows = []
  const clean = text.replace(ANSI_RE, '')
  
  
  const re = /Current (session|week(?:\s*\(([^)]+)\))?):\s*(\d+)%\s*used(?:\s*[·-]\s*resets\s*([^\n]+))?/gi
  let m
  while ((m = re.exec(clean)) !== null) {
    const kind = m[1].toLowerCase().startsWith('session') ? 'Sessão (5h)' : 'Semana'
    const qualifier = m[2] && !/all models/i.test(m[2]) ? ` (${m[2].trim()})` : ''
    windows.push({
      label: `${kind}${qualifier}`,
      utilization: parseInt(m[3], 10),
      resetText: (m[4] || '').trim() || null,
    })
  }
  return windows
}

const _cache = new Map() 

function runUsage(account) {
  return new Promise((resolve) => {
    if (!existsSync(join(account.config_dir, '.credentials.json'))) {
      return resolve({ ok: false, error: 'sem login (credencial ausente)' })
    }
    execFile(
      'claude', ['-p', '/usage'],
      { env: quotaEnv(account), timeout: USAGE_TIMEOUT_MS, maxBuffer: 4 * 1024 * 1024, encoding: 'utf8' },
      (err, stdout) => {
        const text = (stdout || '').trim()
        if (err && !text) return resolve({ ok: false, error: err.killed ? 'timeout' : err.message })
        const windows = parseUsage(text)
        resolve({ ok: true, windows, rawText: windows.length ? undefined : text.slice(0, 500) })
      },
    )
  })
}

async function fetchQuota(account) {
  const meta = planMeta(account)
  const base = { name: accountShort(account.name), kind: account.kind, subscriptionType: meta.subscriptionType }
  if (!meta.hasLogin) return { ...base, ok: false, error: 'sem login (credencial ausente)' }

  const cached = _cache.get(account.config_dir)
  if (cached && Date.now() - cached.ts < CACHE_MS) return { ...base, ...cached.data }

  const data = await runUsage(account)
  if (data.ok) _cache.set(account.config_dir, { ts: Date.now(), data })
  return { ...base, ...data }
}

export async function claudeQuota(req, res) {
  /**
   * @register_router claude-quota
   * @method GET
   *
   * Resposta: { success, accounts: [{ name, kind, subscriptionType, ok,
   *   windows: [{ label, utilization, resetText }], rawText?, error? }] }
   */
  try {
    const accounts = await Promise.all(allAccounts().map(fetchQuota))
    return { success: true, accounts }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
