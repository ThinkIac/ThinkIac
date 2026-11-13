import { createMcpHttpClient } from '../agent/llm/mcp_http_client.js'












import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { mergeWithTerminalAccounts, mergeWithTerminalCodexAccounts, mergeWithTerminalOpencodeAccounts } from '../agent/llm/terminal_accounts.js'

const PKG_DIR       = join(dirname(fileURLToPath(import.meta.url)), '..')
const AGENT_DIR    = join(PKG_DIR, 'agent')
const AGENT_CONFIG = join(AGENT_DIR, 'agent.config.json')
const MCP_SERVER    = join(AGENT_DIR, 'llm', 'mcp_server.js')
const MCP_CONFIG    = join(AGENT_DIR, 'memory', 'mcp-config.json')

/** Mesmo arquivo que agent/llm/llm_keys.js (ensureMcpConfig) gera e reusa
 * pro provider claude-cli — mantém uma fonte só de mcp-config.json. */
function ensureMcpConfig() {
  const dir = dirname(MCP_CONFIG)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const desired = {
    mcpServers: {
      'thinkiac-runtime': { command: 'node', args: [MCP_SERVER] },
    },
  }
  const serialized = JSON.stringify(desired, null, 2)
  if (!existsSync(MCP_CONFIG) || readFileSync(MCP_CONFIG, 'utf8') !== serialized) {
    writeFileSync(MCP_CONFIG, serialized, 'utf8')
  }
  return MCP_CONFIG
}

function loadManualAccounts() {
  try {
    const config = JSON.parse(readFileSync(AGENT_CONFIG, 'utf8'))
    const pool = (config.llm?.pools ?? []).find(p => p.provider === 'claude-cli')
    return pool?.cli?.accounts ?? []
  } catch {
    return []
  }
}

function isLoggedIn(configDir) {
  return !!configDir && existsSync(join(configDir, '.credentials.json'))
}

/** Contas manuais (agent.config.json) + auto-descobertas nos perfis do Terminal. */
function listAvailableAccounts() {
  return mergeWithTerminalAccounts(loadManualAccounts())
}

/** A conta do $HOME atual — se este `think` já roda dentro do $HOME isolado de um
 * perfil do Terminal (ver packages/terminal/index.js: cada perfil sobe o shell com
 * HOME=<perfil>), e esse perfil já tem login, é a conta que o binário `claude` usaria
 * de qualquer forma, sem precisar mexer em nenhuma variável de ambiente. */
function currentHomeAccount() {
  const home = process.env.HOME
  if (!home) return null
  const configDir = join(home, '.claude')
  return isLoggedIn(configDir) ? { name: `home:${home}`, config_dir: configDir, source: 'current-shell' } : null
}

/**
 * Aplica a conta escolhida no env do processo filho. Cada "source" foi logada
 * de um jeito diferente, então precisa ser aplicada do mesmo jeito:
 *   - current-shell: já é o ambiente atual — não mexe em nada.
 *   - terminal-profile: o login rolou com HOME=<perfil> puro (sem
 *     CLAUDE_CONFIG_DIR). O Claude Code guarda o estado de "pasta confiada" /
 *     onboarding num <perfil>/.claude.json IRMÃO de <perfil>/.claude — setar
 *     CLAUDE_CONFIG_DIR=<perfil>/.claude faz o Claude Code procurar esse
 *     companheiro em <perfil>/.claude/.claude.json (que não existe) e tratar a
 *     pasta como nunca confiada, pedindo pra passar por tudo de novo. Por isso
 *     aqui troca HOME inteiro, igual o próprio Terminal faz ao abrir o shell.
 *   - manual (agent.config.json): criada originalmente via
 *     `CLAUDE_CONFIG_DIR=<dir> claude auth login`, então tudo (credenciais +
 *     estado) já vive dentro de config_dir — CLAUDE_CONFIG_DIR é o jeito certo.
 */
function applyAccountEnv(env, account) {
  if (!account || account.source === 'current-shell') return
  if (account.source === 'terminal-profile') {
    env.HOME = account.home
    delete env.CLAUDE_CONFIG_DIR
    for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key]
    return
  }
  env.CLAUDE_CONFIG_DIR = account.config_dir
}

/**
 * Resolve qual conta usar, por ordem de prioridade:
 *   1. --account explícito (precisa existir e já ter login)
 *   2. CLAUDE_CONFIG_DIR já setado no ambiente — não mexe, é escolha de fora
 *   3. o próprio $HOME do terminal atual, se já logado — é o perfil que a
 *      pessoa abriu, não uma conta qualquer de uma lista global
 *   4. primeira conta logada entre as manuais + descobertas nos perfis do Terminal
 */
function resolveAccount(requestedName) {
  if (requestedName) {
    const accounts = listAvailableAccounts()
    const found = accounts.find(a => a.name === requestedName)
    if (!found) {
      const names = accounts.map(a => a.name).join(', ') || 'nenhuma'
      throw new Error(`Conta "${requestedName}" não encontrada. Disponíveis: ${names}`)
    }
    if (!isLoggedIn(found.config_dir)) {
      const hint = found.source === 'terminal-profile'
        ? `HOME=${found.home} claude auth login (ou abra um terminal nesse perfil pela UI e rode "claude auth login")`
        : `CLAUDE_CONFIG_DIR=${found.config_dir} claude auth login`
      throw new Error(`Conta "${requestedName}" ainda não tem login (${found.config_dir}). Rode: ${hint}`)
    }
    return { account: found, note: `conta "${found.name}" (${found.config_dir})` }
  }

  if (process.env.CLAUDE_CONFIG_DIR) {
    return { account: null, note: `CLAUDE_CONFIG_DIR já definido no ambiente (${process.env.CLAUDE_CONFIG_DIR})` }
  }

  const current = currentHomeAccount()
  if (current) return { account: current, note: `perfil já logado neste terminal (${current.config_dir})` }

  const fallback = listAvailableAccounts().find(a => isLoggedIn(a.config_dir))
  if (fallback) return { account: fallback, note: `conta "${fallback.name}" (${fallback.config_dir})` }

  return { account: null, note: null }
}

/**
 * Resolve a conta, monta o --mcp-config e sobe `claude <subcommand...> --mcp-config
 * <path> <extra>` com stdio herdado (toma o terminal atual). Compartilhado entre
 * `claude` (sessão interativa normal) e `claude:agents` (gerenciador de background
 * agents) — os dois aceitam --mcp-config e se beneficiam da mesma conta já logada.
 */
async function runClaude(subcommand, { account: accountName, claude_args: claudeArgsRaw, dir } = {}) {
  const { account, note } = resolveAccount(accountName)
  if (note) {
    console.error(`ThinkIac Agent MCP — ${note}`)
  } else {
    console.error(
      'Nenhuma conta Claude logada (nem neste terminal, nem em outro perfil, nem na tela Claude Accounts) — ' +
      'abrindo com o login padrão de $HOME. Pra usar uma conta isolada: CLAUDE_CONFIG_DIR=<dir> claude auth login'
    )
  }

  const mcpConfigPath = ensureMcpConfig()
  const extraArgs = typeof claudeArgsRaw === 'string' && claudeArgsRaw.trim() ? claudeArgsRaw.trim().split(/\s+/) : []
  const claudeArgs = [...subcommand, '--mcp-config', mcpConfigPath, ...extraArgs]

  const env = { ...process.env }
  applyAccountEnv(env, account)

  
  
  
  
  
  const spawnCwd = typeof dir === 'string' && dir.trim() ? dir.trim() : undefined

  await new Promise((resolve, reject) => {
    const child = spawn('claude', claudeArgs, { stdio: 'inherit', env, cwd: spawnCwd })
    child.on('error', reject)
    child.on('exit', code => {
      if (code) process.exitCode = code
      resolve()
    })
  })
}

export async function claude(args = {}) {
  /**
   * @register_command claude
   * @description Abre o Claude Code CLI (binário `claude`) com os MCPs do ThinkIac Agent e uma conta já logada (perfil do Terminal ou conta manual). Uso: think agent:claude [--account nome] [--dir <cwd>] [--claude_args "--continue"]
   * @param {string?} account - Nome da conta a usar (ex.: "terminal:default"). Sem isso, usa a primeira conta logada encontrada.
   * @param {string?} dir - Diretório onde o `claude` deve rodar. Sem isso, roda no cwd atual. Use pra retomar (`--resume`) no projeto original enquanto o `think` é chamado de outro lugar.
   * @param {string?} claude_args - Argumentos extra pra repassar direto pro binário `claude`, como uma única string (ex.: "--continue", "--resume <uuid>"). Flags dentro dessa string colidem com o parser do `think` — prefira `--params '{"claude_args":"--continue"}'`.
   */
  await runClaude([], args)
}

export async function claudeAgents(args = {}) {
  /**
   * @register_command claude:agents
   * @description Abre o gerenciador de background agents do Claude Code (`claude agents`) com os MCPs do ThinkIac Agent e uma conta já logada. Uso: think agent:claude:agents [--account nome] [--dir <cwd>] [--claude_args "--json"]
   * @param {string?} account - Nome da conta a usar (ex.: "terminal:default"). Sem isso, usa a primeira conta logada encontrada.
   * @param {string?} dir - Diretório onde o `claude agents` deve rodar. Sem isso, roda no cwd atual.
   * @param {string?} claude_args - Argumentos extra pra repassar direto pro `claude agents` (ex.: "--json", "--all").
   */
  await runClaude(['agents'], args)
}

















function loadManualCodexAccounts() {
  try {
    const config = JSON.parse(readFileSync(AGENT_CONFIG, 'utf8'))
    const pool = (config.llm?.pools ?? []).find(p => p.provider === 'codex-cli')
    return pool?.cli?.accounts ?? []
  } catch {
    return []
  }
}

/** Codex está logado quando existe <config_dir>/auth.json (só existência, nunca lê o conteúdo). */
function isCodexLoggedIn(configDir) {
  return !!configDir && existsSync(join(configDir, 'auth.json'))
}

/** Contas manuais (pool codex-cli) + auto-descobertas nos perfis do Terminal. */
function listAvailableCodexAccounts() {
  return mergeWithTerminalCodexAccounts(loadManualCodexAccounts())
}

/** A conta Codex do $HOME atual, se este `think` já roda dentro do HOME de um
 * perfil do Terminal e esse perfil já rodou `codex login`. */
function currentHomeCodexAccount() {
  const home = process.env.HOME
  if (!home) return null
  const configDir = join(home, '.codex')
  return isCodexLoggedIn(configDir) ? { name: `home:${home}`, config_dir: configDir, home, source: 'current-shell' } : null
}

/**
 * Aplica a conta Codex escolhida no env do filho (mesma lógica de applyAccountEnv
 * do Claude, adaptada pro Codex):
 *   - current-shell: já é o ambiente atual — não mexe.
 *   - terminal-profile: o `codex login` rodou com HOME=<perfil>, então o estado
 *     vive em <perfil>/.codex — troca HOME inteiro e limpa CODEX_HOME pra não
 *     apontar pra outro lugar.
 *   - manual: config_dir É um CODEX_HOME dedicado — aponta CODEX_HOME pra ele.
 */
function applyCodexAccountEnv(env, account) {
  if (!account || account.source === 'current-shell') return
  if (account.source === 'terminal-profile') {
    env.HOME = account.home
    delete env.CODEX_HOME
    for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key]
    return
  }
  env.CODEX_HOME = account.config_dir
}

/** Resolve qual conta Codex usar — mesma ordem de prioridade do Claude. */
function resolveCodexAccount(requestedName) {
  if (requestedName) {
    const accounts = listAvailableCodexAccounts()
    const found = accounts.find(a => a.name === requestedName)
    if (!found) {
      const names = accounts.map(a => a.name).join(', ') || 'nenhuma'
      throw new Error(`Codex account "${requestedName}" not found. Available: ${names}`)
    }
    if (!isCodexLoggedIn(found.config_dir)) {
      const hint = found.source === 'terminal-profile'
        ? `HOME=${found.home} codex login (or open a terminal in that profile and run "codex login")`
        : `CODEX_HOME=${found.config_dir} codex login`
      throw new Error(`Codex account "${requestedName}" is not logged in yet (${found.config_dir}). Run: ${hint}`)
    }
    return { account: found, note: `account "${found.name}" (${found.config_dir})` }
  }

  if (process.env.CODEX_HOME && isCodexLoggedIn(process.env.CODEX_HOME)) {
    return { account: null, note: `CODEX_HOME already set in the environment (${process.env.CODEX_HOME})` }
  }

  const current = currentHomeCodexAccount()
  if (current) return { account: current, note: `profile already logged in on this terminal (${current.config_dir})` }

  const fallback = listAvailableCodexAccounts().find(a => isCodexLoggedIn(a.config_dir))
  if (fallback) return { account: fallback, note: `account "${fallback.name}" (${fallback.config_dir})` }

  return { account: null, note: null }
}

/** Overrides `-c` que plugam o MCP server do runtime no Codex (equivale ao
 * --mcp-config do Claude). O valor é parseado como TOML pelo Codex — daí as
 * aspas no command e o array TOML no args. */
const tomlString = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

/** Sessão herdada do ambiente, se houver — ver o `env` em codexMcpArgs(). */
function codexSessionEnv() {
  const env = {}
  for (const key of ['AGENT_SESSION_ID', 'AGENT_SESSION_TOKEN', 'AGENT_BASE_URL', 'THINKIAC_MCP_TOKEN', 'AGENT_MCP_HTTP_URL']) {
    if (process.env[key]) env[key] = process.env[key]
  }
  return env
}

function codexMcpArgs() {
  const sessionEnv = Object.entries(codexSessionEnv())
  return [
    '-c', `mcp_servers.thinkiac-runtime.command="node"`,
    '-c', `mcp_servers.thinkiac-runtime.args=["${MCP_SERVER.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"]`,
    
    
    
    ...(sessionEnv.length
      ? ['-c', `mcp_servers.thinkiac-runtime.env={${sessionEnv.map(([k, v]) => `${k}=${tomlString(v)}`).join(',')}}`]
      : []),
    
    
    
    
    '-c', `mcp_servers.thinkiac-runtime.default_tools_approval_mode="approve"`,
  ]
}

async function runCodex(subcommand, { account: accountName, codex_args: codexArgsRaw, dir } = {}) {
  const { account, note } = resolveCodexAccount(accountName)
  if (note) {
    console.error(`ThinkIac Agent MCP — ${note}`)
  } else {
    console.error(
      'No Codex account is logged in (not in this terminal, not in another profile, not in the Codex app) — ' +
      'opening with the default $HOME login. To use an isolated account: open a Terminal profile and run "codex login".'
    )
  }

  const extraArgs = typeof codexArgsRaw === 'string' && codexArgsRaw.trim() ? codexArgsRaw.trim().split(/\s+/) : []
  const codexArgs = [...subcommand, ...codexMcpArgs(), ...extraArgs]

  const env = { ...process.env }
  applyCodexAccountEnv(env, account)

  const spawnCwd = typeof dir === 'string' && dir.trim() ? dir.trim() : undefined

  await new Promise((resolve, reject) => {
    const child = spawn('codex', codexArgs, { stdio: 'inherit', env, cwd: spawnCwd })
    child.on('error', reject)
    child.on('exit', code => {
      if (code) process.exitCode = code
      resolve()
    })
  })
}

export async function codex(args = {}) {
  /**
   * @register_command codex
   * @description Abre o Codex CLI (binário `codex`, TUI interativo) com os MCPs do ThinkIac Agent e uma conta já logada (perfil do Terminal ou conta manual). Uso: think agent:codex [--account nome] [--dir <cwd>] [--codex_args "resume --last"]
   * @param {string?} account - Nome da conta a usar (ex.: "terminal:secodary"). Sem isso, usa a primeira conta Codex logada encontrada.
   * @param {string?} dir - Diretório onde o `codex` deve rodar. Sem isso, roda no cwd atual.
   * @param {string?} codex_args - Argumentos extra pra repassar direto pro binário `codex`, como uma única string (ex.: "resume --last"). Prefira `--params '{"codex_args":"resume --last"}'` pra evitar colisão de flags com o parser do `think`.
   */
  await runCodex([], args)
}











function loadManualOpencodeAccounts() {
  try {
    const config = JSON.parse(readFileSync(AGENT_CONFIG, 'utf8'))
    const pool = (config.llm?.pools ?? []).find(p => p.provider === 'opencode-cli')
    return pool?.cli?.accounts ?? []
  } catch {
    return []
  }
}

function isOpencodeLoggedIn(configDir) {
  return !!configDir && existsSync(configDir)
}

function listAvailableOpencodeAccounts() {
  return mergeWithTerminalOpencodeAccounts(loadManualOpencodeAccounts())
}

function currentHomeOpencodeAccount() {
  const home = process.env.HOME
  if (!home) return null
  const configDir = join(home, '.local', 'share', 'opencode', 'auth.json')
  return isOpencodeLoggedIn(configDir) ? { name: `home:${home}`, config_dir: configDir, home, source: 'current-shell' } : null
}

function applyOpencodeAccountEnv(env, account) {
  if (!account || account.source === 'current-shell') return
  if (account.source === 'terminal-profile') {
    env.HOME = account.home
    for (const key of Object.keys(env)) if (key.startsWith('XDG_')) delete env[key]
    return
  }
  env.HOME = account.home ?? dirname(account.config_dir)
}

function resolveOpencodeAccount(requestedName) {
  if (requestedName) {
    const accounts = listAvailableOpencodeAccounts()
    const found = accounts.find(a => a.name === requestedName)
    if (!found) {
      const names = accounts.map(a => a.name).join(', ') || 'none'
      throw new Error(`OpenCode account "${requestedName}" not found. Available: ${names}`)
    }
    if (!isOpencodeLoggedIn(found.config_dir)) {
      throw new Error(`OpenCode account "${requestedName}" is not logged in yet. Run: HOME=${found.home} opencode providers login`)
    }
    return { account: found, note: `account "${found.name}" (${found.home})` }
  }

  const current = currentHomeOpencodeAccount()
  if (current) return { account: current, note: `profile already logged in on this terminal (${current.home})` }

  const fallback = listAvailableOpencodeAccounts().find(a => isOpencodeLoggedIn(a.config_dir))
  if (fallback) return { account: fallback, note: `account "${fallback.name}" (${fallback.home})` }

  return { account: null, note: null }
}

async function runOpencode(subcommand, { account: accountName, opencode_args: opencodeArgsRaw, dir } = {}) {
  const { account, note } = resolveOpencodeAccount(accountName)
  if (note) {
    console.error(`ThinkIac Agent MCP — ${note}`)
  } else {
    console.error(
      'No OpenCode account is logged in (not in this terminal, not in another profile) — ' +
      'opening with the default $HOME login. To use an isolated account: open a Terminal profile and run "opencode providers login".'
    )
  }

  const extraArgs = typeof opencodeArgsRaw === 'string' && opencodeArgsRaw.trim() ? opencodeArgsRaw.trim().split(/\s+/) : []
  const opencodeArgs = [...subcommand, ...extraArgs]

  const env = { ...process.env }
  applyOpencodeAccountEnv(env, account)

  const spawnCwd = typeof dir === 'string' && dir.trim() ? dir.trim() : undefined
  if (spawnCwd) env.OPENCODE_CWD = spawnCwd

  await new Promise((resolve, reject) => {
    const child = spawn('opencode', opencodeArgs, { stdio: 'inherit', env, cwd: spawnCwd })
    child.on('error', reject)
    child.on('exit', code => {
      if (code) process.exitCode = code
      resolve()
    })
  })
}

export async function opencode(args = {}) {
  /**
   * @register_command opencode
   * @description Abre o OpenCode CLI (binário `opencode`) com os MCPs do ThinkIac Agent e uma conta já logada (perfil do Terminal ou conta manual). Uso: think agent:opencode [--account nome] [--dir <cwd>] [--opencode_args "--auto"]
   * @param {string?} account - Nome da conta a usar (ex.: "terminal:default"). Sem isso, usa a primeira conta OpenCode logada encontrada.
   * @param {string?} dir - Diretório onde o `opencode` deve rodar. Sem isso, roda no cwd atual.
   * @param {string?} opencode_args - Argumentos extra pra repassar direto pro binário `opencode`, como uma única string (ex.: "--auto --model openai/gpt-4o").
   */
  await runOpencode([], args)
}

export async function toolsList(args = {}) {
  /**
   * @register_command tools:list
   * @description Lista as tools do runtime ThinkIac Agent disponíveis via MCP (mesmo catálogo usado pelo Claude Code em `think agent:claude`). Uso: think agent:tools:list
   */
  const tools = await createMcpHttpClient().listTools()
  for (const t of tools) {
    console.log(`${t.name}\t${t.description || ''}`)
  }
  return tools
}

export async function toolsCall(args = {}) {
  /**
   * @register_command tools:call
   * @description Chama uma tool do runtime ThinkIac Agent direto via CLI (sem abrir uma sessão inteira do Claude Code) e imprime o resultado. Uso: think agent:tools:call --name <tool> --args '{"...":"..."}'
   * @param {string} name - Nome exato da tool (ver `think agent:tools:list`).
   * @param {string?} args - Argumentos da tool, como JSON (ex.: '{"prompt":"oi"}'). Sem isso, chama sem argumentos.
   */
  const { name, args: rawArgs } = args
  if (!name) throw new Error('`--name <tool>` é obrigatório. Veja as tools disponíveis com: think agent:tools:list')

  let toolArgs = {}
  if (rawArgs) {
    try {
      toolArgs = JSON.parse(rawArgs)
    } catch (e) {
      throw new Error(`--args não é um JSON válido: ${e.message}`)
    }
  }

  const data = { result: await createMcpHttpClient().callTool(name, toolArgs) }

  console.log(typeof data.result === 'string' ? data.result : JSON.stringify(data.result, null, 2))
  return data.result
}
