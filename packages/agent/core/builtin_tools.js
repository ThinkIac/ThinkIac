import {
  readFileSync, existsSync, mkdirSync, writeFileSync,
  cpSync, readdirSync
} from 'fs'
import { join, dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { randomUUID } from 'crypto'
import { createRequire } from 'module'
import { execSync } from 'child_process'
import { runInSandbox } from './sandbox.js'
import {
  registerTool, persistTool, deleteTool, invokeTool,
  listToolSchemas, buildSchema, loadPersistedTools as _load
} from './registry.js'
import {
  remember as memoryRemember, recall as memoryRecall,
  forget as memoryForget, relate as memoryRelate,
} from '../../memory/lib/graph.js'
import { callLLM, runCliSlot } from '../llm/llm.js'
import { getMaxIterations, getConfig } from '../utils/config.js'

import {
  handleReadFile, handleWriteFile, handlePatchFile,
  handleListDir, handleSearchCode,
  handleReloadConfig, setPrivilegedContext, getPrivilegedContext
} from './privileged.js'
import { sendProactive } from '../channels/channels.js'
import { getBridgeToken } from './session_channel.js'
import { listHistory, restoreVersion, listAllTracked, clearHistory } from '../memory/history.js'
import {
  discoverRuntimeTools, discoverRuntimeRoutes,
  invokeRuntimeTool, invalidateCache, getCacheInfo
} from './runtime_bridge.js'
import {
  persistProviderConfig, listProviderModels,
  setProviderOverride, resolveProvider
} from '../llm/provider.js'

import {
  buildSlots, getSlotStatus, resetAllSlots,
  setSlotOverride, clearSlotOverride, getNextSlot,
  reportSlotSuccess, reportSlotFailure, notifySlotDisabled
} from '../llm/llm_keys.js'
import { isCreditFailure } from '../llm/cli_failures.js'
import { eventCall, pushToHostSession } from '../host/agent_host.js'
import { listConnectedFronts, getConnectedFront, sendFrontCommand } from './chat_bus.js'
import { normalizeToolOutcome } from './tool_outcome.js'
import { inheritPolicy } from '../../governance/lib/policy.js'
import { grantToolAccess } from './tool_access.js'







const VARIANTS_OFF = 'O package "variants" está desativado. Reative-o em packages/ para usar as ferramentas de variante.'

function variantsStub() {
  return new Proxy({}, {
    get(_target, prop) {
      
      
      if (prop === 'then' || typeof prop === 'symbol') return undefined
      return () => { throw new Error(VARIANTS_OFF) }
    }
  })
}






const requireOptional = createRequire(import.meta.url)

function optionalVariants(file) {
  try {
    return requireOptional(`../../variants/lib/${file}`)
  } catch (err) {
    if (err?.code !== 'MODULE_NOT_FOUND') throw err
    return variantsStub()
  }
}

const variantRegistry = optionalVariants('registry.js')
const variantWorktree = optionalVariants('worktree.js')
const variantPreview = optionalVariants('preview.js')

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(PKG_DIR, '..')
const PROJECT_DIR = join(AGENT_DIR, '..', '..')
const PACKAGES_DIR = join(PROJECT_DIR, 'packages')
const SNAP_DIR = join(AGENT_DIR, 'snapshots', 'core')
const CORE_LIST = [
  'agent.js', 'builtin_tools.js', 'channels.js', 'config.js',
  'history.js', 'llm.js', 'llm_keys.js', 'memory.js',
  'metacognition.js', 'privileged.js', 'registry.js',
  'runtime_bridge.js', 'sandbox.js',
  'timezone.js', 'provider.js',
]

export const BUILTIN_SCHEMAS = [
  {
    name: 'list_active_sessions',
    description: 'Lista as abas Agent conectadas que declararam presença, rota, viewport e capabilities autorizadas.',
    input_schema: { type: 'object', properties: {} }
  },
  {
    name: 'get_os_context',
    description: 'Lê o contexto declarado por uma aba Agent conectada: rota, viewport, plataforma e capabilities.',
    input_schema: { type: 'object', properties: { session_id: { type: 'string' } } }
  },
  {
    name: 'get_dom_snapshot',
    description: 'Lê o último snapshot voluntariamente produzido por uma aba Agent conectada; solicita um novo quando ainda não houver snapshot.',
    input_schema: { type: 'object', properties: { session_id: { type: 'string' } } }
  },
  {
    name: 'run_ui_action',
    description: 'Executa uma ação UI autorizada. Nesta versão suporta somente navegação para rotas internas.',
    input_schema: { type: 'object', required: ['action'], properties: { action: { type: 'object' }, session_id: { type: 'string' }, wait_snapshot: { type: 'boolean' } } }
  },
  {
    name: 'create_tool',
    description: 'Cria uma tool interna do Agent (sandbox=execução única, permanent=salva em agent/generated).',
    input_schema: {
      type: 'object', required: ['name', 'description', 'code', 'mode'], properties: {
        name: { type: 'string' },
        description: { type: 'string' },
        code: { type: 'string' },
        mode: { type: 'string', enum: ['sandbox', 'permanent'] },
        params: {
          type: 'array', items: {
            type: 'object', required: ['name', 'type', 'description'],
            properties: { name: { type: 'string' }, type: { type: 'string' }, description: { type: 'string' }, optional: { type: 'boolean' } }
          }
        },
        test_input: { type: 'object' }
      }
    }
  },

  {
    name: 'run_tool',
    description: 'Invoca uma tool interna do Agent pelo nome.',
    input_schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, input: { type: 'object' } } }
  },

  {
    name: 'run_parallel',
    description: 'Executa tools independentes em paralelo (Promise.all). Não aninhar.',
    input_schema: {
      type: 'object', required: ['tools'], properties: {
        tools: {
          type: 'array',
          items: { type: 'object', required: ['name', 'input'], properties: { name: { type: 'string' }, input: { type: 'object' } } }
        }
      }
    }
  },

  {
    name: 'spawn_agent',
    description: 'Delega uma tarefa a um subagente com loop ReAct e contexto (histórico de mensagens) isolado do agente pai. Devolve apenas o resultado final, não o transcript — use para tarefas grandes/exploratórias (multi-step) que poluiriam o contexto atual; para uma tool call simples, chame a tool direto. Não pode ser usada de dentro de outro subagente (profundidade máxima = 1).',
    input_schema: {
      type: 'object', required: ['description', 'prompt'], properties: {
        description: { type: 'string', description: 'Resumo curto (3-6 palavras) do que o subagente vai fazer.' },
        prompt: { type: 'string', description: 'Instrução completa e autossuficiente para o subagente — ele não vê o histórico do agente pai.' },
        background: { type: 'boolean', description: 'Se true, roda em segundo plano e notifica ao terminar (canal proativo); consulte com get_agent_result. Default false.' },
        max_iterations: { type: 'number', description: 'Teto de iterações do subagente (default 8, nunca maior que o teto do agente pai).' },
        variant_id: { type: 'string', description: 'Se informado (retornado por create_variant), os tools de arquivo/shell do subagente operam dentro do worktree isolado dessa variante em vez do runtime ao vivo.' },
      }
    }
  },

  {
    name: 'get_agent_result',
    description: 'Consulta o status/resultado de um subagente em background pelo handle retornado por spawn_agent OU por run_engineer_task (mesmo handle, mesmo mecanismo).',
    input_schema: { type: 'object', required: ['handle'], properties: { handle: { type: 'string' } } }
  },

  {
    name: 'run_engineer_task',
    description: 'Delega uma tarefa de engenharia de código (multi-arquivo, potencialmente longa) para o Claude Code rodando via CLI local (provider "claude-cli"), com acesso nativo via MCP às tools reais do workspace (read_file/write_file/patch_file/run_shell/search_code/etc — ver packages/engineer) e à tool ask_user, que permite ao Claude Code pausar e perguntar algo diretamente ao usuário humano real no meio da tarefa. Diferente de spawn_agent (que usa o loop ReAct do próprio Agent), aqui quem itera/decide as tool calls é o Claude Code — Agent só aciona, espera e (se background) faz polling do resultado. Requer um pool "claude-cli" habilitado em agent.config.json.',
    input_schema: {
      type: 'object', required: ['description', 'task'], properties: {
        description: { type: 'string', description: 'Resumo curto (3-6 palavras) do que a tarefa faz.' },
        task: { type: 'string', description: 'Instrução completa e autossuficiente para o Engineer — ele não vê o histórico da conversa atual.' },
        background: { type: 'boolean', description: 'Se true (default), roda em segundo plano e notifica ao terminar; consulte com get_agent_result. Se false, bloqueia até terminar — só use pra tarefas curtas, já que run_shell/ask_user podem levar minutos.' },
        account: { type: 'string', description: 'Nome da conta (pool.cli.accounts[].name em agent.config.json) a usar, se o pool tiver mais de uma. Omitido = round-robin entre as habilitadas.' },
      }
    }
  },

  {
    name: 'create_variant',
    description: 'Cria uma variante temporária de um package: git worktree + branch isolados, com preview ao vivo numa porta própria. O package original continua servindo normalmente. A partir da resposta, os tools de arquivo/shell da sessão atual (read_file, write_file, patch_file, list_dir, run_shell, search_code) passam a operar dentro do worktree da variante — chame create_variant antes de implementar a melhoria, não depois.',
    input_schema: {
      type: 'object', required: ['pkg', 'description'], properties: {
        pkg: { type: 'string', description: 'Nome da pasta em apps/runtime/packages/ (ex: "scheduler"). Pode ser um package novo.' },
        description: { type: 'string', description: 'Resumo curto da melhoria — vira o nome da branch e aparece no dashboard de variantes.' },
      }
    }
  },

  {
    name: 'list_variants',
    description: 'Lista variantes abertas (ou todas, se all=true) com status, branch e URL de preview.',
    input_schema: { type: 'object', properties: { pkg: { type: 'string' }, all: { type: 'boolean', description: 'Inclui promovidas/descartadas.' } } }
  },

  {
    name: 'preview_variant',
    description: 'Retorna a URL de preview ao vivo de uma variante (abra num link/iframe para o usuário ver a versão XYZ do app ABC antes de aprovar).',
    input_schema: { type: 'object', required: ['variant_id'], properties: { variant_id: { type: 'string' } } }
  },

  {
    name: 'promote_variant',
    description: 'Aplica o conteúdo da variante no package ao vivo (o hot-reload do runtime valida e troca automaticamente em alguns segundos), encerra o preview isolado e remove o worktree. Use quando o usuário aprovar ("promova X") ou quando você mesmo julgar a melhoria pronta e o usuário confirmar.',
    input_schema: { type: 'object', required: ['variant_id'], properties: { variant_id: { type: 'string' } } }
  },

  {
    name: 'discard_variant',
    description: 'Descarta uma variante: encerra o preview, remove o worktree e apaga a branch. Use quando a melhoria não deu certo ou o usuário recusar a promoção.',
    input_schema: { type: 'object', required: ['variant_id'], properties: { variant_id: { type: 'string' } } }
  },

  {
    name: 'list_tools',
    description: 'Lista todas as tools disponíveis: internas, runtime e builtins.',
    input_schema: { type: 'object', properties: {} }
  },

  {
    name: 'delete_tool',
    description: 'Remove uma tool permanente do agent/generated/ e do registry.',
    input_schema: { type: 'object', required: ['name'], properties: { name: { type: 'string' } } }
  },

  {
    name: 'reset_infra',
    description: 'Solicita reset da infra ao fim do ciclo ReAct completo.',
    input_schema: { type: 'object', properties: { reason: { type: 'string' } } }
  },

  {
    name: 'set_provider',
    description: 'Troca o provedor LLM em runtime.',
    input_schema: {
      type: 'object', required: ['provider'], properties: {
        provider: { type: 'string', enum: ['openrouter', 'openai', 'ollama'] },
        model: { type: 'string' }, base_url: { type: 'string' }, api_key: { type: 'string' }, persist: { type: 'boolean' },
      }
    }
  },

  
  
  

  
  
  

  
  
  

  {
    name: 'run_runtime_tool',
    description: 'Invoca uma tool de qualquer package do runtime pelo nome.',
    input_schema: {
      type: 'object', required: ['tool'], properties: {
        package: { type: 'string' }, tool: { type: 'string' }, args: { type: 'object' }
      }
    }
  },

  {
    name: 'list_runtime_tools',
    description: 'Descobre tools do Runtime. Use uma busca específica quando faltar capacidade; retorna somente resultados relevantes.',
    input_schema: { type: 'object', properties: {
      query: { type: 'string', description: 'Capacidade, ação ou nome procurado.' },
      package: { type: 'string', description: 'Restringe a descoberta a um package.' },
      limit: { type: 'number', description: 'Máximo de resultados, de 1 a 50. Padrão 20.' },
      force_refresh: { type: 'boolean' }
    } }
  },

  {
    name: 'request_tool_access',
    description: 'Solicita à governança acesso temporário a tools específicas já descobertas. Use somente quando a tool necessária não estiver acessível; após aprovação, retome a tarefa original.',
    input_schema: { type: 'object', required: ['tool_names', 'reason'], properties: {
      tool_names: { type: 'array', items: { type: 'string' }, description: 'Nomes exatos das tools necessárias.' },
      reason: { type: 'string', description: 'Por que essas tools são necessárias para o pedido atual.' }
    } }
  },

  {
    name: 'list_runtime_routes',
    description: 'Lista todas as rotas HTTP @register_router de todos os packages.',
    input_schema: { type: 'object', properties: { force_refresh: { type: 'boolean' } } }
  },

  
  
  
  
  
  
  
  

  { name: 'remember',
    description: 'Armazena fato na memória de longo prazo (grafo de entidades/observações) e gera embedding vetorial para busca semântica. Opcionalmente associa o fato a uma entidade nomeada.',
    input_schema: { type: 'object', required: ['fact'], properties: {
      fact:{type:'string'},
      entity:{type:'string', description:'Nome da entidade dona do fato (padrão: "general")'},
      type:{type:'string', description:'Tipo da entidade: person, project, preference, fact, task, event, concept'},
    }}},

  { name: 'recall',
    description: 'Busca semântica na memória de longo prazo (cosine similarity sobre embeddings) e traz também as relações de 1 salto da entidade de cada resultado.',
    input_schema: { type: 'object', required: ['query'], properties: {
      query:{type:'string'}, limit:{type:'number'},
      entity:{type:'string', description:'Restringe a busca a uma entidade específica'},
    }}},

  { name: 'forget',
    description: 'Remove fatos que correspondem à query. Remove também entidades que ficarem órfãs.',
    input_schema: { type: 'object', required: ['query'], properties: { query:{type:'string'} }}},

  { name: 'memory_relate',
    description: 'Cria uma relação dirigida entre duas entidades do grafo de memória (ex.: "Alice" --works_on--> "Projeto X"). Cria as entidades se não existirem.',
    input_schema: { type: 'object', required: ['from', 'type', 'to'], properties: {
      from:{type:'string'}, type:{type:'string'}, to:{type:'string'},
    }}},

  
  
  

  
  
  

  {
    name: 'get_secret',
    description: 'Retorna token OAuth armazenado.',
    input_schema: { type: 'object', required: ['provider'], properties: { provider: { type: 'string', enum: ['google', 'github', 'meta'] } } }
  },

  
  
  /*{
    name: 'plan_objective',
    description: 'Decompõe um objetivo em tasks atômicas com prioridades.',
    input_schema: { type: 'object', required: ['objective'], properties: { objective: { type: 'string' }, context: { type: 'string' } } }
  },*/

  
  
  

  
  
  

  
  
  

  
  
  

  
  
  

  
  
  

  {
    name: 'reload_config',
    description: 'Recarrega AGENT.md + PREFERENCES.md + agent.config.json ao vivo.',
    input_schema: { type: 'object', properties: {} }
  },

  {
    name: 'file_history',
    description: 'Lista snapshots de um arquivo.',
    input_schema: { type: 'object', properties: { path: { type: 'string' } } }
  },

  {
    name: 'file_restore',
    description: 'Restaura arquivo para snapshot anterior.',
    input_schema: { type: 'object', required: ['path'], properties: { path: { type: 'string' }, index: { type: 'number' }, clear: { type: 'boolean' } } }
  },

  {
    name: 'health',
    description: 'Retorna status completo do sistema.',
    input_schema: { type: 'object', properties: {} }
  },

  
  
  
  
  
  

  
  
  
  
  

  
  
  
  
  

  
  
  
  
  
  
  
]

const PROTECTED = new Set(BUILTIN_SCHEMAS.map(s => s.name))
const _bootTime = Date.now()

let _pendingReset = null

export function getPendingReset() { return _pendingReset }
export function clearPendingReset() { _pendingReset = null }

function toCamel(s) { return s.replace(/[-_]([a-z])/g, (_, c) => c.toUpperCase()) }

const _runtimeToolHandlers = new Map()

export function injectRuntimeTools(tools) {
  for (const t of tools) {
    if (PROTECTED.has(t.name)) continue
    _runtimeToolHandlers.set(t.name, t._call)
    const exists = BUILTIN_SCHEMAS.find(s => s.name === t.name)
    if (!exists) {
      BUILTIN_SCHEMAS.push({
        name: t.name,
        description: `[${t.package}] ${t.description ?? t.name}`,
        input_schema: t.parameters ?? { type: 'object', properties: {} },
        reach: t.reach || 'auto',
        recoveryPolicy: t.recoveryPolicy || null,
        reconcileTool: t.reconcileTool || null,
        _runtime: true,
        _package: t.package,
      })
    }
  }
}

export function clearInjectedRuntimeTools() {
  for (const [name] of _runtimeToolHandlers) {
    const idx = BUILTIN_SCHEMAS.findIndex(s => s.name === name && s._runtime)
    if (idx !== -1) BUILTIN_SCHEMAS.splice(idx, 1)
  }
  _runtimeToolHandlers.clear()
}

export async function executeReset(reason = '') {
  const tag = reason ? ` (${reason})` : ''
  const broken = []
  for (const f of CORE_LIST) {
    const abs = join(PKG_DIR, f)
    if (!existsSync(abs)) continue
    try { execSync(`node --check ${abs}`, { timeout: 5000, stdio: 'pipe' }) }
    catch (e) { broken.push({ file: f, error: e.stderr?.toString().trim() ?? e.message }) }
  }
  if (broken.length) {
    if (!existsSync(SNAP_DIR)) {
      const msg = `Reset falhou: core quebrado e sem snapshot${tag}.`
      await sendProactive(msg).catch(() => { })
      return msg
    }
    const baks = readdirSync(SNAP_DIR).filter(f => f.endsWith('.bak'))
    if (!baks.length) {
      const msg = `Reset falhou: snapshot vazio${tag}.`
      await sendProactive(msg).catch(() => { })
      return msg
    }
    for (const f of baks) cpSync(join(SNAP_DIR, f), join(PKG_DIR, f.replace(/\.bak$/, '')))
    const stillBroken = []
    for (const f of CORE_LIST) {
      const abs = join(PKG_DIR, f)
      if (!existsSync(abs)) continue
      try { execSync(`node --check ${abs}`, { timeout: 5000, stdio: 'pipe' }) }
      catch { stillBroken.push(f) }
    }
    if (stillBroken.length) {
      const msg = `Reset falhou: snapshot corrompido${tag}.`
      await sendProactive(msg).catch(() => { })
      return msg
    }
    const msg = `Reset concluído${tag}: core restaurado. Reiniciando em 3s…`
    await sendProactive(msg).catch(() => { })
    _doCountdownAndExit(msg)
    return msg
  }
  mkdirSync(SNAP_DIR, { recursive: true })
  for (const f of CORE_LIST) {
    const abs = join(PKG_DIR, f)
    if (existsSync(abs)) cpSync(abs, join(SNAP_DIR, f + '.bak'))
  }
  const msg = `Reset concluído${tag}: snapshot atualizado. Reiniciando em 3s…`
  await sendProactive(msg).catch(() => { })
  _doCountdownAndExit(msg)
  return msg
}

function _doCountdownAndExit(label) {
  let n = 3
  const iv = setInterval(() => {
    process.stdout.write(`\r[reset_infra] ${label} — ${n}s`)
    n--
    if (n < 0) { clearInterval(iv); process.stdout.write('\n'); process.exit(1) }
  }, 1000)
  iv.unref()
  setTimeout(() => { clearInterval(iv); process.stdout.write('\n'); process.exit(1) }, 4500).unref()
}

async function handleResetInfra({ reason = '' } = {}) {
  if (_pendingReset) return { success: true, queued: true, message: `Reset já agendado.` }
  _pendingReset = { reason, requestedAt: Date.now() }
  return { success: true, queued: true, message: `Reset agendado${reason ? ` (${reason})` : ''}.` }
}

async function handleHealth() {
  try {
    const { getConfig } = await import('../utils/config.js')
    const config   = getConfig()
    const slots    = buildSlots(config)
    const statuses = getSlotStatus(slots)
    const cache    = getCacheInfo()
 
    const { listToolSchemas: lts } = await import('./registry.js')
    const { getSchedulerConfig }   = await import('../utils/config.js')
    const schedulerCfg             = getSchedulerConfig()
 
    const builtinCount = BUILTIN_SCHEMAS.filter(s => !s._runtime).length
    const runtimeCount = BUILTIN_SCHEMAS.filter(s =>  s._runtime).length
    const permCount    = lts().filter(t => t.mode === 'permanent').length
 
    const activeSlots   = statuses.filter(s => !s.disabled)
    const disabledSlots = statuses.filter(s =>  s.disabled)
 
    return {
      success:       true,
      uptime_ms:     Date.now() - _bootTime,
      pending_reset: _pendingReset ?? null,
      llm: {
        active_slots:   activeSlots.length,
        disabled_slots: disabledSlots.length,
        total_slots:    slots.length,
        slots:          statuses,
      },
      tools: {
        builtins:         builtinCount,
        runtime_injected: runtimeCount,
        permanent:        permCount,
        total:            BUILTIN_SCHEMAS.length + permCount,
      },
      runtime: {
        packages:    (await discoverRuntimeTools().catch(() => [])).length,
        cache_valid: cache.valid,
      },
      scheduler: {
        enabled:      schedulerCfg.enabled      ?? false,
        tick_minutes: schedulerCfg.tick_minutes ?? 30,
      },
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

export async function handlePushToFront({ payload, session_id = 'default' }) {
  try {
    const sent = pushToHostSession(session_id, payload)
    return { success: true, sent, session_id }
  } catch (e) { return { success: false, error: e.message } }
}

async function handleGetDomSnapshot({ session_id = 'default' } = {}) {
  const front = getConnectedFront(session_id) ?? listConnectedFronts()[0]
  if (!front) return { success: false, error: 'Nenhum front conectado.' }
  if (!front.capabilities.includes('ui:snapshot')) return { success: false, error: 'Este front não autorizou snapshots.' }
  if (!front.snapshot) sendFrontCommand(front.id, { type: 'request-snapshot' })
  const snapshot = front.snapshot ?? null
  return { success: true, session_used: front.id, snapshot, total: snapshot?.elements?.length ?? 0, updated_at: snapshot?.updatedAt ?? null, pending: !snapshot }
}

async function handleGetOsContext({ session_id = 'default' } = {}) {
  const front = getConnectedFront(session_id) ?? listConnectedFronts()[0]
  if (!front) return { success: false, error: 'Nenhum front conectado.', os: false }
  const { id, connectedAt, lastSeenAt, capabilities, route, viewport, platform, activeChatSessionId } = front
  return { success: true, session_used: id, connected_at: connectedAt, updated_at: lastSeenAt, capabilities, route, viewport, platform, active_chat_session_id: activeChatSessionId }
}

async function handleRunUiAction({ action, session_id = 'default', wait_snapshot = true }) {
  if (!action?.type) return { success: false, error: '`action.type` é obrigatório' }
  const front = getConnectedFront(session_id) ?? listConnectedFronts()[0]
  if (!front) return { success: false, error: 'Nenhum front conectado.' }
  if (action.type !== 'navigate') return { success: false, error: 'Ação não autorizada. Nesta versão somente `navigate` é suportada.' }
  if (!front.capabilities.includes('ui:navigate')) return { success: false, error: 'Este front não autorizou navegação.' }
  const path = action.path ?? action.url
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return { success: false, error: 'A navegação deve usar uma rota interna absoluta.' }
  const sent = sendFrontCommand(front.id, { type: 'navigate', path, requestSnapshot: !!wait_snapshot })
  return sent ? { success: true, dispatched: action, session_id: front.id } : { success: false, error: 'Não foi possível enviar o comando ao front.' }
}

function handleListActiveSessions() {
  const sessions = listConnectedFronts()
  return { success: true, count: sessions.length, sessions }
}

export async function handleRunRuntimeTool({ package: pkg, tool, args = {} }) {
  if (!tool) return { success: false, error: '`tool` é obrigatório' }
  try {
    const privileged = getPrivilegedContext()
    
    
    if (pkg === 'artifacts' && !args.sessionId) {
      args = { ...args, sessionId: getPrivilegedContext().session_id }
    }
    await eventCall('tool:call', { package: pkg, tool, args });

    
    
    
    
    const sessionId = privileged.session_id && privileged.session_id !== 'unknown'
      ? privileged.session_id
      : null
    const output = await invokeRuntimeTool(pkg ?? null, tool, args, {
      sessionId,
      alreadyGoverned: !!sessionId,
    })
    const outcome = normalizeToolOutcome(output)
    return {
      success: outcome.ok,
      package: pkg,
      tool,
      output,
      outcome,
      ...(outcome.ok ? {} : { error: outcome.error?.message || 'A runtime tool informou falha.' }),
    }
  }
  catch (e) { return { success: false, error: e.message } }
}

async function handleListRuntimeTools({ query = '', package: packageName = '', limit = 20, force_refresh = false } = {}) {
  try {
    if (force_refresh) invalidateCache()
    const tools = await discoverRuntimeTools()
    const cache = getCacheInfo()
    const needle = String(query || '').trim().toLowerCase()
    const pkg = String(packageName || '').trim().toLowerCase()
    const cap = Math.max(1, Math.min(Number(limit) || 20, 50))
    const matches = tools.filter(tool => {
      if (pkg && String(tool.package).toLowerCase() !== pkg) return false
      if (!needle) return true
      return `${tool.package} ${tool.name} ${tool.description || ''}`.toLowerCase().includes(needle)
    })
    return { success: true, query: needle || null, package: pkg || null,
      tools: matches.slice(0, cap).map(t => ({ package: t.package, name: t.name, description: t.description, reach: t.reach || 'auto' })),
      total: matches.length, returned: Math.min(matches.length, cap), truncated: matches.length > cap, cache_valid: cache.valid }
  } catch (e) { return { success: false, error: e.message } }
}

async function handleRequestToolAccess({ tool_names = [], reason = '' } = {}) {
  const privileged = getPrivilegedContext()
  const tools = await discoverRuntimeTools()
  const catalogNames = [...new Set([...BUILTIN_SCHEMAS.map(tool => tool.name), ...tools.map(tool => tool.name), ...listToolSchemas().map(tool => tool.name)])]
  const grant = grantToolAccess({ sessionId: privileged.session_id, toolNames: tool_names, reason, catalogNames })
  return { success: true, granted: grant.toolNames, expires_at: new Date(grant.expiresAt).toISOString(),
    remaining_uses: grant.remainingUses, message: 'Acesso temporário concedido nesta sessão. Retome a solicitação original.' }
}

async function handleListRuntimeRoutes({ force_refresh = false } = {}) {
  try {
    if (force_refresh) invalidateCache()
    const routes = await discoverRuntimeRoutes()
    return { success: true, routes: routes.map(r => ({ package: r.package, method: r.method, path: r.path })), total: routes.length }
  } catch (e) { return { success: false, error: e.message } }
}

async function handleCreateRuntimePackage({ name, description = '', tools = [], routes = [], hooks = [] }) {
  if (!name) return { success: false, error: 'name é obrigatório' }
  if (!/^[a-z0-9-_]+$/.test(name)) return { success: false, error: 'name deve ser lowercase' }
  const pkgDir = join(PACKAGES_DIR, name)
  if (existsSync(pkgDir)) return { success: false, error: `Package já existe: packages/${name}/` }
  mkdirSync(pkgDir, { recursive: true })
  const lines = [`// ${name} — johankit runtime package`, `// Gerado por Agent — ${new Date().toISOString()}`, '']
  lines.push(`export function onBoot(payload) {\n  /**\n   * @register_hook boot\n   */\n  console.log('[${name}] Package carregado.')\n}\n`)
  for (const tool of tools) {
    const params = (tool.params ?? []).map(p => `   * @param {${p.type}${p.optional ? '?' : ''}} ${p.name} - ${p.description ?? p.name}`).join('\n')
    lines.push(`export async function ${toCamel(tool.name)}(input, context) {\n  /**\n   * @register_tool ${tool.name}\n   * @description ${tool.description}${params ? '\n' + params : ''}\n   */\n  ${(tool.code ?? `throw new Error('Not implemented: ${tool.name}')`).replace(/\n/g, '\n  ')}\n}\n`)
  }
  for (const route of routes) {
    const fnName = toCamel(`${route.method.toLowerCase()}_${route.path.replace(/[^a-zA-Z0-9]/g, '_')}`)
    lines.push(`export async function ${fnName}(req, res, next, context) {\n  /**\n   * @register_router ${route.path}\n   * @method ${route.method}${route.description ? '\n   * @description ' + route.description : ''}\n   */\n  ${(route.code ?? `return { status: 200, data: { ok: true } }`).replace(/\n/g, '\n  ')}\n}\n`)
  }
  for (const hook of hooks) {
    const fnName = toCamel(`on_${hook.event.replace(/[^a-zA-Z0-9]/g, '_')}`)
    lines.push(`export function ${fnName}(payload, context) {\n  /**\n   * @register_hook ${hook.event}\n   */\n  ${(hook.code ?? `// handle ${hook.event}`).replace(/\n/g, '\n  ')}\n}\n`)
  }
  writeFileSync(join(pkgDir, 'index.js'), lines.join('\n'), 'utf8')
  
  
  writeFileSync(join(pkgDir, 'package.json'), JSON.stringify({ name, version: '1.0.0', description, type: 'module' }, null, 2), 'utf8')
  let activation = { attempted: false, reason: 'activation_unavailable' }
  try {
    const { getDefaultContainer } = await import('logos')
    const activate = getDefaultContainer().state('runtime').get('activatePackage')
    if (typeof activate === 'function') activation = { attempted: true, ...(await activate(name, 'creator')) }
  } catch (error) {
    activation = { attempted: false, reason: error.message }
  }
  invalidateCache()
  try { const newTools = await discoverRuntimeTools(); injectRuntimeTools(newTools) } catch { }
  return { success: true, package: name, path: `packages/${name}/`, files: ['package.json', 'index.js'], activation }
}

async function handleCreateTool({ name, description, code, mode, params = [], test_input = {} }) {
  if (!name || !code || !mode) return { success: false, error: 'name, code e mode são obrigatórios' }
  if (mode === 'sandbox') {
    const r = await runInSandbox(code, test_input)
    return { success: r.success, mode: 'sandbox', persisted: false, output: r.output, logs: r.logs, error: r.error }
  }
  if (mode === 'permanent') {
    const v = await runInSandbox(code, test_input)
    if (!v.success) return { success: false, mode: 'permanent', persisted: false, error: v.error }
    const fp = persistTool(name, description, params, code)
    const fn = async (input) => { const r = await runInSandbox(code, input); if (!r.success) throw new Error(r.error); return r.output }
    registerTool(name, { description, input_schema: buildSchema(params) }, fn, 'permanent', fp)
    return { success: true, mode: 'permanent', persisted: true, file: fp }
  }
  return { success: false, error: `Mode desconhecido: "${mode}"` }
}

async function handleRunTool({ name, input = {} }) {
  try {
    let output = await dispatchBuiltin(name, input)
    if (output === null) output = await invokeTool(name, input)
    return { success: true, output }
  }
  catch (e) { return { success: false, error: e.message } }
}

async function handleRunParallel({ tools = [] }) {
  if (!tools.length) return { success: false, error: 'Nenhuma tool fornecida' }
  const results = await Promise.allSettled(tools.map(async ({ name, input = {} }) => {
    if (name === 'run_parallel') throw new Error('run_parallel não pode ser aninhado')
    try { let r = await dispatchBuiltin(name, input); if (r === null) r = await invokeTool(name, input); return { name, success: true, output: r } }
    catch (e) { return { name, success: false, error: e.message } }
  }))
  return results.map(r => r.status === 'fulfilled' ? r.value : { success: false, error: r.reason?.message })
}


const SUBAGENT_SESSIONS = new Set() 
const SUBAGENT_RESULTS = new Map()  

async function handleSpawnAgent({ description, prompt, background = false, max_iterations, variant_id }) {
  const { session_id: parentSessionId } = getPrivilegedContext()
  if (SUBAGENT_SESSIONS.has(parentSessionId)) {
    return { success: false, error: 'Subagentes não podem chamar spawn_agent (profundidade máxima = 1).' }
  }

  const subSessionId = `sub:${parentSessionId}:${randomUUID()}`
  if (variant_id && !variantRegistry.get(variant_id)) {
    return { success: false, error: `Variante "${variant_id}" não encontrada.` }
  }
  SUBAGENT_SESSIONS.add(subSessionId)
  
  
  inheritPolicy(parentSessionId, subSessionId)
  const maxIterations = Math.min(max_iterations || 8, getMaxIterations())

  if (variant_id) {
    variantRegistry.bindSession(variant_id, subSessionId)
  }

  const run = async () => {
    const { runAgent, forgetSession } = await import('./agent.js')
    try {
      const result = await runAgent(prompt, subSessionId, null, null, { maxIterations })
      return { success: true, result }
    } catch (e) {
      return { success: false, error: e.message }
    } finally {
      SUBAGENT_SESSIONS.delete(subSessionId)
      forgetSession(subSessionId)
      
      
      
    }
  }

  if (!background) return await run()

  const handle = randomUUID()
  SUBAGENT_RESULTS.set(handle, { status: 'running', description, startedAt: new Date().toISOString() })
  const { openActivity, updateActivity } = await import('./activity_registry.js')
  const activity = openActivity({
    contributor: 'agent-agent', kind: 'spawn', ownerSessionId: parentSessionId,
    targetSessionId: subSessionId, groupId: `spawn:${parentSessionId}`,
    title: description, summary: 'Subagente trabalhando em segundo plano', capabilities: ['open'],
  })

  
  
  
  run().then((outcome) => {
    const prev = SUBAGENT_RESULTS.get(handle)
    SUBAGENT_RESULTS.set(handle, {
      status: outcome.success ? 'done' : 'error',
      description,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      startedAt: prev?.startedAt,
      finishedAt: new Date().toISOString(),
    })
    updateActivity(activity.id, {
      state: outcome.success ? 'success' : 'error',
      summary: outcome.success ? 'Resultado disponível na sessão do subagente' : outcome.error,
      result: outcome.result ?? null, error: outcome.error ?? null,
    })
    const summary = outcome.success ? 'Resultado disponível via get_agent_result.' : `Erro: ${outcome.error}`
    sendProactive(`Subagente "${description}" concluído (handle ${handle}). ${summary}`, 'log').catch(() => {})
  })

  return { success: true, background: true, handle, activity_id: activity.id, status: 'running' }
}

function handleGetAgentResult({ handle }) {
  const entry = SUBAGENT_RESULTS.get(handle)
  if (!entry) return { success: false, error: `Handle "${handle}" não encontrado` }
  return { success: true, handle, ...entry }
}











const ENGINEER_SYSTEM_PROMPT = `Você é um engenheiro de software sênior trabalhando diretamente no workspace do Agent OS, com acesso real a arquivos e shell via tools (read_file, write_file, patch_file, list_dir, run_shell, search_code, create_runtime_package — ver packages/engineer). Use-as de verdade: leia antes de editar, prefira patch_file a write_file em arquivos existentes, rode os testes/checks relevantes antes de declarar a tarefa concluída.

Se em algum momento precisar de uma decisão, confirmação ou informação que só o usuário humano real sabe (não o Agent, não você mesmo) — use a tool ask_user. Ela pausa a tarefa e espera a resposta chegar; pode levar minutos, tudo bem. Não invente a resposta nem prossiga com uma suposição arriscada quando isso for evitável com uma pergunta.

Você também pode falar com o usuário sem parar de trabalhar, com a tool say_to_user: a mensagem aparece na conversa dele na hora. Vale a pena em tarefa longa, quando você achar algo que muda o rumo do trabalho, ou quando tomar uma decisão que ele ia querer saber agora — não para narrar cada passo.

Ao terminar, responda com um resumo objetivo do que foi feito, o que foi verificado, e qualquer coisa que ficou pendente ou precisa de atenção humana depois.`

async function handleRunEngineerTask({ description, task, background = true, account = null }) {
  const config = getConfig()
  const cliSlots = buildSlots(config).filter(s => s.mode === 'cli' && s.provider === 'claude-cli')

  if (!cliSlots.length) {
    return { success: false, error: 'Nenhum pool "claude-cli" habilitado em agent.config.json — ver docblock de pool.cli em llm_keys.js.' }
  }

  let slot
  if (account) {
    slot = cliSlots.find(s => s.cli?.account === account)
    if (!slot) return { success: false, error: `Conta "${account}" não encontrada entre os slots claude-cli habilitados.` }
  } else {
    slot = getNextSlot(cliSlots)
  }

  const { session_id: parentSessionId } = getPrivilegedContext()
  const engineerSessionId = `engineer:${parentSessionId}:${randomUUID()}`

  const run = async () => {
    try {
      const data = await runCliSlot(slot, slot.model, {
        system: ENGINEER_SYSTEM_PROMPT,
        
        
        
        
        
        systemMode: 'append',
        messages: [{ role: 'user', content: task }],
        tools: [],
        extraEnv: {
          
          
          
          
          
          
          AGENT_SESSION_ID: parentSessionId,
          AGENT_ENGINEER_SESSION_ID: engineerSessionId, 
          AGENT_SESSION_TOKEN: getBridgeToken(),
          AGENT_BASE_URL: process.env.AGENT_BASE_URL || 'http://localhost:5040',
        },
      })
      reportSlotSuccess(slot.id)
      return { success: true, result: data.choices[0]?.message?.content ?? '' }
    } catch (e) {
      
      
      
      const noCredit = isCreditFailure(e)
      const state = reportSlotFailure(slot.id, e.message, {
        forceDisable: noCredit,
        reason: e.failureKind ?? null,
      })
      if (state.disabled) notifySlotDisabled(slot, noCredit ? 'sem crédito' : null).catch(() => { })
      return { success: false, error: e.message }
    }
  }

  if (!background) {
    const outcome = await run()
    return outcome.success
      ? { success: true, result: outcome.result, account: slot.cli?.account ?? null }
      : { success: false, error: outcome.error, account: slot.cli?.account ?? null }
  }

  const handle = randomUUID()
  SUBAGENT_RESULTS.set(handle, { status: 'running', description, startedAt: new Date().toISOString() })
  const { openActivity, updateActivity } = await import('./activity_registry.js')
  const activity = openActivity({
    contributor: 'agent-engineer', kind: 'process', ownerSessionId: parentSessionId,
    title: description, summary: 'Tarefa de engenharia em segundo plano', capabilities: [],
  })

  run().then((outcome) => {
    const prev = SUBAGENT_RESULTS.get(handle)
    SUBAGENT_RESULTS.set(handle, {
      status: outcome.success ? 'done' : 'error',
      description,
      result: outcome.result ?? null,
      error: outcome.error ?? null,
      startedAt: prev?.startedAt,
      finishedAt: new Date().toISOString(),
    })
    updateActivity(activity.id, {
      state: outcome.success ? 'success' : 'error',
      summary: outcome.success ? 'Resultado de engenharia disponível' : outcome.error,
      result: outcome.result ?? null, error: outcome.error ?? null,
    })
    const summary = outcome.success ? 'Resultado disponível via get_agent_result.' : `Erro: ${outcome.error}`
    sendProactive(`Engineer "${description}" concluído (handle ${handle}). ${summary}`, 'log').catch(() => {})
  })

  return { success: true, background: true, handle, activity_id: activity.id, status: 'running', account: slot.cli?.account ?? null }
}


const PKG_NAME_RE = /^[a-z0-9_-]+$/i

async function handleCreateVariant({ pkg, description }) {
  if (!PKG_NAME_RE.test(pkg)) return { success: false, error: `Nome de package inválido: "${pkg}"` }
  const { session_id: sessionId } = getPrivilegedContext()
  const id = randomUUID()

  try {
    const { worktreePath, branch } = variantWorktree.createWorktree({ id, pkg, description })
    const preview = await variantPreview.start({ worktreePath, id })
    variantRegistry.insert({
      id, pkg, branch, worktreePath, description,
      port: preview.port, url: preview.url, pid: preview.pid,
      status: preview.ready ? 'running' : 'starting',
      boundSessions: [sessionId],
      createdBy: sessionId,
      createdAt: new Date().toISOString(),
    })
    return {
      success: true, variant_id: id, pkg, branch, url: preview.url,
      status: preview.ready ? 'running' : 'starting',
      message: preview.ready
        ? `Variante criada. A partir de agora, read_file/write_file/patch_file/run_shell desta sessão operam em ${branch}. Preview em ${preview.url}.`
        : `Variante criada, preview ainda subindo — confira com preview_variant em alguns segundos.`,
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

function handleListVariants({ pkg, all = false } = {}) {
  const OPEN = new Set(['starting', 'running', 'ready'])
  const variants = variantRegistry.list({ pkg }).filter(v => all || OPEN.has(v.status))
  return {
    success: true, total: variants.length,
    variants: variants.map(v => ({
      variant_id: v.id, pkg: v.pkg, branch: v.branch, description: v.description,
      status: v.status, url: v.url, createdAt: v.createdAt,
    })),
  }
}

function handlePreviewVariant({ variant_id }) {
  const v = variantRegistry.get(variant_id)
  if (!v) return { success: false, error: `Variante "${variant_id}" não encontrada.` }
  return { success: true, variant_id, pkg: v.pkg, branch: v.branch, status: v.status, url: v.url }
}

async function handlePromoteVariant({ variant_id }) {
  const v = variantRegistry.get(variant_id)
  if (!v) return { success: false, error: `Variante "${variant_id}" não encontrada.` }
  if (v.status === 'promoted') return { success: false, error: 'Variante já foi promovida.' }

  variantRegistry.update(variant_id, { status: 'promoting' })
  try {
    variantPreview.stop(v.pid)
    variantWorktree.commitWork(v.worktreePath, v.pkg, `promote(${v.pkg}): ${v.description}`)
    variantWorktree.promoteIntoLive(v.worktreePath, v.pkg)
    variantWorktree.removeWorktree(v.worktreePath)
    variantRegistry.update(variant_id, { status: 'promoted', boundSessions: [] })
    return {
      success: true, variant_id, pkg: v.pkg,
      message: `"${v.pkg}" atualizado com o conteúdo de ${v.branch}. O hot-reload do runtime vai validar e trocar em alguns segundos (acompanhe em /variants/api/log?id=${variant_id} se algo falhar).`,
    }
  } catch (e) {
    variantRegistry.update(variant_id, { status: 'failed' })
    return { success: false, error: e.message }
  }
}

async function handleDiscardVariant({ variant_id }) {
  const v = variantRegistry.get(variant_id)
  if (!v) return { success: false, error: `Variante "${variant_id}" não encontrada.` }

  variantRegistry.update(variant_id, { status: 'discarding' })
  variantPreview.stop(v.pid)
  variantWorktree.removeWorktree(v.worktreePath)
  variantWorktree.deleteBranch(v.branch, { force: true })
  variantRegistry.update(variant_id, { status: 'discarded', boundSessions: [] })
  return { success: true, variant_id, message: `Variante de "${v.pkg}" descartada.` }
}

const handleListTools = () => [
  ...BUILTIN_SCHEMAS.map(t => ({ name: t.name, description: t.description, mode: t._runtime ? 'runtime' : 'builtin', package: t._package ?? null })),
  ...listToolSchemas().filter(t => t.mode !== 'builtin').map(t => ({ name: t.name, description: t.description, mode: t.mode })),
]

const handleDeleteTool = ({ name }) => {
  if (PROTECTED.has(name)) return { success: false, error: `"${name}" é um builtin protegido.` }
  deleteTool(name); return { success: true, deleted: name }
}

async function handleSetProvider({ provider, model, base_url, api_key, persist = true }) {
  try {
    
    setSlotOverride({ provider, model, base_url, api_key })
 
    
    if (persist) {
      const { persistProviderConfig } = await import('../llm/provider.js')
      persistProviderConfig({ provider, model, base_url, api_key })
    }
 
    
    const { getConfig } = await import('../utils/config.js')
    const slots  = buildSlots(getConfig())
    const active = slots[0] 
 
    return {
      success:   true,
      active:    { provider: active.provider, model: active.model, pool: active.poolName },
      persisted: persist,
    }
  } catch (e) {
    return { success: false, error: e.message }
  }
}

async function handleSetModel({ model, persist = true }) {
  try {
    setProviderOverride({ model })
    if (persist) persistProviderConfig({ model })
    return { success: true, model, persisted: persist }
  } catch (e) { return { success: false, error: e.message } }
}

function handleGetProvider() {
  try { const r = resolveProvider(); return { success: true, provider: r.provider, model: r.model } }
  catch (e) { return { success: false, error: e.message } }
}

async function handleListModels({ provider, base_url, api_key } = {}) {
  const { provider: active } = resolveProvider()
  return listProviderModels(provider ?? active, { base_url, api_key })
}

async function handleRemember({ fact, entity, type }) {
  try {
    const res = await memoryRemember({ content: fact, entity, type: type || 'fact' })
    return { success: true, stored: fact, entity: res.entity }
  } catch (e) { return { success: false, error: e.message } }
}
async function handleRecall({ query, limit = 5, entity }) {
  try { return { success: true, results: await memoryRecall(query, { limit, entity }) } }
  catch (e) { return { success: false, error: e.message } }
}
async function handleForget({ query }) {
  const { removed } = await memoryForget(query)
  return { success: true, removed_lines: removed, query }
}
async function handleMemoryRelate({ from, type, to }) {
  return memoryRelate(from, type, to)
}

async function handleNotify({ message, channel }) {
  try { return { success: true, results: await sendProactive(message, channel ?? null) } }
  catch (e) { return { success: false, error: e.message } }
}

function handleGetSecret({ provider }) {
  const file = join(AGENT_DIR, 'secrets', `${provider}.json`)
  if (!existsSync(file)) return { success: false, error: `Sem token para "${provider}".` }
  try { const s = JSON.parse(readFileSync(file, 'utf8')); return { success: true, provider, ...s } }
  catch (e) { return { success: false, error: e.message } }
}

async function handlePlanObjective({ objective, context = '' }) {
  try {
    const prompt = `Decomponha o objetivo em tasks atômicas. JSON: { "objetivo": string, "tasks": [...] }\nObjetivo: ${objective}${context ? `\nContexto: ${context}` : ''}`
    const res = await callLLM({ system: 'Planejador. Apenas JSON válido.', messages: [{ role: 'user', content: prompt }], tools: [] })
    const raw = res.choices?.[0]?.message?.content?.trim() ?? '{}'
    return { success: true, plan: JSON.parse(raw.replace(/^```(?:json)?|```$/gm, '').trim()) }
  } catch (e) { return { success: false, error: e.message } }
}

function handleFileHistory({ path: p } = {}) {
  try {
    if (!p) return { success: true, tracked: listAllTracked() }
    const history = listHistory(p)
    if (!history.length) return { success: true, path: p, versions: [], note: 'Nenhum snapshot.' }
    return { success: true, path: p, versions: history.map((e, i) => ({ index: i, timestamp: e.timestamp })) }
  } catch (e) { return { success: false, error: e.message } }
}

function handleFileRestore({ path: p, index = 0, clear = false }) {
  try {
    const result = restoreVersion(p, index)
    if (!result.success) return result
    if (clear) clearHistory(p)
    return { ...result, history_cleared: clear }
  } catch (e) { return { success: false, error: e.message } }
}

const HANDLERS = {
  create_tool: handleCreateTool,
  run_tool: handleRunTool,
  run_parallel: handleRunParallel,
  spawn_agent: handleSpawnAgent,
  get_agent_result: handleGetAgentResult,
  run_engineer_task: handleRunEngineerTask,
  create_variant: handleCreateVariant,
  list_variants: handleListVariants,
  preview_variant: handlePreviewVariant,
  promote_variant: handlePromoteVariant,
  discard_variant: handleDiscardVariant,
  list_tools: handleListTools,
  delete_tool: handleDeleteTool,
  reset_infra: handleResetInfra,
  health: handleHealth,
  set_provider: handleSetProvider,
  set_model: handleSetModel,
  get_provider: handleGetProvider,
  list_models: handleListModels,
  run_runtime_tool: handleRunRuntimeTool,
  list_runtime_tools: handleListRuntimeTools,
  request_tool_access: handleRequestToolAccess,
  list_runtime_routes: handleListRuntimeRoutes,
  create_runtime_package: handleCreateRuntimePackage,
  remember: handleRemember,
  recall: handleRecall,
  forget: handleForget,
  memory_relate: handleMemoryRelate,
  notify: handleNotify,
  get_secret: handleGetSecret,
  plan_objective: handlePlanObjective,
  read_file: handleReadFile,
  write_file: handleWriteFile,
  patch_file: handlePatchFile,
  list_dir: handleListDir,
  search_code: handleSearchCode,
  reload_config: handleReloadConfig,
  file_history: handleFileHistory,
  file_restore: handleFileRestore,
  push_to_front: handlePushToFront,
  get_dom_snapshot: handleGetDomSnapshot,
  get_os_context: handleGetOsContext,
  run_ui_action: handleRunUiAction,
  list_active_sessions: handleListActiveSessions,
};

export async function dispatchBuiltin(name, input, hostContext = {}) {
  if (HANDLERS[name]) return await HANDLERS[name](input, hostContext)
  if (_runtimeToolHandlers.has(name)) {
    try { return await _runtimeToolHandlers.get(name)(input) }
    catch (e) { return { success: false, error: e.message } }
  }
  return null
}
export async function loadPersistedTools() { return _load() }
export { setPrivilegedContext }
