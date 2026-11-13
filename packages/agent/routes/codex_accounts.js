import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'


import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { clearConfigCache } from '../utils/config.js'
import { mergeWithTerminalCodexAccounts } from '../llm/terminal_accounts.js'
import { buildSlots } from '../llm/llm_keys.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')
const POOL_NAME = 'codex-engineer'
const NAME_RE = /^[a-z0-9_-]+$/i

const load = () => normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
function save(config) { persistAgentConfig(config); clearConfigCache() }
function expandHome(p) { return p === '~' ? homedir() : p?.startsWith('~/') ? join(homedir(), p.slice(2)) : p }
function status(dir) { return existsSync(join(expandHome(dir), 'auth.json')) ? 'logged_in' : 'pending_login' }
function loginCommand(dir) { return `CODEX_HOME=${expandHome(dir)} codex login` }

function poolFor(config, create = false) {
  config.llm ??= {}; config.llm.pools ??= []
  let pool = config.llm.pools.find(p => p.name === POOL_NAME) ?? config.llm.pools.find(p => p.provider === 'codex-cli')
  if (!pool && create) {
    pool = { name: POOL_NAME, provider: 'codex-cli', model: null, enabled: false,
      cli: { timeout_ms: null, skip_permissions: false, accounts: [] },
      _comment: 'Gerenciado pelo app Codex. Login manual: abra um perfil do Terminal e rode codex login.' }
    config.llm.pools.push(pool)
  }
  if (pool) { pool.cli ??= {}; pool.cli.accounts ??= [] }
  return pool
}

function state(config) {
  const pool = poolFor(config)
  const disabledAccounts = new Set(Array.isArray(pool?.cli?.disabled_accounts) ? pool.cli.disabled_accounts : [])
  const accounts = mergeWithTerminalCodexAccounts(pool?.cli?.accounts ?? []).map(a => ({
    name: a.name, config_dir: a.config_dir, source: a.source ?? 'manual', status: status(a.config_dir), login_command: loginCommand(a.config_dir),
    enabled: !disabledAccounts.has(a.name),
  }))
  
  
  
  const fallbackProviders = [...new Set(buildSlots(config)
    .filter(slot => slot.provider !== 'codex-cli')
    .map(slot => slot.provider))]
  return { success: true, pool_enabled: !!pool?.enabled, model: pool?.model ?? null,
    execution_mode: pool?.cli?.execution_mode ?? 'runtime-controlled', accounts,
    fallback_providers: fallbackProviders }
}

export async function listCodexAccounts() {
  /**
   * @register_router codex-accounts
   * @method GET
   */
  try { return state(load()) } catch (e) { return { success: false, error: e.message } }
}

export async function addCodexAccount(req) {
  /**
   * @register_router codex-accounts
   * @method POST
   */
  const { name, config_dir } = req.body ?? {}
  if (!name || !NAME_RE.test(name)) return { success: false, error: 'name inválido' }
  try {
    const config = load(), pool = poolFor(config, true)
    if (pool.cli.accounts.some(a => a.name === name)) return { success: false, error: 'Conta já registrada.' }
    const dir = expandHome(config_dir?.trim() || join(homedir(), `.codex-${name}`))
    if (!isAbsolute(dir) || resolve(dir) === '/' || resolve(dir).startsWith('/etc') || resolve(dir).startsWith('/usr')) return { success: false, error: 'config_dir inválido.' }
    pool.cli.accounts.push({ name, config_dir: dir }); save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function removeCodexAccount(req) {
  /**
   * @register_router codex-accounts/:name
   * @method DELETE
   */
  try {
    const config = load(), pool = poolFor(config)
    if (!pool) return { success: false, error: 'Pool codex-cli não existe.' }
    const before = pool.cli.accounts.length; pool.cli.accounts = pool.cli.accounts.filter(a => a.name !== req.params?.name)
    if (before === pool.cli.accounts.length) return { success: false, error: 'Conta não encontrada.' }
    pool.cli.disabled_accounts = (pool.cli.disabled_accounts ?? []).filter(name => name !== req.params?.name)
    if (!pool.cli.accounts.length) pool.enabled = false
    save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function toggleCodexAccount(req) {
  /**
   * @register_router codex-accounts/:name/status
   * @method PATCH
   */
  try {
    const config = load(), pool = poolFor(config, true)
    const name = req.params?.name
    const account = mergeWithTerminalCodexAccounts(pool.cli.accounts).find(item => item.name === name)
    if (!account) return { success: false, error: 'Perfil não encontrado.' }

    const disabled = new Set(Array.isArray(pool.cli.disabled_accounts) ? pool.cli.disabled_accounts : [])
    if (req.body?.enabled === false) disabled.add(name)
    else disabled.delete(name)
    pool.cli.disabled_accounts = [...disabled]
    save(config)
    return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function toggleCodexPool(req) {
  /**
   * @register_router codex-accounts/pool
   * @method PATCH
   */
  try {
    const config = load(), pool = poolFor(config, true)
    if (req.body?.enabled && !mergeWithTerminalCodexAccounts(pool.cli.accounts).some(a => status(a.config_dir) === 'logged_in')) return { success: false, error: 'Faça login em um perfil do Terminal antes de habilitar o provider.' }
    pool.enabled = !!req.body?.enabled; save(config); return state(config)
  } catch (e) { return { success: false, error: e.message } }
}

export async function setCodexExecutionMode(req) {
  /**
   * @register_router codex-accounts/execution-mode
   * @method PATCH
   */
  const executionMode = req.body?.execution_mode
  if (!['runtime-controlled', 'codex-native'].includes(executionMode)) {
    return { success: false, error: 'execution_mode inválido.' }
  }
  try {
    const config = load(), pool = poolFor(config, true)
    pool.cli.execution_mode = executionMode
    save(config)
    return state(config)
  } catch (e) { return { success: false, error: e.message } }
}
