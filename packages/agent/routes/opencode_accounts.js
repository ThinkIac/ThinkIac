import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'
import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { clearConfigCache } from '../utils/config.js'
import { mergeWithTerminalOpencodeAccounts } from '../llm/terminal_accounts.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')

const POOL_NAME = 'opencode-engineer'
const ACCOUNT_NAME_RE = /^[a-z0-9_-]+$/i

function loadConfig() {
  return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
}

function saveConfig(config) {
  persistAgentConfig(config)
  clearConfigCache()
}

function findPool(config, { create = false } = {}) {
  if (!config.llm) config.llm = {}
  if (!Array.isArray(config.llm.pools)) config.llm.pools = []

  let pool = config.llm.pools.find(p => p.name === POOL_NAME)
    ?? config.llm.pools.find(p => p.provider === 'opencode-cli')

  if (!pool && create) {
    pool = {
      name: POOL_NAME,
      provider: 'opencode-cli',
      model: null,
      enabled: false,
      cli: { mcp: true, timeout_ms: null, accounts: [] },
      _comment: 'Managed by OpenCode app (packages/opencode/views). Login manual: opencode providers login',
    }
    config.llm.pools.push(pool)
  }

  if (pool) {
    if (!pool.cli) pool.cli = { mcp: true, timeout_ms: null }
    if (!Array.isArray(pool.cli.accounts)) pool.cli.accounts = []
  }
  return pool ?? null
}

function expandHome(p) {
  if (!p) return p
  if (p === '~') return homedir()
  if (p.startsWith('~/')) return join(homedir(), p.slice(2))
  return p
}

function accountStatus(configDir) {
  const dir = expandHome(configDir)
  if (!dir) return 'dir_missing'
  if (dir.endsWith('auth.json')) {
    return existsSync(dir) ? 'logged_in' : 'dir_missing'
  }
  if (!existsSync(dir)) return 'dir_missing'
  return existsSync(join(dir, 'auth.json')) ? 'logged_in' : 'pending_login'
}

function loginCommand(configDir) {
  const dir = expandHome(configDir)
  let homeDir
  if (dir.endsWith('auth.json')) {
    homeDir = dirname(dirname(dirname(dir)))
  } else {
    homeDir = dirname(dir)
  }
  return `HOME=${homeDir} opencode providers login`
}

function serializeState(config) {
  const pool = findPool(config)
  const accounts = mergeWithTerminalOpencodeAccounts(pool?.cli?.accounts ?? []).map(a => ({
    name: a.name,
    config_dir: a.config_dir,
    status: accountStatus(a.config_dir),
    login_command: loginCommand(a.config_dir),
    source: a.source ?? 'manual',
  }))

  return {
    success: true,
    pool_enabled: pool?.enabled ?? false,
    pool_exists: !!pool,
    model: pool?.model ?? null,
    accounts,
  }
}

export async function listOpencodeAccounts(req, res) {
  /**
   * @register_router opencode-accounts
   * @method GET
   */
  try {
    return serializeState(loadConfig())
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function addOpencodeAccount(req, res) {
  /**
   * @register_router opencode-accounts
   * @method POST
   */
  const { name, config_dir } = req.body ?? {}
  if (!name || !ACCOUNT_NAME_RE.test(name)) {
    return { success: false, error: 'name is required (letters/numbers/hyphen/underscore, no spaces)' }
  }

  try {
    const config = loadConfig()
    const pool = findPool(config, { create: true })

    if (pool.cli.accounts.some(a => a.name === name)) {
      return { success: false, error: `Account "${name}" already exists.` }
    }

    const dir = expandHome(config_dir?.trim() || join(homedir(), `.opencode-${name}`))
    if (!isAbsolute(dir)) return { success: false, error: 'config_dir must be an absolute path (or start with ~/)' }
    if (resolve(dir) === '/' || resolve(dir).startsWith('/etc') || resolve(dir).startsWith('/usr')) {
      return { success: false, error: `Suspicious config_dir: ${dir}` }
    }

    pool.cli.accounts.push({ name, config_dir: dir })
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function removeOpencodeAccount(req, res) {
  /**
   * @register_router opencode-accounts/:name
   * @method DELETE
   */
  const { name } = req.params ?? {}
  try {
    const config = loadConfig()
    const pool = findPool(config)
    if (!pool) return { success: false, error: 'Pool opencode-cli does not exist.' }

    const before = pool.cli.accounts.length
    pool.cli.accounts = pool.cli.accounts.filter(a => a.name !== name)
    if (pool.cli.accounts.length === before) {
      return { success: false, error: `Account "${name}" not found.` }
    }
    if (!pool.cli.accounts.length) pool.enabled = false
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function toggleOpencodePool(req, res) {
  /**
   * @register_router opencode-accounts/pool
   * @method PATCH
   */
  const { enabled } = req.body ?? {}
  try {
    const config = loadConfig()
    const pool = findPool(config, { create: true })

    if (enabled) {
      const ready = mergeWithTerminalOpencodeAccounts(pool.cli.accounts).filter(a => accountStatus(a.config_dir) === 'logged_in')
      if (!ready.length) {
        return { success: false, error: 'No account with login done — run the login command in the terminal first (or log in from a Terminal profile).' }
      }
    }
    pool.enabled = !!enabled
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}