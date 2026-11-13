import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'



import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { clearConfigCache } from '../utils/config.js'
import { mergeWithTerminalAntigravityAccounts } from '../llm/terminal_accounts.js'
import { ANTIGRAVITY, antigravityLoginCommand } from '../llm/antigravity_cli.js'
import { buildSlots } from '../llm/llm_keys.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')
const POOL_NAME = ANTIGRAVITY.pool
const NAME_RE = /^[a-z0-9_-]+$/i

const load = () => normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
function save(config) { persistAgentConfig(config); clearConfigCache() }
function expandHome(p) { return p === '~' ? homedir() : p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p }
function status(dir) { return existsSync(join(expandHome(dir), ANTIGRAVITY.credentialFile)) ? 'logged_in' : 'pending_login' }

function poolFor(config, create = false) {
  config.llm ??= {}; config.llm.pools ??= []
  let pool = config.llm.pools.find(p => p.name === POOL_NAME) ?? config.llm.pools.find(p => p.provider === ANTIGRAVITY.provider)
  if (!pool && create) {
    pool = { name: POOL_NAME, provider: ANTIGRAVITY.provider, model: null, enabled: false,
      cli: { timeout_ms: null, accounts: [] },
      _comment: `Gerenciado pelo app Antigravity. Login manual: abra um perfil do Terminal e rode ${ANTIGRAVITY.bin} ${ANTIGRAVITY.loginArgs.join(' ')}.` }
    config.llm.pools.push(pool)
  }
  if (pool) { pool.cli ??= {}; pool.cli.accounts ??= [] }
  return pool
}

function state(config) {
  const pool = poolFor(config)
  const accounts = mergeWithTerminalAntigravityAccounts(pool?.cli?.accounts ?? []).map(a => ({
    name: a.name, config_dir: a.config_dir, source: a.source ?? 'manual',
    status: status(a.config_dir), login_command: antigravityLoginCommand(expandHome(a.config_dir)),
  }))
  
  
  const fallbackProviders = [...new Set(buildSlots(config)
    .filter(slot => slot.provider !== ANTIGRAVITY.provider)
    .map(slot => slot.provider))]
  return { success: true, pool_enabled: !!pool?.enabled, model: pool?.model ?? null, accounts,
    cli_binary: ANTIGRAVITY.bin,
    fallback_providers: fallbackProviders }
}

export async function listAntigravityAccounts() {
  /**
   * @register_router antigravity-accounts
   * @method GET
   * @description Contas do Antigravity CLI (perfis do Terminal + manuais) e estado do pool.
   */
  try { return state(load()) } catch (e) { return { success: false, error: e.message } }
}

export async function addAntigravityAccount(req) {
  /**
   * @register_router antigravity-accounts
   * @method POST
   * @description Registra uma conta manual. Body: { name, config_dir? }.
   */
  const { name, config_dir } = req.body ?? {}
  if (!name || !NAME_RE.test(name)) return { success: false, error: 'name inválido' }
  try {
    const config = load(), pool = poolFor(config, true)
    if (pool.cli.accounts.some(a => a.name === name)) return { success: false, error: 'Conta já registrada.' }
    const dir = expandHome(config_dir?.trim() || join(homedir(), `${ANTIGRAVITY.homeDirName}-${name}`))
    if (!isAbsolute(dir) || resolve(dir) === '/' || resolve(dir).startsWith('/etc') || resolve(dir).startsWith('/usr')) return { success: false, error: 'config_dir inválido.' }
    pool.cli.accounts.push({ name, config_dir: dir }); save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function removeAntigravityAccount(req) {
  /**
   * @register_router antigravity-accounts/:name
   * @method DELETE
   * @description Remove uma conta manual (perfis do Terminal não são removíveis daqui).
   */
  try {
    const config = load(), pool = poolFor(config)
    if (!pool) return { success: false, error: `Pool ${ANTIGRAVITY.provider} não existe.` }
    const before = pool.cli.accounts.length
    pool.cli.accounts = pool.cli.accounts.filter(a => a.name !== req.params?.name)
    if (before === pool.cli.accounts.length) return { success: false, error: 'Conta não encontrada.' }
    if (!pool.cli.accounts.length) pool.enabled = false
    save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function toggleAntigravityPool(req) {
  /**
   * @register_router antigravity-accounts/pool
   * @method PATCH
   * @description Liga/desliga o pool antigravity-cli. Body: { enabled: boolean }.
   */
  try {
    const config = load(), pool = poolFor(config, true)
    if (req.body?.enabled && !mergeWithTerminalAntigravityAccounts(pool.cli.accounts).some(a => status(a.config_dir) === 'logged_in')) {
      return { success: false, error: 'Faça login em um perfil do Terminal antes de habilitar o provider.' }
    }
    pool.enabled = !!req.body?.enabled; save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}
