import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'







import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { clearConfigCache } from '../utils/config.js'
import { mergeWithTerminalGeminiAccounts, discoverTerminalGeminiAccounts } from '../llm/terminal_accounts.js'
import { GEMINI } from '../llm/gemini_cli.js'
import { buildSlots } from '../llm/llm_keys.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')
const NAME_RE = /^[a-z0-9_-]+$/i
const pending = []
const shq = (s) => `'${String(s).replace(/'/g, `'\\''`)}'`

const load = () => normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
function save(config) { persistAgentConfig(config); clearConfigCache() }
function expandHome(p) { return p === '~' ? homedir() : p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p }
function status(dir) { return existsSync(join(expandHome(dir), GEMINI.credentialFile)) ? 'logged_in' : 'pending_login' }

function poolFor(config, create = false) {
  config.llm ??= {}; config.llm.pools ??= []
  let pool = config.llm.pools.find(p => p.name === GEMINI.pool) ?? config.llm.pools.find(p => p.provider === GEMINI.provider)
  if (!pool && create) {
    pool = { name: GEMINI.pool, provider: GEMINI.provider, model: null, enabled: false,
      cli: { timeout_ms: null, approval_mode: 'yolo', accounts: [] },
      _comment: 'Gerenciado pelo app Antigravity (aba Gemini CLI). Login manual: abra um perfil do Terminal, rode gemini e escolha /auth.' }
    config.llm.pools.push(pool)
  }
  if (pool) { pool.cli ??= {}; pool.cli.accounts ??= [] }
  return pool
}

function state(config) {
  const pool = poolFor(config)
  const accounts = mergeWithTerminalGeminiAccounts(pool?.cli?.accounts ?? []).map(a => {
    const home = a.home ?? dirname(expandHome(a.config_dir))
    return { name: a.name, config_dir: a.config_dir, source: a.source ?? 'manual',
      status: status(a.config_dir), login_command: GEMINI.loginCommand(home) }
  })
  const fallbackProviders = [...new Set(buildSlots(config)
    .filter(slot => slot.provider !== GEMINI.provider)
    .map(slot => slot.provider))]
  return { success: true, pool_enabled: !!pool?.enabled, model: pool?.model ?? null,
    approval_mode: pool?.cli?.approval_mode ?? null, accounts, cli_binary: GEMINI.bin,
    fallback_providers: fallbackProviders }
}

export async function listGeminiAccounts() {
  /**
   * @register_router gemini-accounts
   * @method GET
   * @description Contas do Gemini CLI (perfis do Terminal + manuais) e estado do pool.
   */
  try { return state(load()) } catch (e) { return { success: false, error: e.message } }
}

export async function addGeminiAccount(req) {
  /**
   * @register_router gemini-accounts
   * @method POST
   * @description Registra uma conta manual (um HOME dedicado). Body: { name, config_dir? }.
   */
  const { name, config_dir } = req.body ?? {}
  if (!name || !NAME_RE.test(name)) return { success: false, error: 'name inválido' }
  try {
    const config = load(), pool = poolFor(config, true)
    if (pool.cli.accounts.some(a => a.name === name)) return { success: false, error: 'Conta já registrada.' }
    const home = expandHome(config_dir?.trim() || join(homedir(), `.gemini-home-${name}`))
    if (!isAbsolute(home) || resolve(home) === '/' || resolve(home).startsWith('/etc') || resolve(home).startsWith('/usr')) {
      return { success: false, error: 'config_dir inválido.' }
    }
    
    pool.cli.accounts.push({ name, home, config_dir: join(home, GEMINI.homeDirName) })
    save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function removeGeminiAccount(req) {
  /**
   * @register_router gemini-accounts/:name
   * @method DELETE
   * @description Remove uma conta manual (perfis do Terminal não são removíveis daqui).
   */
  try {
    const config = load(), pool = poolFor(config)
    if (!pool) return { success: false, error: 'Pool gemini-cli não existe.' }
    const before = pool.cli.accounts.length
    pool.cli.accounts = pool.cli.accounts.filter(a => a.name !== req.params?.name)
    if (before === pool.cli.accounts.length) return { success: false, error: 'Conta não encontrada.' }
    if (!pool.cli.accounts.length) pool.enabled = false
    save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function toggleGeminiPool(req) {
  /**
   * @register_router gemini-accounts/pool
   * @method PATCH
   * @description Liga/desliga o pool gemini-cli. Body: { enabled: boolean }.
   */
  try {
    const config = load(), pool = poolFor(config, true)
    if (req.body?.enabled && !mergeWithTerminalGeminiAccounts(pool.cli.accounts).some(a => status(a.config_dir) === 'logged_in')) {
      return { success: false, error: 'Faça login (gemini → /auth) em um perfil do Terminal antes de habilitar o provider.' }
    }
    pool.enabled = !!req.body?.enabled; save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}


export async function geminiUsage() {
  /**
   * @register_router gemini-usage
   * @method GET
   * @description Estado de login das contas Gemini por perfil do Terminal.
   */
  const accounts = discoverTerminalGeminiAccounts().map(a => ({
    name: a.name, logged_in: existsSync(join(a.config_dir, GEMINI.credentialFile)),
  }))
  return { success: true, accounts, logged_in: accounts.filter(a => a.logged_in).length, quota_available: false,
    message: 'Login reconhecido. O CLI não expõe API pública de quota; o Agent não lê tokens.' }
}

export async function launchGeminiSession(req) {
  /**
   * @register_router gemini-sessions/launch
   * @method POST
   * @description Enfileira uma sessão no Terminal. Body: { kind: 'new' | 'resume', profileId?, cwd? }.
   */
  const kind = req.body?.kind
  if (kind !== 'new' && kind !== 'resume') return { success: false, error: 'kind inválido' }
  const profileId = String(req.body?.profileId ?? 'default')
  if (!/^[a-zA-Z0-9_-]{1,40}$/.test(profileId)) return { success: false, error: 'profileId inválido' }
  
  
  const cwd = req.body?.cwd ? `cd ${shq(req.body.cwd)} && ` : ''
  const args = kind === 'resume' ? ` ${GEMINI.resumeArgs('latest').join(' ')}` : ''
  pending.push({ profileId, label: kind === 'resume' ? 'Gemini — última sessão' : 'Nova sessão Gemini',
    initCommand: `${cwd}${GEMINI.bin}${args}`, ts: Date.now() })
  return { success: true }
}

export async function pendingGeminiSessions() {
  /**
   * @register_router gemini-sessions/pending
   * @method GET
   * @description Consumido pelo Terminal: drena os comandos enfileirados.
   */
  return { success: true, opens: pending.splice(0, pending.length) }
}
