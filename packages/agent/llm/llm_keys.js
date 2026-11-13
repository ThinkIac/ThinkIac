import { resolveCodexPermissions, resolveCodexExecutionMode } from './codex_permissions.js'
import { normalizeConfig } from '../utils/config_store.js'

















































































































































































































import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { mergeWithTerminalAccounts, mergeWithTerminalCodexAccounts, mergeWithTerminalAntigravityAccounts, mergeWithTerminalGeminiAccounts, mergeWithTerminalOpencodeAccounts } from './terminal_accounts.js'
import { ANTIGRAVITY } from './antigravity_cli.js'
import { GEMINI } from './gemini_cli.js'

const PKG_DIR    = dirname(fileURLToPath(import.meta.url))
const STATE_FILE = join(PKG_DIR, '..', 'memory', 'slots_state.json')
const MAX_FAILURES = 3









const MCP_SERVER_FILE   = join(PKG_DIR, 'mcp_server.js')
const MCP_CONFIG_FILE   = join(PKG_DIR, '..', 'memory', 'mcp-config.json')




export function ensureMcpConfig() {
  const dir = dirname(MCP_CONFIG_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const desired = {
    mcpServers: {
      'thinkiac-runtime': { command: 'node', args: [MCP_SERVER_FILE] },
    },
  }
  
  const serialized = JSON.stringify(desired, null, 2)
  if (!existsSync(MCP_CONFIG_FILE) || readFileSync(MCP_CONFIG_FILE, 'utf8') !== serialized) {
    writeFileSync(MCP_CONFIG_FILE, serialized, 'utf8')
  }
  return MCP_CONFIG_FILE
}


































const tomlString = (value) => `"${String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

function codexMcpArgs(env = null) {
  const path = MCP_SERVER_FILE.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
  const args = [
    '-c', 'mcp_servers.thinkiac-runtime.command="node"',
    '-c', `mcp_servers.thinkiac-runtime.args=["${path}"]`,
    '-c', 'mcp_servers.thinkiac-runtime.default_tools_approval_mode="approve"',
  ]
  const entries = Object.entries(env ?? {}).filter(([, value]) => value != null && value !== '')
  if (entries.length) {
    const table = entries.map(([key, value]) => `${key}=${tomlString(value)}`).join(',')
    args.push('-c', `mcp_servers.thinkiac-runtime.env={${table}}`)
  }
  return args
}







const PERMISSION_HOOK_FILE     = join(PKG_DIR, 'permission_hook.mjs')
const PERMISSION_SETTINGS_FILE = join(PKG_DIR, '..', 'memory', 'permission-settings.json')








export function permGateActive(opts = {}) {
  const p = opts?.permissions
  return p === 'interactive' || p === 'auto' || p === true
}



export function resolvePermissionMode(opts = {}) {
  if (opts?.permission_policy) return String(opts.permission_policy)
  if (opts?.permissions === 'interactive') return 'interactive'
  if (opts?.permissions === 'allow' || opts?.permissions === 'off') return 'allow'
  return 'auto'
}

export function ensurePermissionSettings() {
  const dir = dirname(PERMISSION_SETTINGS_FILE)
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  const desired = {
    hooks: {
      PreToolUse: [
        {
          matcher: '*',
          hooks: [
            {
              type: 'command',
              command: `node ${PERMISSION_HOOK_FILE}`,
              
              
              
              timeout: 1800,
            },
          ],
        },
      ],
    },
  }
  const serialized = JSON.stringify(desired, null, 2)
  if (!existsSync(PERMISSION_SETTINGS_FILE) || readFileSync(PERMISSION_SETTINGS_FILE, 'utf8') !== serialized) {
    writeFileSync(PERMISSION_SETTINGS_FILE, serialized, 'utf8')
  }
  return PERMISSION_SETTINGS_FILE
}




const sanitizeFlag = (v) => String(v).replace(/[^a-zA-Z]/g, '')

let memoryIndex = null
const slotLeases = new Map()

/** In-process semaphore. A slot is never selected concurrently above its configured limit. */
export async function acquireSlotLease(slot, signal = null) {
  const limit = Math.max(1, Number(slot?.maxConcurrency) || 1)
  const state = slotLeases.get(slot.id) ?? { active: 0, queue: [] }
  slotLeases.set(slot.id, state)
  if (state.active >= limit) {
    await new Promise((resolve, reject) => {
      const waiter = { resolve, reject }
      state.queue.push(waiter)
      signal?.addEventListener('abort', () => {
        const index = state.queue.indexOf(waiter)
        if (index >= 0) state.queue.splice(index, 1)
        reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
      }, { once: true })
    })
  }
  state.active++
  let released = false
  return () => {
    if (released) return
    released = true
    state.active = Math.max(0, state.active - 1)
    state.queue.shift()?.resolve()
  }
}



const PROVIDERS = {
  openrouter: {
    chat:    (base) => `${base ?? 'https://openrouter.ai/api/v1'}/chat/completions`,
    embed:   (base) => `${base ?? 'https://openrouter.ai/api/v1'}/embeddings`,
    headers: (key)  => ({
      Authorization:  `Bearer ${key}`,
      'HTTP-Referer': 'https://github.com/johankit/agent',
      'X-Title':      'Agent',
    }),
    defaultModel:      'openai/gpt-4o-mini',
    defaultEmbedModel: 'openai/text-embedding-3-small',
  },

  openai: {
    chat:    (base) => `${base ?? 'https://api.openai.com/v1'}/chat/completions`,
    embed:   (base) => `${base ?? 'https://api.openai.com/v1'}/embeddings`,
    headers: (key)  => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'gpt-4o-mini',
    defaultEmbedModel: 'text-embedding-3-small',
  },

  
  
  
  
  
  
  
  
  
  
  ollama: {
    keyless: true,
    chat:    (base) => `${base ?? 'http://localhost:11434'}/v1/chat/completions`,
    embed:   (base) => `${base ?? 'http://localhost:11434'}/v1/embeddings`,
    headers: ()     => ({}),
    defaultModel:      'llama3',
    defaultEmbedModel: 'nomic-embed-text',
  },

  
  
  'thinkiac-edge': {
    keyless: true,
    chat:    (base) => `${base ?? 'http://127.0.0.1:5040'}/v1/chat/completions`,
    headers: ()     => ({}),
    defaultModel:   'local',
  },
  'thinkiac-mobile-cloud': {
    keyless: true,
    chat: () => 'hermes://mobile/chat',
    headers: () => ({}),
    defaultModel: 'local',
  },

  
  
  
  thinkiac: {
    chat:    (base) => `${base ?? 'https://thinkiac.cloud/thinkiac-provider/v1'}/chat/completions`,
    embed:   (base) => `${base ?? 'https://thinkiac.cloud/thinkiac-provider/v1'}/embeddings`,
    headers: (key)  => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'orbit',
    defaultEmbedModel: 'openai/text-embedding-3-small',
  },

  
  
  
  
  
  anthropic: {
    chat: (base) => `${base ?? 'https://api.anthropic.com/v1'}/messages`,
    headers: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    defaultModel: 'claude-opus-4-8',
    defaultEmbedModel: null,
  },

  
  
  
  
  
  
  
  
  
  
  
  
  
  maritaca: {
    chat: (base) => base ?? 'https://chat.maritaca.ai/api',
    headers: () => ({}),
    defaultModel: 'sabia-4-thinking',
    defaultEmbedModel: null,
  },

  
  
  
  
  
  
  
  

  groq: {
    chat:  (base) => `${base ?? 'https://api.groq.com/openai/v1'}/chat/completions`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'llama-3.3-70b-versatile',
    defaultEmbedModel: null,
  },

  cerebras: {
    chat:  (base) => `${base ?? 'https://api.cerebras.ai/v1'}/chat/completions`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'gpt-oss-120b',
    defaultEmbedModel: null,
  },

  
  
  
  
  
  google: {
    chat:  (base) => `${base ?? 'https://generativelanguage.googleapis.com/v1beta/openai'}/chat/completions`,
    embed: (base) => `${base ?? 'https://generativelanguage.googleapis.com/v1beta/openai'}/embeddings`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'gemma-4-31b-it',
    defaultEmbedModel: 'text-embedding-004',
  },

  nvidia: {
    chat:  (base) => `${base ?? 'https://integrate.api.nvidia.com/v1'}/chat/completions`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'meta/llama-3.3-70b-instruct',
    defaultEmbedModel: null,
  },

  mistral: {
    chat:  (base) => `${base ?? 'https://api.mistral.ai/v1'}/chat/completions`,
    embed: (base) => `${base ?? 'https://api.mistral.ai/v1'}/embeddings`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'mistral-small-latest',
    defaultEmbedModel: 'mistral-embed',
  },

  
  
  
  cloudflare: {
    chat:  (base) => `${base}/chat/completions`,
    headers: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      '@cf/meta/llama-3.3-70b-instruct-fp8-fast',
    defaultEmbedModel: null,
  },

  
  
  
  
  
  freellmapi: {
    chat:  (base) => `${base ?? 'http://localhost:3001/v1'}/chat/completions`,
    embed: (base) => `${base ?? 'http://localhost:3001/v1'}/embeddings`,
    headers: (key) => (key ? { Authorization: `Bearer ${key}` } : {}),
    defaultModel:      'auto',
    defaultEmbedModel: null,
  },

  
  
  
  
  
  
  
  
  
  

  
  
  
  deepseek: {
    chat:    (base) => `${base ?? 'https://api.deepseek.com'}/chat/completions`,
    embed:   (base) => `${base ?? 'https://api.deepseek.com'}/embeddings`,
    headers: (key)  => ({ Authorization: `Bearer ${key}` }),
    defaultModel:      'deepseek-v4-flash',
    defaultEmbedModel: null,
  },

  

  
  
  

  'claude-cli': {
    mode: 'cli',
    defaultModel:      null, 
    defaultEmbedModel: null,
    cli: {
      bin: 'claude',
      
      
      
      buildArgs: (model, opts = {}, ctx = {}) => {
        const args = []
        
        
        
        
        
        
        if (ctx.sessionUuid) {
          if (ctx.resume) args.push('--resume', ctx.sessionUuid)
          else args.push('--session-id', ctx.sessionUuid)
        }
        if (opts.skip_permissions) {
          args.push('--dangerously-skip-permissions')
        } else if (opts.permission_mode) {
          args.push('--permission-mode', sanitizeFlag(opts.permission_mode))
        }
        
        
        if (opts.mcp !== false) {
          args.push('--mcp-config', ensureMcpConfig())
          if (opts.strict_mcp_config !== false) args.push('--strict-mcp-config')
        }
        
        
        
        
        
        if (opts.stream) {
          args.push('--output-format', 'stream-json', '--verbose', '--include-partial-messages')
        }
        
        
        
        if (permGateActive(opts)) {
          args.push('--settings', ensurePermissionSettings())
        }
        
        
        
        
        
        
        
        
        
        
        
        
        const systemMode = ctx.systemMode || opts.system_prompt_mode || 'replace'
        if (ctx.system) {
          if (systemMode === 'append') args.push('--append-system-prompt', ctx.system)
          else if (systemMode !== 'off') args.push('--system-prompt', ctx.system)
        }
        
        
        
        
        
        
        
        
        
        if (systemMode === 'replace') args.push('--tools', '')
        
        
        if (model) args.push('--model', model)
          args.push('-') 
        return args
      },
    },
  },

  'ollama-cli': {
    mode: 'cli',
    defaultModel:      'llama3',
    defaultEmbedModel: null,
    cli: {
      bin: 'ollama',
      buildArgs: (model /*, opts */) => ['run', model || 'llama3'],
    },
  },

  
  
  
  
  
  'codex-cli': {
    mode: 'cli',
    defaultModel:      null, 
    defaultEmbedModel: null,
    cli: {
      bin: 'codex',
      buildArgs: (model, opts = {}, ctx = null) => {
        
        
        
        
        const appServer = ctx?.transport === 'app-server'
        const { sandbox, approvalPolicy } = resolveCodexPermissions(opts.reportToolsOnly
          ? { ...opts, sandbox: 'read-only', approval_policy: 'never' }
          : opts, ctx?.sessionPolicy)
        const executionMode = resolveCodexExecutionMode(opts)
        const args = appServer ? ['app-server'] : ['exec', '--skip-git-repo-check']
        args.push('-c', `approval_policy=${tomlString(approvalPolicy)}`)
        if (appServer) args.push('-c', `sandbox_mode=${tomlString(sandbox)}`, '-c', 'approvals_reviewer="user"')
        else args.push('--sandbox', sandbox)
        
        
        
        
        
        if (executionMode === 'runtime-controlled' || opts.reportToolsOnly) {
          args.push('-c', 'features.shell_tool=false', '-c', 'features.unified_exec=false')
        }
        
        
        
        
        
        
        if (opts.mcp !== false) args.push(...codexMcpArgs(ctx?.mcpEnv))
        if (opts.stream && !appServer) args.push('--json')
        if (sandbox === 'workspace-write' && typeof opts.network === 'boolean') {
          args.push('-c', `sandbox_workspace_write.network_access=${opts.network}`)
        }
        const writableDirs = [
          ...(Array.isArray(opts.add_dirs) ? opts.add_dirs : []),
          ctx?.workspaceDir,
        ]
        const dirs = [...new Set(writableDirs.filter(Boolean).map(String))]
        if (appServer) {
          args.push('-c', `sandbox_workspace_write.writable_roots=[${dirs.map(tomlString).join(',')}]`)
          if (model) args.push('-c', `model=${tomlString(model)}`)
        } else {
          for (const dir of dirs) args.push('--add-dir', dir)
          if (model) args.push('--model', model)
          args.push('-')
        }
        return args
      },
    },
  },

  
  
  
  
  'antigravity-cli': {
    mode: 'cli',
    defaultModel:      ANTIGRAVITY.defaultModel,
    defaultEmbedModel: null,
    cli: {
      bin: ANTIGRAVITY.bin,
      buildArgs: (model, opts = {}) => {
        const args = [...ANTIGRAVITY.execArgs]
        
        
        if (opts.stream && ANTIGRAVITY.streamFlag) args.push(ANTIGRAVITY.streamFlag)
        if (model) args.push('--model', model)
        args.push('-') 
        return args
      },
    },
  },

  
  
  
  
  'gemini-cli': {
    mode: 'cli',
    defaultModel:      GEMINI.defaultModel,
    defaultEmbedModel: null,
    cli: {
      bin: GEMINI.bin,
      buildArgs: (model, opts = {}) => {
        const args = ['-p', '']
        if (model) args.push('-m', model)
        
        
        if (opts.approval_mode) {
          args.push('--approval-mode', String(opts.approval_mode))
          
          
          
          
          
          if (opts.skip_trust !== false) args.push('--skip-trust')
        }
        
        
        return args
      },
    },
  },

  'opencode-cli': {
    mode: 'cli',
    defaultModel:      null,
    defaultEmbedModel: null,
    cli: {
      bin: 'opencode',
      buildArgs: (model, opts = {}) => {
        const args = ['run']
        if (opts.auto) args.push('--auto')
        if (model) args.push('--model', model)
        args.push('--format', 'json')
        args.push('-')
        return args
      },
    },
  },
}

/**
 * Retorna a definição do provider.
 * "generic" = qualquer API OpenAI-compatible com base_url customizado.
 */
function getProviderDef(name) {
  return PROVIDERS[name] ?? {
    chat:    (base) => `${base}`,
    embed:   (base) => `${base}/embeddings`,
    headers: (key)  => (key ? { Authorization: `Bearer ${key}` } : {}),
    defaultModel:      null,
    defaultEmbedModel: null,
  }
}



let _override = null 

export const setSlotOverride   = (opts) => { _override = opts ? { ..._override, ...opts } : null }
export const clearSlotOverride = ()     => { _override = null }
export const getSlotOverride   = ()     => _override



/**
 * Expande todos os pools habilitados em slots individuais.
 *
 * Ordem de prioridade:
 *   1. Runtime override (set_provider) → único slot, prioridade absoluta
 *   2. llm.pools[] habilitados → round-robin entre todos os slots
 *   3. Fallback legado openrouter.api_keys (retrocompatibilidade)
 *
 * @param   {object}  config  Conteúdo do agent.config.json
 * @param   {object}  [opts]
 * @param   {string}  [opts.onlyPool]  Se presente, constrói slots APENAS do pool
 *   cujo id ou name casa — e ignora o flag `enabled` (permite testar pools
 *   desabilitados, ex.: benchmark pinando provider). Também pula o fallback legado.
 * @returns {Slot[]}
 *
 * @typedef {{ id, poolName, provider, model, embedModel,
 *             url, embedUrl, headers, key, keyIndex }} Slot
 */
export function buildSlots(config, opts = {}) {
  config = normalizeConfig(config ?? {})
  const { onlyPool = null } = opts
  const slots = []

  
  if (_override) {
    const { provider = 'openrouter', model, base_url, api_key } = _override
    const def = getProviderDef(provider)
    if (def.mode === 'cli') {
      slots.push({
        id:         'override[0]',
        poolName:   'override',
        provider,
        mode:       'cli',
        model:      model ?? def.defaultModel,
        embedModel: def.defaultEmbedModel,
        cli: { bin: def.cli.bin, buildArgs: def.cli.buildArgs, opts: {} },
        key:        null,
        keyIndex:   0,
      })
      return slots
    }

    slots.push({
      id:        'override[0]',
      poolName:  'override',
      provider,
      mode:      'http',
      model:     model     ?? def.defaultModel,
      embedModel: def.defaultEmbedModel,
      url:       def.chat(base_url ?? null),
      embedUrl:  def.embed ? def.embed(base_url ?? null) : null,
      headers:   { 'Content-Type': 'application/json', ...def.headers(api_key) },
      key:       api_key ?? null,
      keyIndex:  0,
    })
    return slots 
  }

  
for (const pool of (config?.llm?.pools ?? [])) {
  
  if (onlyPool != null) {
    const poolKey = pool.id ?? pool.name
    if (poolKey !== onlyPool && pool.name !== onlyPool && pool.id !== onlyPool) continue
  } else if (!pool.enabled) {
    continue
  }

  const providerName = pool.provider ?? 'openrouter'
  const def          = getProviderDef(providerName)
  const poolModel    = pool.model       ?? def.defaultModel
  
  
  const poolName     = pool.id ?? pool.name ?? `${providerName}-${slots.length}`
  const embedModel   = pool.embed_model ?? def.defaultEmbedModel

  
  
  
  if (def.mode === 'cli') {
    
    
    
    
    const manualAccounts = Array.isArray(pool.cli?.accounts) ? pool.cli.accounts : []
    const withTerminal = providerName === 'claude-cli'
      ? mergeWithTerminalAccounts(manualAccounts)
      : providerName === 'codex-cli'
        ? mergeWithTerminalCodexAccounts(manualAccounts)
        : providerName === 'antigravity-cli'
          ? mergeWithTerminalAntigravityAccounts(manualAccounts)
          : providerName === 'gemini-cli'
            ? mergeWithTerminalGeminiAccounts(manualAccounts)
            : providerName === 'opencode-cli'
              ? mergeWithTerminalOpencodeAccounts(manualAccounts)
              : manualAccounts
    
    
    const disabledAccounts = providerName === 'codex-cli'
      ? new Set(Array.isArray(pool.cli?.disabled_accounts) ? pool.cli.disabled_accounts : [])
      : new Set()
    const enabledAccounts = withTerminal.filter(account => !disabledAccounts.has(account?.name))
    
    
    
    const accounts = enabledAccounts.length
      ? enabledAccounts
      : withTerminal.length
        ? []
        : [null]

    for (let ai = 0; ai < accounts.length; ai++) {
      const account   = accounts[ai]
      
      
      
      
      
      
      
      const accountEnv = account?.source === 'terminal-profile'
        ? { HOME: account.home }
        : account?.config_dir
          ? providerName === 'codex-cli'
            ? { CODEX_HOME: account.config_dir }
            : providerName === 'antigravity-cli'
              ? { [ANTIGRAVITY.homeEnv]: account.config_dir }
              : providerName === 'gemini-cli'
                ? { HOME: account.home ?? dirname(account.config_dir) }
                : providerName === 'opencode-cli'
                  ? { HOME: account.home ?? dirname(account.config_dir) }
              : { CLAUDE_CONFIG_DIR: account.config_dir }
          : undefined
      const slotLabel  = accounts.length > 1 ? (account?.name ?? String(ai)) : '0'

      slots.push({
        id:         `${poolName}[${slotLabel}]`,
        poolName,
        provider:   providerName,
        mode:       'cli',
        model:      poolModel,
        embedModel, 
        cli: {
          bin:       def.cli.bin,
          buildArgs: def.cli.buildArgs,
          opts:      pool.cli ?? {},
          env:       accountEnv,       
          account:   account?.name ?? null,
        },
        key:        null,
        keyIndex:   ai,
        retry:      pool.retry ?? null,
        maxConcurrency: pool.maxConcurrency ?? 1,
      })
    }
    continue
  }

  const poolBase = pool.base_url ?? null
  
  
  
  
  const rawKeys = def.keyless
    ? [null]
    : (pool.api_keys ?? (pool.api_key ? [pool.api_key] : [null]))

  for (let ki = 0; ki < rawKeys.length; ki++) {
    const entry = rawKeys[ki]
    const isObj = entry !== null && typeof entry === 'object'
    if (isObj && entry.enabled === false) continue

    
    const key      = isObj ? (entry.key      ?? null)      : entry
    const keyModel = isObj ? (entry.model    ?? poolModel) : poolModel
    const keyBase  = isObj ? (entry.base_url ?? poolBase)  : poolBase

    slots.push({
      id:        `${poolName}[${ki}]`,
      poolName,
      provider:  providerName,
      mode:      'http',
      model:     keyModel,
      embedModel,
      url:       def.chat(keyBase),   
      embedUrl:  def.embed ? def.embed(keyBase) : null,
      
      
      
      baseUrl:   keyBase,
      headers:   { 'Content-Type': 'application/json', ...def.headers(key) },
      key,
      
      
      keyless:   Boolean(def.keyless),
      
      
      providerOptions: pool.options ?? null,
      keyIndex:  ki,
      retry: pool.retry ?? null,
      maxConcurrency: isObj ? (entry.maxConcurrency ?? pool.maxConcurrency ?? 1) : (pool.maxConcurrency ?? 1),
    })
  }
}

  
  
  if (!slots.length && onlyPool == null) {
    const or   = config?.openrouter ?? {}
    const keys = Array.isArray(or.api_keys)
      ? or.api_keys
      : (or.api_key ? [or.api_key] : [])
    const def  = getProviderDef('openrouter')

    for (let ki = 0; ki < keys.length; ki++) {
      const key = keys[ki]
      slots.push({
        id:        `legacy[${ki}]`,
        poolName:  'legacy',
        provider:  'openrouter',
        mode:      'http',
        model:     or.default_model     ?? def.defaultModel,
        embedModel: or.embedding_model  ?? def.defaultEmbedModel,
        url:       def.chat(null),
        embedUrl:  def.embed(null),
        headers:   { 'Content-Type': 'application/json', ...def.headers(key) },
        key,
        keyIndex:  ki,
      })
    }
  }

  return slots
}



function loadState() {
  if (!existsSync(STATE_FILE)) return { index: 0, slots: {} }
  try   { return JSON.parse(readFileSync(STATE_FILE, 'utf8')) }
  catch { return { index: 0, slots: {} } }
}

function saveState(s) {
  const dir = join(PKG_DIR, '..', 'memory')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  writeFileSync(STATE_FILE, JSON.stringify(s, null, 2), 'utf8')
}



/**
 * Seleciona o próximo slot disponível (round-robin, pula desabilitados).
 * Se todos estiverem desabilitados, reseta o estado e retorna o primeiro.
 *
 * @param   {Slot[]} slots
 * @returns {Slot}
 */
/**
 * O slot está fora do rodízio AGORA?
 *
 * `disabled` sozinho é permanente (só volta com resetSlot manual) — correto pra
 * causa que não se resolve com o tempo, como login expirado. Já cota/limite de
 * uso de assinatura reabre sozinha na hora anunciada pelo próprio CLI, e essa
 * hora vai em `disabled_until`: passado o prazo, o slot volta à rotação sem
 * intervenção. Sem isso, três estouros de janela aposentavam as três contas do
 * Codex de vez.
 */
function isSlotBlocked(ss) {
  if (!ss?.disabled) return false
  if (!ss.disabled_until) return true 
  return Date.parse(ss.disabled_until) > Date.now()
}

/** Zera o bloqueio de um slot cujo cooldown venceu (muta `state`). */
function expireCooldown(state, slotId) {
  const ss = state.slots[slotId]
  if (!ss?.disabled_until) return
  state.slots[slotId] = { ...ss, failures: 0, disabled: false, disabled_until: null }
  console.log(`[llm_keys] cooldown de "${slotId}" expirou — de volta ao rodízio.`)
}

export function getNextSlot(slots) {
  if (!slots.length) throw new Error('Nenhum slot LLM disponível.')

  const state = loadState()
  if (!state.slots) state.slots = {}

  
  for (const slot of slots) {
    const ss = state.slots[slot.id]
    if (ss?.disabled && ss.disabled_until && !isSlotBlocked(ss)) expireCooldown(state, slot.id)
  }

  
  if (memoryIndex === null) {
    memoryIndex = state.index ?? 0
  }

  const start = memoryIndex % slots.length

  for (let i = 0; i < slots.length; i++) {
    const idx  = (start + i) % slots.length
    const slot = slots[idx]
    const ss   = state.slots[slot.id] ?? { failures: 0, disabled: false }

    
    
    if (!isSlotBlocked(ss)) {
      memoryIndex = (idx + 1) % slots.length 
      state.index = memoryIndex
      saveState(state) 
      return slot
    }
  }

  
  
  
  
  
  
  
  
  
  const recoveryIndex = memoryIndex % slots.length
  const recoverySlot = slots[recoveryIndex]
  const until = state.slots[recoverySlot.id]?.disabled_until
  console.warn(
    `[llm_keys] Todos os slots estão bloqueados. Sondando "${recoverySlot.id}"` +
    (until ? ` (libera em ${until}).` : ' (sem prazo de retomada).')
  )
  memoryIndex = (recoveryIndex + 1) % slots.length
  state.index = memoryIndex
  saveState(state)

  return recoverySlot
}



export function reportSlotSuccess(slotId) {
  const state = loadState()
  if (!state.slots) state.slots = {}
  state.slots[slotId] = {
    ...(state.slots[slotId] ?? {}),
    failures:       0,
    disabled:       false,
    disabled_until: null,
    last_success:   new Date().toISOString(),
  }
  saveState(state)
}

/**
 * Contabiliza uma falha do slot e o desabilita ao atingir MAX_FAILURES.
 *
 * @param {string}  slotId
 * @param {any}     error
 * @param {object}  [opts]
 * @param {boolean} [opts.forceDisable] - desabilita já na 1ª falha. Usado para
 *   causas que não se resolvem sozinhas (conta sem crédito/cota estourada):
 *   insistir mais 2 vezes só queima tempo e mantém o pool preso numa conta morta.
 * @param {string}  [opts.reason]       - causa classificada (ver cli_failures.js),
 *   registrada no estado para o status do pool mostrar POR QUE o slot caiu.
 * @param {number}  [opts.cooldownMs]   - se > 0, o slot volta sozinho ao rodízio
 *   após esse prazo (limite de uso por assinatura reabre; ver cooldownFor()).
 *   Sem cooldown, `disabled` continua valendo até um reset manual.
 */
export function reportSlotFailure(slotId, error, { forceDisable = false, reason = null, cooldownMs = 0 } = {}) {
  const state    = loadState()
  if (!state.slots) state.slots = {}
  const prev     = state.slots[slotId] ?? { failures: 0, disabled: false }
  const failures = (prev.failures ?? 0) + 1
  const disabled = forceDisable || failures >= MAX_FAILURES

  state.slots[slotId] = {
    ...prev,
    failures,
    disabled,
    disabled_until: (disabled && cooldownMs > 0)
      ? new Date(Date.now() + cooldownMs).toISOString()
      : null,
    last_reason:  reason,
    last_error:   String(error),
    last_failure: new Date().toISOString(),
  }
  saveState(state)
  return state.slots[slotId]
}

/**
 * @param {Slot}    slot
 * @param {string} [why] - motivo legível (ex.: "sem crédito"). Sem ele, assume
 *   o caso genérico de N falhas consecutivas.
 */
export async function notifySlotDisabled(slot, why = null) {
  try {
    const { sendProactive } = await import('../channels/channels.js')
    const cause = why ?? `${MAX_FAILURES} falhas`
    const account = slot.cli?.account ? ` | Conta: ${slot.cli.account}` : ''
    await sendProactive(
      `[Agent] Slot "${slot.id}" desabilitado — ${cause}.\n` +
      `Pool: ${slot.poolName} | Provider: ${slot.provider} | Model: ${slot.model}${account}`
    )
  } catch {}
}



export function getSlotStatus(slots) {
  const state = loadState()
  return slots.map(slot => {
    const ss     = state.slots?.[slot.id] ?? { failures: 0, disabled: false }
    const masked = slot.key
      ? `${slot.key.slice(0, 8)}...${slot.key.slice(-4)}`
      : 'no-key'
    return {
      id:           slot.id,
      pool:         slot.poolName,
      provider:     slot.provider,
      model:        slot.model,
      key:          masked,
      failures:     ss.failures     ?? 0,
      
      
      disabled:     ss.disabled     ?? false,
      disabled_until: ss.disabled_until ?? null,
      blocked:      isSlotBlocked(ss),
      last_success: ss.last_success ?? null,
      last_failure: ss.last_failure ?? null,
      last_error:   ss.last_error   ?? null,
      last_reason:  ss.last_reason  ?? null,
      in_flight:    slotLeases.get(slot.id)?.active ?? 0,
      queued:       slotLeases.get(slot.id)?.queue.length ?? 0,
      max_concurrency: slot.maxConcurrency ?? 1,
    }
  })
}

export function resetSlot(slots, slotId) {
  const found = slots.find(s => s.id === slotId)
  if (!found) return { success: false, error: `Slot "${slotId}" não encontrado.` }
  const state = loadState()
  if (!state.slots) state.slots = {}
  state.slots[slotId] = { failures: 0, disabled: false, disabled_until: null }
  saveState(state)
  return { success: true, reset: slotId }
}

export function resetAllSlots() {
  saveState({ index: 0, slots: {} })
  return { success: true }
}




export const getKeys           = (config)       => buildSlots(config).map(s => s.key).filter(Boolean)
export const getNextKey        = (config)        => {
  const slots = buildSlots(config)
  const slot  = getNextSlot(slots)
  return { key: slot.key, index: slot.keyIndex ?? 0 }
}
export const reportKeySuccess  = (_key)          => {} 
export const reportKeyFailure  = (_key, _err)    => ({ failures: 1, disabled: false })
export const getKeysStatus     = (config)        => getSlotStatus(buildSlots(config))
export const resetKey          = (_cfg, _i)      => resetAllSlots()
export const resetAllKeys      = (_cfg)          => resetAllSlots()
export const notifyKeyDisabled = async (_i, _s)  => {}
