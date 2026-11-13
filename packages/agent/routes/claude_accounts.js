import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'





















import { readFileSync, existsSync } from 'fs'
import { join, dirname, resolve, isAbsolute } from 'path'
import { fileURLToPath } from 'url'
import { homedir } from 'os'
import { clearConfigCache } from '../utils/config.js'
import { mergeWithTerminalAccounts } from '../llm/terminal_accounts.js'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const CONFIG_FILE = join(PKG_DIR, 'agent.config.json')

const POOL_NAME = 'claude-engineer'
const ACCOUNT_NAME_RE = /^[a-z0-9_-]+$/i



function loadConfig() {
  return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
}

function saveConfig(config) {
  persistAgentConfig(config)
  clearConfigCache() 
}

/** Acha (ou cria, se create=true) o pool claude-cli gerenciado por esta tela. */
function findPool(config, { create = false } = {}) {
  if (!config.llm) config.llm = {}
  if (!Array.isArray(config.llm.pools)) config.llm.pools = []

  let pool = config.llm.pools.find(p => p.name === POOL_NAME)
    ?? config.llm.pools.find(p => p.provider === 'claude-cli')

  if (!pool && create) {
    pool = {
      name: POOL_NAME,
      provider: 'claude-cli',
      model: 'sonnet',
      enabled: false, 
      cli: { mcp: true, timeout_ms: null, accounts: [] },
      _comment: 'Gerenciado pela tela Claude Accounts (packages/claude/views). Login manual: CLAUDE_CONFIG_DIR=<dir> claude auth login',
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

/**
 * Checa se a conta já tem login feito olhando o config_dir. O Claude Code em
 * Linux headless grava as credenciais OAuth em <config_dir>/.credentials.json
 * — checagem read-only, sem nunca ler o CONTEÚDO do arquivo (só existência),
 * e sem invocar o binário.
 */
function accountStatus(configDir) {
  const dir = expandHome(configDir)
  if (!dir || !existsSync(dir)) return 'dir_missing'
  if (existsSync(join(dir, '.credentials.json'))) return 'logged_in'
  return 'pending_login'
}

function loginCommand(configDir) {
  return `CLAUDE_CONFIG_DIR=${expandHome(configDir)} claude auth login`
}

function serializeState(config) {
  const pool = findPool(config)
  
  
  
  const accounts = mergeWithTerminalAccounts(pool?.cli?.accounts ?? []).map(a => ({
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
    model: pool?.model ?? 'sonnet',
    accounts,
  }
}



export async function listClaudeAccounts(req, res) {
  /**
   * @register_router claude-accounts
   * @method GET
   */
  try {
    return serializeState(loadConfig())
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function addClaudeAccount(req, res) {
  /**
   * @register_router claude-accounts
   * @method POST
   */
  const { name, config_dir } = req.body ?? {}
  if (!name || !ACCOUNT_NAME_RE.test(name)) {
    return { success: false, error: 'name é obrigatório (letras/números/hífen/underscore, sem espaços)' }
  }

  try {
    const config = loadConfig()
    const pool = findPool(config, { create: true })

    if (pool.cli.accounts.some(a => a.name === name)) {
      return { success: false, error: `Conta "${name}" já existe.` }
    }

    const dir = expandHome(config_dir?.trim() || join(homedir(), `.claude-${name}`))
    if (!isAbsolute(dir)) return { success: false, error: 'config_dir precisa ser um caminho absoluto (ou começar com ~/)' }
    
    if (resolve(dir) === '/' || resolve(dir).startsWith('/etc') || resolve(dir).startsWith('/usr')) {
      return { success: false, error: `config_dir suspeito: ${dir}` }
    }

    pool.cli.accounts.push({ name, config_dir: dir })
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function removeClaudeAccount(req, res) {
  /**
   * @register_router claude-accounts/:name
   * @method DELETE
   */
  const { name } = req.params ?? {}
  try {
    const config = loadConfig()
    const pool = findPool(config)
    if (!pool) return { success: false, error: 'Pool claude-cli não existe.' }

    const before = pool.cli.accounts.length
    pool.cli.accounts = pool.cli.accounts.filter(a => a.name !== name)
    if (pool.cli.accounts.length === before) {
      return { success: false, error: `Conta "${name}" não encontrada.` }
    }
    
    if (!pool.cli.accounts.length) pool.enabled = false
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function togglePool(req, res) {
  /**
   * @register_router claude-accounts/pool
   * @method PATCH
   */
  const { enabled } = req.body ?? {}
  try {
    const config = loadConfig()
    const pool = findPool(config, { create: true })

    if (enabled) {
      const ready = mergeWithTerminalAccounts(pool.cli.accounts).filter(a => accountStatus(a.config_dir) === 'logged_in')
      if (!ready.length) {
        return { success: false, error: 'Nenhuma conta com login feito — rode o comando do tutorial no terminal primeiro (ou faça login em um perfil do Terminal).' }
      }
    }
    pool.enabled = !!enabled
    saveConfig(config)
    return serializeState(config)
  } catch (e) {
    return { success: false, error: e.message }
  }
}
