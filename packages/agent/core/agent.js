import { readEvidence, captureToolResult } from './bag_evidence.js'
import { compactBagReads, compactArchivedReads, compactHistoryToBudget, refreshOperationalBag } from './bag_context.js'
import { loadBagForPrompt } from './bag_legacy.js'
import {randomUUID} from 'node:crypto';
import {openTurnTools} from './turn_tools.js';
import {selectExecutionTools,assertExecutionTool} from './execution_policy.js';
import { extendAllowlist, getGrantedToolNames, consumeGrantedTool } from './tool_access.js';
import {applyToolSelectionHook} from './tool_selection_hook.js';
import {buildRecentUserContext} from './conversation_context.js';
import { readFileSync, existsSync, readdirSync, statSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import {
  callLLM, callLLMStream, parseResponse,
  buildAssistantMessage, buildToolResultMessage
} from '../llm/llm.js'
import {
  getMessages, replaceMessagesAsync, getSummaryContext, pushMessageAsync as pushMessage,
  compressIfNeeded, compressFacts,
  getScheduledTasks, getSession
} from '../memory/session.js'
import { maybeTitleSession } from './session_title.js'
import { getSessionSettings, DEFAULT_CONFIRMATION_MESSAGE } from './session_settings.js'
import { notifySessionsUpdated } from './chat_bus.js'
import { listConnectedFronts } from './chat_bus.js'
import { contextRefiner } from './context_refiner.js'
import {
  BUILTIN_SCHEMAS, dispatchBuiltin,
  loadPersistedTools, setPrivilegedContext,
  injectRuntimeTools, clearInjectedRuntimeTools,
  getPendingReset, clearPendingReset, executeReset
} from './builtin_tools.js'
import { listToolSchemas, invokeTool } from './registry.js'
import { getMaxIterations, getConfig } from '../utils/config.js'
import { sendProactive } from '../channels/channels.js'
import { getSchedulerConfig } from '../utils/config.js'
import { listHistory, restoreVersion } from '../memory/history.js'
import { formatMessageForModel, normalizeMessageMetadata } from './message_metadata.js'
import { nowInTz, nowLabel, dowLabel } from '../utils/timezone.js'
import { getTurnUsage } from './turn_usage.js'
import { warmPricing } from './turn_cost.js'
import { getMetacognition } from './metacognition.js'
import { getMetacore } from './metacore.js'
import { discoverRuntimeTools, getRuntimeCatalog, discoverRuntimeContexts, invokeRuntimeTool } from './runtime_bridge.js'
import { resolveProvider } from '../llm/provider.js'
import { getFactsText } from '../../memory/lib/graph.js'
import { drain as drainQueue } from './message_queue.js'
import { eventCall as $, getHostProxy } from '../host/agent_host.js'
import inflectPkg from 'inflect'
import { composeSkills } from './skills.js'
import { decideSkillRecomposition } from '../../classification/skill-recomposition.js'
import { loadPromptParts } from './prompt_parts.js'
import { evaluateAction as evaluateGovernanceAction, claimApprovedAction } from '../../governance/service.js'
import { isReadOnly as isGovernanceReadOnly } from '../../governance/lib/engine.js'
import { getModelOverride, setModelOverride } from './session_model.js'
import { getLevel as getApproximationLevel } from '../../classification/approximation.js'
import { buildInputTrace, measureInputSegments } from './input_trace.js'
import { durableRuns } from './durable_runs.js'
import { recordBagEvent, operationalBagPrompt, retrieveBagEvidence, updateBagCheckpoint, availableBagEvidence, BAG_TOOL_SCHEMA, BAG_CHECKPOINT_SCHEMA } from './bag_runtime.js'
import { normalizeToolOutcome, toolOutcomeError, legacyToolResult, publicToolOutcome } from './tool_outcome.js'
import { createTurnContext, createIterationContext, createToolContext, correlationFields } from './execution_context.js'
import { TurnCoordinator, RunJournal, OutcomeEvaluator } from './execution_kernel.js'
import { ContextCompiler, promptFragment } from './context_compiler.js'
import { ModelGateway } from '../llm/model_gateway.js'
import { ensureOperationId, resolveRecoveryPolicy, recoveryInstruction } from './recovery_policy.js'
import { classifyUserFeedback, normalizeDistillation } from './learning_signals.js'
import { resolveSessionSpecialist } from '../../specialists/lib/session.js'
import { composePrompt as composeSpecialistPrompt, resolveModelSpec as resolveSpecialistModelSpec, getSpecialistById } from '../../specialists/lib/catalog.js'
import { injectToolSession } from './tool_session.js'
import { stabilityReceipts } from './stability_receipts.js'
import { withRetry } from './retry.js'

const { renderTemplate } = inflectPkg
const tokenEstimate = (value) => Math.ceil(String(value || '').length / 4)
const modelGateway = new ModelGateway({ call: callLLM, stream: callLLMStream })


function shellPatternsForHook(command) {
  if (typeof command !== 'string' || command.length > 2_000 || /[\r\n`$]|\b(token|secret|password|api[_-]?key|authorization|bearer|cookie|credential)\b/i.test(command)) return []
  const patterns = []
  for (const part of command.split(/(?:&&|\|\||;|\|)/)) {
    const [executable, ...args] = part.trim().split(/\s+/).filter(Boolean)
    if (!executable || !/^[a-z][a-z0-9_-]{0,31}$/i.test(executable)) continue
    const stable = args.filter(arg => /^--[a-z][a-z0-9-]{0,31}$/i.test(arg) || /^-[a-zA-Z]{1,12}$/.test(arg) || /^[a-z][a-z0-9-]{0,31}$/i.test(arg)).slice(0, 6)
    const pattern = [executable, ...stable].join(' ')
    if (pattern.length <= 180 && !patterns.includes(pattern)) patterns.push(pattern)
  }
  return patterns.slice(0, 4)
}



let _systemTpl
function loadSystemTpl() {
  if (_systemTpl !== undefined) return _systemTpl
  try {
    _systemTpl = readFileSync(join(AGENT_DIR, 'prompts', 'system.inflect'), 'utf8')
  } catch {
    _systemTpl = null
  }
  return _systemTpl
}


export const activeSessions = new Set()



let _bot = null
export function getBot() { return _bot }

let _sessionContexts = new Map()
const _classifiedTools = new Map() 
const _resolvedModels = new Map() 
const _maxIterOverrides = new Map() 



const _activeSpecialist = new Map() 
let _contextsMetaCache = null
let _contextsMetaMtimeHash = null

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(PKG_DIR, '..')
const PROJECT_DIR = resolve(PKG_DIR, '..', '..', '..')
const PACKAGES_DIR = join(PROJECT_DIR, 'packages')




function loadAlwaysIncludeTools() {
  try {
    const raw = readFileSync(join(PACKAGES_DIR, 'classification', 'always-include-tools.json'), 'utf8')
    return Object.values(JSON.parse(raw)).flat()
  } catch (e) {
    console.warn('[Agent] Falha ao carregar always-include-tools.json:', e.message)
    return []
  }
}
const ALWAYS_INCLUDE_TOOLS = loadAlwaysIncludeTools()

async function refreshRuntimeTools() {
  try {
    
    

    
    const runtimeTools = await discoverRuntimeTools()

    if (runtimeTools.length) {
      clearInjectedRuntimeTools()
      injectRuntimeTools(runtimeTools)
      
      
    }
  } catch (e) {
    console.warn('[Agent] Falha na atualização dinâmica de tools:', e.message)
  }
}

function computeContextMtimeHash() {
  if (!existsSync(PACKAGES_DIR)) return ''
  const parts = []
  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    if (dir === 'agent') continue
    const pkgPath = join(PACKAGES_DIR, dir)
    if (!statSync(pkgPath).isDirectory()) continue
    try {
      for (const file of readdirSync(pkgPath).sort()) {
        if (!file.endsWith('.js')) continue
        const abs = join(pkgPath, file)
        const mtime = statSync(abs).mtimeMs
        parts.push(`${dir}/${file}:${mtime}`)
      }
    } catch { }
  }
  return parts.join('|')
}

async function getContextsMeta() {
  const currentHash = computeContextMtimeHash()
  if (_contextsMetaCache && _contextsMetaMtimeHash === currentHash) {
    return _contextsMetaCache
  }
  const contexts = await discoverRuntimeContexts()
  _contextsMetaCache = contexts
  _contextsMetaMtimeHash = currentHash
  return contexts
}

async function updateContexts(sessionId) {
  const meta = await getContextsMeta()
  if (!meta.length) return ''
  let sess = _sessionContexts.get(sessionId)
  const now = Date.now()
  if (!sess) {
    sess = { contexts: new Map() }
    _sessionContexts.set(sessionId, sess)
  }
  for (const ctx of meta) {
    const entry = sess.contexts.get(ctx.name)
    const expiresAt = entry ? entry.expiresAt : 0
    if (!entry || now >= expiresAt) {
      try {
        const value = await ctx.call({ sessionId })
        const expiresAtNew = now + (ctx.ttl * 1000)
        sess.contexts.set(ctx.name, { value, expiresAt: expiresAtNew, priority: ctx.priority, name: ctx.name, ttl: ctx.ttl, lastAccessed: now })
      } catch (e) {
        console.warn(`[contexts] falha em ${ctx.name}: ${e.message}`)
      }
    }
  }
  const sorted = Array.from(sess.contexts.values()).sort((a, b) => b.priority - a.priority)

  
  const allContexts = sorted.map(entry => ({
    name: entry.name,
    value: entry.value,
    lastAccessed: entry.lastAccessed || now,
    priority: entry.priority,
  }))

  
  
  
  const activeTopic = buildRecentUserContext(getMessages(sessionId))

  
  try {
    const { kept } = contextRefiner.pruneStale(allContexts)

    if (activeTopic.length >= 3 && kept.length > 5) {
      
      const tailored = await contextRefiner.buildTailoredContext(
        { facts: '', summary: '', runtimeContexts: kept },
        activeTopic
      )
      if (tailored.runtimeContexts) {
        return tailored.runtimeContexts
      }
    }

    
    return kept.slice(0, 5).map(entry => `[Context: ${entry.name}] ${entry.value}`).join('\n')
  } catch (e) {
    console.warn('[ContextRefiner] Falha no updateContexts, usando fallback:', e.message)
    return sorted.slice(0, 5).map(entry => `[Context: ${entry.name}] ${entry.value}`).join('\n')
  }
}

function finalizeForAPI(messages) {
  return messages.map(msg => {
    const clean = { role: msg.role, content: formatMessageForModel(msg) }
    if (msg.tool_calls) clean.tool_calls = msg.tool_calls.map(tc => ({
      id: tc.id,
      type: 'function',
      function: {
        name: tc.function?.name ?? tc.name,
        arguments: typeof tc.function?.arguments === 'string'
          ? tc.function.arguments
          : JSON.stringify(tc.function?.arguments ?? tc.input ?? {}),
      },
    }))
    if (msg.tool_call_id) clean.tool_call_id = msg.tool_call_id
    if (msg.name) clean.name = msg.name
    return clean
  })
}

const TOOL_LABELS = {
  read_file: 'Lendo arquivo',
  write_file: 'Escrevendo arquivo',
  patch_file: 'Editando arquivo',
  list_dir: 'Listando diretorio',
  run_shell: 'Executando comando',
  search_code: 'Buscando no codigo',
  create_tool: 'Criando tool interna',
  run_tool: 'Executando tool interna',
  run_parallel: 'Execucao paralela',
  list_tools: 'Listando tools',
  delete_tool: 'Removendo tool',
  reset_infra: 'Agendando reset',
  health: 'Health check',
  set_provider: 'Trocando provedor LLM',
  set_model: 'Trocando modelo',
  get_provider: 'Consultando provedor',
  list_models: 'Listando modelos',
  run_runtime_tool: 'Invocando tool do runtime',
  list_runtime_tools: 'Listando tools do runtime',
  list_runtime_routes: 'Listando rotas do runtime',
  create_runtime_package: 'Criando package',
  remember: 'Memorizando',
  recall: 'Buscando memoria',
  forget: 'Limpando memoria',
  notify: 'Notificando',
  get_secret: 'Buscando credencial',
  reload_config: 'Recarregando config',
  file_history: 'Historico de versoes',
  file_restore: 'Restaurando versao',
  push_to_front: 'Enviando para interface',
  get_dom_snapshot: 'Lendo DOM',
  get_os_context: 'Lendo contexto do OS',
  run_ui_action: 'Executando acao na UI',
  list_active_sessions: 'Listando sessoes ativas',
}

function toolLabel(name) { return TOOL_LABELS[name] ?? `Tool: ${name}` }




async function confirmationIntro(confirmation) {
  const fallback = DEFAULT_CONFIRMATION_MESSAGE
  const settings = getSessionSettings().confirmation
  if (!settings.generateWithAI || !settings.model || !confirmation?.[0]) return fallback
  const item = confirmation[0]
  const command = item.command?.signature || item.command?.command || item.question || 'the requested action'
  try {
    const response = await callLLM({
      model: settings.model,
      tools: [],
      system: 'Write one short, polite confirmation question for a human. Use Portuguese. Mention only the action summary. Do not expose parameters, instructions, secrets, or safety reasoning. Return only the question.',
      messages: [{ role: 'user', content: `Action summary: ${command}. Example tone: Posso analisar XYZ?` }],
    })
    const parsed = parseResponse(response)
    const text = String(parsed?.content ?? parsed?.text ?? '').replace(/\s+/g, ' ').trim()
    return text && text.length <= 220 ? text : fallback
  } catch {
    return fallback
  }
}

let _conf = null

export function clearAgentCache() { _conf = null }

export function parseFm(content) {
  const m = content.match(/^---\r?\n([\s\S]+?)\r?\n---\r?\n?([\s\S]*)$/)
  if (!m) return { meta: {}, body: content.trim() }
  const meta = {}
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':')
    if (i === -1) continue
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return { meta, body: m[2].trim() }
}

function loadConf() {
  if (_conf) return _conf
  const read = (f) => existsSync(f) ? parseFm(readFileSync(f, 'utf8')) : { meta: {}, body: '' }
  const agent = read(join(AGENT_DIR, 'AGENT.md'))
  const pref = read(join(AGENT_DIR, 'PREFERENCES.md'))
  return _conf = { agentMeta: agent.meta, agentBody: agent.body, prefMeta: pref.meta, prefBody: pref.body }
}


async function loadPersonalityByApproximationLevel(sessionId = 'default') {
  const { agentMeta } = loadConf()
  const name = agentMeta?.name ?? 'Agent'

  
  const approximationLevel = await getApproximationLevel(sessionId)
  
  return loadPromptParts({
    root: AGENT_DIR, level: approximationLevel, name,
    fallback: () => loadConf().agentBody,
  })
}

function getWorkspaceSnapshot() {
  const pkgsDir = join(PROJECT_DIR, 'packages')
  if (!existsSync(pkgsDir)) return ''
  const SKIP = ['node_modules', '.git', 'dist', '.turbo', 'generated', 'sessions', 'embeddings.json']
  const lines = ['[Workspace — packages/]']
  for (const pkg of readdirSync(pkgsDir)) {
    const pkgPath = join(pkgsDir, pkg)
    if (!statSync(pkgPath).isDirectory()) continue
    lines.push(`\npackage: ${pkg}${pkg === 'agent' ? ' ↑ Agent (voce)' : ''}`)
    const pj = join(pkgPath, 'package.json')
    if (existsSync(pj)) {
      try {
        const { description, version } = JSON.parse(readFileSync(pj, 'utf8'))
        if (description) lines.push(`  desc: ${description}`)
        if (version) lines.push(`  version: ${version}`)
      } catch { }
    }
    for (const f of readdirSync(pkgPath)) {
      if (SKIP.includes(f)) continue
      const abs = join(pkgPath, f)
      const stat = statSync(abs)
      if (stat.isFile() && /\.(js|ts|md|json)$/.test(f)) lines.push(`  ${f}`)
      else if (stat.isDirectory()) lines.push(`  ${f}/`)
    }
  }
  return lines.join('\n')
}

function getWorkspaceIndex() {
  const pkgsDir = join(PROJECT_DIR, 'packages')
  if (!existsSync(pkgsDir)) return ''
  const packages = readdirSync(pkgsDir).filter(pkg => {
    try { return statSync(join(pkgsDir, pkg)).isDirectory() } catch { return false }
  })
  return `[Workspace packages: ${packages.join(', ')}]\nDetalhes sob demanda via busca local e catálogo de runtime.`
}

/**
 * Workspace snapshot filtrado: inclui apenas packages que aparecem em
 * tools/contexts usados nas últimas N iterações da sessão.
 * Fallback: se não há histórico suficiente, retorna snapshot completo.
 */
function getFilteredWorkspaceSnapshot(sessionId, recentIterations = 5) {
  try {
    const messages = getMessages(sessionId)
    if (!messages.length) return getWorkspaceIndex()

    
    const recentAssistantMsgs = messages
      .filter(m => m.role === 'assistant')
      .slice(-recentIterations)

    const usedTools = new Set()
    for (const msg of recentAssistantMsgs) {
      if (Array.isArray(msg.tool_calls)) {
        for (const tc of msg.tool_calls) {
          if (tc.function?.name) usedTools.add(tc.function.name)
        }
      }
    }

    
    const relevantPackages = new Set()
    for (const toolName of usedTools) {
      if (['read_file', 'write_file', 'patch_file', 'list_dir', 'run_shell', 'search_code', 'create_runtime_package'].includes(toolName)) {
        relevantPackages.add('engineer')
      }
      if (toolName.startsWith('browser_')) relevantPackages.add('navegador')
      if (['createTask', 'updateTask', 'deleteTask', 'listTasks', 'getTask', 'runAutoCycle'].includes(toolName)) {
        relevantPackages.add('tasks')
      }
      if (['getActiveApps', 'get_battery', 'get_system_status', 'getCurrentWirelessConnection'].includes(toolName)) {
        relevantPackages.add('shell')
      }
      if (toolName.startsWith('moondream')) relevantPackages.add('moondream')
      if (toolName.startsWith('telegram')) relevantPackages.add('telegram')
      if (['spawn_agent', 'spawn_parallel', 'list_agent_runs', 'get_agent_result'].includes(toolName)) {
        relevantPackages.add('delegatus')
      }
      if (['getAgentConfig', 'updateAgentConfig'].includes(toolName)) relevantPackages.add('agent-config')
      if (['create_tool', 'run_tool', 'list_sandbox_tools', 'delete_tool'].includes(toolName)) {
        relevantPackages.add('sandbox')
      }
    }

    
    relevantPackages.add('agent')

    
    if (relevantPackages.size <= 2) return getWorkspaceIndex()

    
    const pkgsDir = join(PROJECT_DIR, 'packages')
    if (!existsSync(pkgsDir)) return ''
    const SKIP = ['node_modules', '.git', 'dist', '.turbo', 'generated', 'sessions', 'embeddings.json']
    const lines = ['[Workspace — packages/]']
    for (const pkg of readdirSync(pkgsDir)) {
      if (!relevantPackages.has(pkg)) continue
      const pkgPath = join(pkgsDir, pkg)
      if (!statSync(pkgPath).isDirectory()) continue
      lines.push(`\npackage: ${pkg}${pkg === 'agent' ? ' ↑ Agent (voce)' : ''}`)
      const pj = join(pkgPath, 'package.json')
      if (existsSync(pj)) {
        try {
          const { description, version } = JSON.parse(readFileSync(pj, 'utf8'))
          if (description) lines.push(`  desc: ${description}`)
          if (version) lines.push(`  version: ${version}`)
        } catch { }
      }
      for (const f of readdirSync(pkgPath)) {
        if (SKIP.includes(f)) continue
        const abs = join(pkgPath, f)
        const stat = statSync(abs)
        if (stat.isFile() && /\.(js|ts|md|json)$/.test(f)) lines.push(`  ${f}`)
        else if (stat.isDirectory()) lines.push(`  ${f}/`)
      }
    }
    return lines.join('\n')
  } catch (e) {
    console.warn('[ContextRefiner] Falha ao filtrar workspace snapshot:', e.message)
    return getWorkspaceSnapshot()
  }
}








function sanitizeMessages(messages) {
  const out = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      
      const seen = new Set()
      const calls = msg.tool_calls.filter(tc => tc.id && !seen.has(tc.id) && seen.add(tc.id))
      const { tool_calls, ...rest } = msg
      if (calls.length === 0) { out.push(rest); continue }
      
      const byId = new Map()
      let j = i + 1
      while (j < messages.length && messages[j].role === 'tool') {
        const t = messages[j]
        if (seen.has(t.tool_call_id) && !byId.has(t.tool_call_id)) byId.set(t.tool_call_id, t)
        j++
      }
      out.push({ ...rest, tool_calls: calls })
      for (const tc of calls) {
        out.push(byId.get(tc.id) ?? {
          role: 'tool',
          tool_call_id: tc.id,
          content: '[tool result indisponível — execução interrompida antes do resultado]',
        })
      }
      i = j - 1
      continue
    }
    
    
    if (msg.role === 'tool') continue
    out.push(msg)
  }
  const firstUser = out.findIndex(m => m.role === 'user')
  return firstUser > 0 ? out.slice(firstUser) : out
}

const INTERRUPTED_TOOL_RESULT = '[tool result unavailable: execution was interrupted before a durable result was recorded]'






function missingToolResults(messages, skipIds = new Set()) {
  const missing = []
  for (let i = 0; i < messages.length; i++) {
    const assistant = messages[i]
    if (assistant.role !== 'assistant' || !Array.isArray(assistant.tool_calls) || assistant.tool_calls.length === 0) continue
    const expected = new Set(assistant.tool_calls.map(call => call?.id).filter(Boolean))
    const present = new Set()
    let cursor = i + 1
    while (cursor < messages.length && messages[cursor]?.role === 'tool') {
      if (expected.has(messages[cursor].tool_call_id)) present.add(messages[cursor].tool_call_id)
      cursor++
    }
    for (const id of expected) {
      if (!present.has(id) && !skipIds.has(id)) missing.push(id)
    }
    i = cursor - 1
  }
  return missing
}







function terminalMissingToolCalls(messages) {
  let end = messages.length
  while (end > 0 && messages[end - 1]?.role === 'tool') end--
  const assistant = messages[end - 1]
  if (assistant?.role !== 'assistant' || !Array.isArray(assistant.tool_calls) || !assistant.tool_calls.length) return []

  const answered = new Set()
  for (let cursor = end; cursor < messages.length && messages[cursor]?.role === 'tool'; cursor++) {
    answered.add(messages[cursor].tool_call_id)
  }
  return assistant.tool_calls
    .filter(call => call?.id && !answered.has(call.id))
    .map(call => {
      let input = call.input
      if (input == null) {
        const raw = call.function?.arguments
        if (typeof raw === 'string') {
          try { input = JSON.parse(raw) } catch { input = {} }
        } else input = raw ?? {}
      }
      return { id: call.id, name: call.name || call.function?.name, input }
    })
    .filter(call => call.name)
}

async function repairMissingToolResults(sessionId, { skipIds = new Set() } = {}) {
  const original = getMessages(sessionId)
  const missing = missingToolResults(original, skipIds)
  if (!missing.length) return missing

  const repaired = []
  for (let i = 0; i < original.length; i++) {
    const message = original[i]
    repaired.push(message)
    if (message.role !== 'assistant' || !Array.isArray(message.tool_calls) || !message.tool_calls.length) continue
    const calls = message.tool_calls.filter(call => call?.id)
    const expected = new Set(calls.map(call => call.id))
    const results = new Map()
    let cursor = i + 1
    while (cursor < original.length && original[cursor]?.role === 'tool') {
      const result = original[cursor]
      if (expected.has(result.tool_call_id) && !results.has(result.tool_call_id)) results.set(result.tool_call_id, result)
      cursor++
    }
    
    
    for (const call of calls) {
      const result = results.get(call.id)
      if (result) repaired.push(result)
      else if (!skipIds.has(call.id)) repaired.push(buildToolResultMessage(call.id, INTERRUPTED_TOOL_RESULT, true))
    }
    i = cursor - 1
  }
  await replaceMessagesAsync(sessionId, repaired)
  return missing
}

let _bootPromise = null
let _durableRecoveryTimer = null
let _durableRecoveryScanning = false

export async function recoverDurableRuns() {
  if (_durableRecoveryScanning) return []
  _durableRecoveryScanning = true
  const recovered = []
  try {
    for (const candidate of durableRuns.listRecoverable()) {
      if (candidate.origin === 'presence') {
        durableRuns.fail(candidate.id, 'Iniciativa proativa interrompida; requer reconciliação, sem repetição automática.');
        continue;
      }
      if (activeSessions.has(candidate.sessionId)) continue
      const run = durableRuns.claim(candidate.id)
      if (!run) continue
      const recoveryTool = run.inFlightTool
        ? { ...run.inFlightTool, recoveryPolicy: run.inFlightTool.recoveryPolicy || recoveryPolicyFor(run.inFlightTool) }
        : null
      if (recoveryTool?.recoveryPolicy === 'reconcile' && recoveryTool.reconcileTool) {
        try {
          let reconciliation = await dispatchBuiltin(recoveryTool.reconcileTool, {
            operationId: recoveryTool.operationId,
            originalTool: recoveryTool.name,
            originalInput: recoveryTool.input,
          })
          if (reconciliation === null) reconciliation = await invokeTool(recoveryTool.reconcileTool, {
            operationId: recoveryTool.operationId,
            originalTool: recoveryTool.name,
            originalInput: recoveryTool.input,
          })
          recoveryTool.reconciliation = normalizeToolOutcome(reconciliation, { operationId: recoveryTool.operationId })
          $('agent:reconciled', { runId: run.id, sessionId: run.sessionId, tool: recoveryTool.name, reconciliation: recoveryTool.reconciliation })
        } catch (error) {
          recoveryTool.reconciliation = toolOutcomeError(error, { operationId: recoveryTool.operationId, category: 'reconciliation' })
        }
      }
      recovered.push(run.id)
      $('agent:recovering', {
        runId: run.id,
        sessionId: run.sessionId,
        checkpoint: run.checkpoint,
        inFlightTool: recoveryTool,
        attempts: run.attempts,
      })
      runAgent(run.message, run.sessionId, progress => {
        $('agent:recovery-progress', { runId: run.id, sessionId: run.sessionId, progress })
      }, null, {
        resume: true,
        durableRunId: run.id,
        maxIterations: run.maxIterations,
        recoveryTool,
        recoveryNotice: recoveryNoticeFor(recoveryTool),
      }).then(response => {
        $('agent:recovered', { runId: run.id, sessionId: run.sessionId, response })
      }).catch(error => {
        console.error(`[Agent] Falha ao recuperar execução ${run.id}:`, error.message)
        $('agent:recovery-failed', { runId: run.id, sessionId: run.sessionId, error: error.message })
      })
    }
  } finally {
    _durableRecoveryScanning = false
  }
  return recovered
}

function schemaForTool(name) {
  return [...BUILTIN_SCHEMAS, BAG_TOOL_SCHEMA, BAG_CHECKPOINT_SCHEMA, ...listToolSchemas()].find(schema => schema.name === name) || {}
}

function recoveryPolicyFor(toolCall) {
  return resolveRecoveryPolicy(toolCall, schemaForTool(toolCall?.name), {
    isReadOnly: toolCall ? isGovernanceReadOnly({ tool: toolCall.name, input: toolCall.input }) : false,
  })
}

function recoveryNoticeFor(toolCall) {
  const instruction = recoveryInstruction(toolCall)
  if (!instruction || !toolCall.reconciliation) return instruction
  const detail = toolCall.reconciliation.ok
    ? JSON.stringify(toolCall.reconciliation.value)
    : `falhou: ${toolCall.reconciliation.error?.message}`
  return `${instruction} Resultado da reconciliação: ${detail}`
}

function startDurableRecovery() {
  if (_durableRecoveryTimer) return
  recoverDurableRuns().catch(error => console.warn('[Agent] Recovery scanner falhou:', error.message))
  _durableRecoveryTimer = setInterval(() => {
    recoverDurableRuns().catch(error => console.warn('[Agent] Recovery scanner falhou:', error.message))
  }, Math.max(1_000, Math.floor(durableRuns.leaseMs / 3)))
  _durableRecoveryTimer.unref?.()
}

export async function boot() {
  /**
   * @register_hook boot
   */
  if (_bootPromise) return _bootPromise
  _bootPromise = (async () => {
    const n = await loadPersistedTools()
    if (n > 0) console.log(`[Agent] ${n} persisted tool(s) loaded.`)
    try {
      const runtimeTools = await discoverRuntimeTools()
      if (runtimeTools.length) {
        injectRuntimeTools(runtimeTools)
        console.log(`[Agent] ${runtimeTools.length} runtime tool(s) injetadas como nativas.`)
      }
    } catch (e) { console.warn('[Agent] Falha ao injetar runtime tools:', e.message) }
    startDurableRecovery()
  })()
  return _bootPromise
}



async function resolveActiveSessionId(preferredSessionId = 'default') {
  const fronts = listConnectedFronts()
  if (!fronts.length) return null
  return fronts.find(front => front.activeChatSessionId === preferredSessionId)?.activeChatSessionId
    ?? fronts[0].activeChatSessionId
    ?? preferredSessionId
}



/**
 * Le o grafo de memoria (packages/memory) e retorna o texto cru das
 * observacoes. Usada pelo bloco de refinamento para evitar regex fragil
 * sobre summaryContext. Antes lia facts.md direto do disco, contornando
 * agent/memory/session.js — agora chama o mesmo getFactsText() que
 * session.js usa, ja que facts.md nao existe mais como fonte de verdade.
 */
function loadFactsRaw() {
  return getFactsText()
}

/**
 * Lê a bag (mochila) da sessão atual do disco e retorna texto formatado para o system prompt.
 * Sem keys soltas — tudo que está em items[] aparece automaticamente.
 * Se activeTopic for informado, aplica context refiner nas notas para filtrar por relevância.
 */

async function buildSystem(
  summaryContext,
  sessionId = 'default',
  proactive = false,
  experienceBlock = null,
  addPromptBlock = null,
  userMessage = '',
  runId = null,
  androidAllowlist = null
) {
  const { agentMeta, prefMeta, prefBody } = loadConf()

  const name = agentMeta?.name ?? 'Agent'
  const language = prefMeta?.language ?? 'pt-BR'
  const style = prefMeta?.style ?? 'direct'

  
  const personality = await loadPersonalityByApproximationLevel(sessionId)

  const prefs = prefBody ? `\n\n[Preferences]\n${prefBody}` : ''

  const snapshot = getFilteredWorkspaceSnapshot(sessionId)

  const proactiveCtx = proactive
    ? '\n\n[MODE: PROACTIVE — no user present. Execute scheduled tasks, send results via notify().]'
    : ''

  const localTime = nowLabel()

  const { provider, model } = resolveProvider()

  const runtimeCatalog = await getRuntimeCatalog()

  const pendingReset = getPendingReset()

  const resetNote = pendingReset
    ? `\n\nRESET PENDENTE: sera executado ao fim deste ciclo ReAct (motivo: "${pendingReset.reason}").`
    : ''

  
  let osContextSection = ''

  try {
    const {
      hasOsContext,
      getOsContext,
      formatOsContextForPrompt
    } = await import('logos')

    const resolvedSession = hasOsContext(sessionId)
      ? sessionId
      : hasOsContext('default')
        ? 'default'
        : null

    if (resolvedSession) {
      const osCtx = getOsContext(resolvedSession)

      if (osCtx) {
        osContextSection =
          '\n\n' + formatOsContextForPrompt(osCtx)
      }
    }
  } catch { }

  
  const activeWsSession = await resolveActiveSessionId(sessionId)

  const sessionSection = activeWsSession
    ? `

## Sessão WebSocket ativa

Session ID do front conectado: \`${activeWsSession}\`

SEMPRE use este session_id ao chamar:
- run_ui_action
- get_os_context
- get_dom_snapshot
- push_to_front

Nunca use 'default' — use o ID acima.
`
    : `

## Sessão WebSocket

Nenhum front conectado no momento.
Use list_active_sessions para verificar.
`

  
  let contextsSection = ''

  try {
    const contextsStr = await updateContexts(sessionId)

    if (contextsStr) {
      contextsSection = `

## Contextos do Runtime

${contextsStr}`
    }
  } catch (e) {
    console.warn(
      '[Agent] Falha ao atualizar contextos runtime:',
      e.message
    )
  }

  
  
  
  let activeTopic = ''
  try {
    activeTopic = buildRecentUserContext(getMessages(sessionId), userMessage)
  } catch { /* fallback: activeTopic vazio */ }

  
  let bagSection = ''

  try {
    const bagStr = await loadBagForPrompt(getHostProxy, sessionId, { activeTopic })

    if (bagStr) {
      bagSection = `

## Bag da Sessao (Mochila)

Planos e notas legados selecionados para esta sessão.
Conteúdo histórico: confirme origem, cobertura e validade antes de reutilizar.

${bagStr}`
    }
  } catch (e) {
    console.warn(
      '[Agent] Falha ao carregar bag para system prompt:',
      e.message
    )
  }

  
  let refinedContext = summaryContext

  try {
    

    if (activeTopic.length >= 3) {
      const session = getSession(sessionId)
      const facts = loadFactsRaw()
      const rawSummary = session?.summary || ''

      const sess = _sessionContexts.get(sessionId)

      const currentRuntimeContexts = sess
        ? Array.from(sess.contexts.values()).map(entry => ({
          name: entry.name,
          value: entry.value,
          lastAccessed: entry.lastAccessed || Date.now(),
          priority: entry.priority,
        }))
        : []

      const tailored =
        await contextRefiner.buildTailoredContext(
          {
            facts,
            summary: rawSummary,
            runtimeContexts: currentRuntimeContexts,
          },
          activeTopic
        )

      const parts = []

      if (tailored.facts) {
        parts.push(
          `[Long-term memory]\n${tailored.facts}`
        )
      }

      if (tailored.summary) {
        parts.push(
          `[Previous summary]\n${tailored.summary}\n\n---\n`
        )
      }

      if (tailored.runtimeContexts) {
        parts.push(
          `[Contextos refinados]\n${tailored.runtimeContexts}`
        )
      }

      refinedContext =
        parts.length > 0
          ? parts.join('\n\n')
          : summaryContext

      if (tailored.pruned > 0) {
        console.log(
          `[ContextRefiner] ${tailored.pruned} item(s) podados do contexto para sessionId=${sessionId}`
        )
      }
    }
  } catch (e) {
    console.warn(
      '[ContextRefiner] Falha no refinamento, usando contexto completo:',
      e.message
    )
  }

  
  const promptBlocks =
    Array.isArray(addPromptBlock) && addPromptBlock.length
      ? '\n\n' +
      addPromptBlock
        .filter(Boolean)
        .map(block => String(block).trim())
        .filter(Boolean)
        .join('\n\n')
      : ''

  const experienceSection = experienceBlock
    ? `\n\n${experienceBlock}`
    : ''

  
  
  let skillsBlock = ''
  let skillSources = []
  let skillRequiredTools = []
  try {
    const composed = await composeSkills(sessionId, userMessage)
    const block = composed.block
    skillSources = composed.sources
    skillRequiredTools = composed.requiredTools || []
    skillsBlock = `\n\n<!-- agent:skills:start -->\n${block ? `## Skills ativas (roteadas por relevância)\n\n${block}` : ''}\n<!-- agent:skills:end -->`
  } catch (e) {
    console.warn('[Agent] Falha ao rotear skills:', e.message)
  }

  
  try {
    const { discoverRuntimeTools } = await import('./runtime_bridge.js')
    const androidTools = (await discoverRuntimeTools()).filter(tool => tool.package === 'android-device')
    if ((!androidAllowlist || ['android_recipe_run', 'android_recipe_list', 'android_recipe_get', 'android_open_app', 'android_trace_begin', 'android_trace_end'].every(name => androidAllowlist.includes(name))) && androidTools.some(tool => tool.name === 'android_recipe_run')) {
      const { renderAndroidContext } = await import('../../android-device/lib/agent-context.js')
      skillsBlock += '\n\n' + await renderAndroidContext({ enabled: true, authorized: true })
    }
  } catch (error) {
    console.warn('[Agent] Contexto Android indisponível:', error.message)
  }

  
  
  
  const contextBudget = Number(getConfig()?.llm?.context_max_tokens) || 32_000
  const compilation = new ContextCompiler({ maxTokens: contextBudget }).compile([
    promptFragment({ id: 'personality', required: true, source: 'agent:personality', content: personality.content, priority: 100, trust: 'instruction' }),
    promptFragment({ id: 'session', required: true, source: 'agent:websocket', content: sessionSection, priority: 100, trust: 'instruction' }),
    promptFragment({ id: 'proactive', source: 'agent:mode', content: proactiveCtx, priority: 100, trust: 'instruction' }),
    promptFragment({ id: 'reset', source: 'agent:reset', content: resetNote, priority: 100, trust: 'instruction' }),
    promptFragment({ id: 'skills', source: 'agent:skills', content: skillsBlock, priority: 95, trust: 'instruction' }),
    promptFragment({ id: 'prompt-blocks', source: 'logos:hooks', content: promptBlocks, priority: 90, trust: 'instruction' }),
    promptFragment({ id: 'stability-receipt', source: 'logos:stabilizer', content: stabilityReceipts.promptFor(sessionId, { runId }), priority: 99, trust: 'operational' }),
    promptFragment({ id: 'runtime-catalog', source: 'logos:tools', content: runtimeCatalog, priority: 90, trust: 'system' }),
    promptFragment({ id: 'bag', source: 'bags:session', content: bagSection, maxTokens: 2000, priority: 85, trust: 'untrusted' }),
    promptFragment({ id: 'operational-bag', source: 'agent:bag', content: operationalBagPrompt(getConfig(), durableRuns.get(runId)), maxTokens: 2000, priority: 86, trust: 'untrusted' }),
    promptFragment({ id: 'memory', source: 'memory:session', content: refinedContext, maxTokens: 2000, priority: 80, trust: 'context' }),
    promptFragment({ id: 'os-context', source: 'logos:os-context', content: osContextSection, priority: 75, trust: 'context' }),
    promptFragment({ id: 'experience', source: 'classification:experience', content: experienceSection, priority: 70, trust: 'context' }),
    promptFragment({ id: 'runtime-contexts', source: 'logos:contexts', content: contextsSection, priority: 60, trust: 'context' }),
    promptFragment({ id: 'workspace', source: 'workspace:snapshot', content: snapshot, maxTokens: 600, priority: 50, trust: 'external' }),
    promptFragment({ id: 'preferences', source: 'agent:preferences', content: prefs, priority: 95, trust: 'instruction' }),
  ])
  if (compilation.diagnostics.length) console.warn('[ContextCompiler]', compilation.diagnostics)
  const compiledSections = new Map(compilation.fragments.map(fragment => [fragment.id, fragment.content]))
  const section = id => compiledSections.get(id) || ''

  const ctx = {
    refinedContext: section('memory'), personality: section('personality'), skillsBlock: section('skills'),
    proactiveCtx: section('proactive'), resetNote: section('reset'), osContextSection: section('os-context'), bagSection: section('bag') + section('operational-bag'),
    contextsSection: section('runtime-contexts'), experienceSection: section('experience'), promptBlocks: section('prompt-blocks'), stabilityReceipt: section('stability-receipt'), sessionSection: section('session'),
    localTime, provider, model, runtimeCatalog: section('runtime-catalog'), snapshot: section('workspace'),
    language, style, prefs: section('preferences'),
    hasAttachments: false, 
  }

  const tpl = loadSystemTpl()
  let result
  if (tpl) {
    try {
      result = renderTemplate(tpl, ctx, join(AGENT_DIR, 'prompts'))
    } catch (e) {
      console.warn('[Agent] Falha ao renderizar template inflect, usando fallback:', e.message)
    }
  }

  if (!result) {
    
    result = `${section('memory')}${section('personality')}${section('skills')}${section('proactive')}${section('reset')}${section('stability-receipt')}${section('os-context')}${section('bag')}${section('operational-bag')}${section('runtime-contexts')}${section('experience')}${section('prompt-blocks')}${section('session')}

## Horario Atual: ${localTime}
## Modelo: ${provider} / ${model}

## Tools de runtime sao NATIVAS
${section('runtime-catalog')}

${section('workspace')}

## Memory: remember / recall / forget

Language: ${language} | Style: ${style}${section('preferences')}`
  }

  
  try {
    const tokenCount = (str) => Math.ceil((str || '').length / 4) 
    const sections = {
      ...Object.fromEntries(compilation.fragments.map(fragment => [fragment.id, fragment.estimatedTokens])),
      meta: tokenCount(`## Horario Atual: ${localTime}\n## Modelo: ${provider} / ${model}\nLanguage: ${language} | Style: ${style}`),
    }
    const total = Object.values(sections).reduce((a, b) => a + b, 0)
    console.log(`[Agent] System prompt tokens: ${total} total | ${JSON.stringify(sections)}`)
  } catch (e) {
    
  }

  const approximationLevel = await getApproximationLevel(sessionId)
  const sources = [
    ...personality.sources,
    ...(compiledSections.has('skills') ? skillSources : []),
    ...compilation.provenance.map(item => ({
      type: item.trust === 'instruction' ? 'system' : 'context',
      name: item.source,
      estimatedTokens: item.estimatedTokens,
      trust: item.trust,
      sensitivity: item.sensitivity,
    })),
  ]
  return {
    prompt: result,
    skillRequiredTools,
    inputTrace: buildInputTrace({ provider, model, approximationLevel, sources,
      dropped: compilation.dropped, diagnostics: compilation.diagnostics }),
  }
}

async function attemptLoopGuardRollback(sessionId) {
  try {
    const messages = getMessages(sessionId)
    const mutationTools = new Set(['write_file', 'patch_file'])
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i]
      if (msg.role !== 'assistant' || !Array.isArray(msg.tool_calls)) continue
      const mutCall = msg.tool_calls.find(tc => mutationTools.has(tc.name))
      if (!mutCall) continue
      const filePath = mutCall.input?.path
      if (!filePath) continue
      const history = listHistory(filePath)
      if (!history.length) continue
      const result = restoreVersion(filePath, 0)
      if (result.success) return `Rollback automatico em \`${filePath}\` (versao de ${result.restored_to}).`
      return null
    }
  } catch (e) { console.error('[Agent] LoopGuard rollback error:', e.message) }
  return null
}



function looksLikeMedia(text = '') {
  return /(imagem|imagens|foto|desenh|ilustr|render|picture|\bimage\b|[aá]udio|narra|\bvoz\b|\btts\b)/i.test(text)
}




async function generateMediaTurn(prompt, modality, sessionId, onProgress) {
  if (onProgress) onProgress({ label: modality === 'image' ? 'Gerando imagem…' : 'Gerando áudio…' })

  let res
  try {
    res = await $('llm:call', {
      prompt,
      sessionId,
      modalities: modality === 'image' ? ['image'] : ['text', 'audio'],
      requirements: {
        requires: { modalities: [modality === 'image' ? 'image:output' : 'audio:output'] },
      },
    })
  } catch (e) {
    res = { success: false, error: e.message }
  }

  const parts = []
  if (res?.text) parts.push(String(res.text).trim())
  for (const img of (res?.images ?? [])) {
    const raw = img?.url ?? img
    if (!raw) continue
    const src = img?.local ? `/public/files/?path=${encodeURIComponent(raw)}` : raw
    
    
    
    parts.push(`![imagem](${src} "viva")`)
  }
  for (const a of (res?.audioFiles ?? res?.audio_files ?? [])) {
    const raw = a?.path ?? a?.url ?? a
    if (raw) parts.push(`[áudio](/public/files/?path=${encodeURIComponent(raw)})`)
  }

  const content = parts.filter(Boolean).join('\n\n')
    || (res?.error ? `Falha ao gerar mídia: ${res.error}` : 'Não consegui gerar a mídia.')

  await pushMessage(sessionId, { role: 'assistant', content })
  if (onProgress) onProgress({ type: 'token', text: content })
  return content
}

export async function runAgent(message, sessionId = 'default', onProgress = null, abortSignal = null, opts = {}) {
  
  
  warmPricing()
  const state = { message, sessionId, onProgress, abortSignal, model: opts.model || null, ...(opts.origin === 'presence' ? { origin: 'presence', initiativeId: opts.initiativeId } : {}) };
  const userFeedback = opts.origin === 'presence' ? null : classifyUserFeedback(message)
  if (userFeedback) $('agent:user-feedback', { sessionId, feedback: userFeedback, message })

  
  
  
  if (activeSessions.has(sessionId)) {
    const error = `Session "${sessionId}" is already processing.`;
    $('agent:report', state);

    throw new Error(error);
  }
  activeSessions.add(sessionId)

  let durableRun
  let reusedUserMessage = false
  let earlyUserMessage = false
  try {
    
    
    
    
    const sessionMessages = getMessages(sessionId)
    const matchingUserIndex = opts.reuseLastUserMessage === true
      ? [...sessionMessages].findLastIndex(item => item?.role === 'user' && item.content === message)
      : -1
    reusedUserMessage = matchingUserIndex >= 0
      && !sessionMessages.slice(matchingUserIndex + 1).some(item => item?.role === 'user')
    earlyUserMessage = !opts.resume && !reusedUserMessage && opts.persistUserMessageEarly === true
    if (earlyUserMessage) {
      await pushMessage(sessionId, {
        role: 'user',
        content: message,
        metadata: { ...normalizeMessageMetadata(opts.messageMetadata), ...(opts.origin === 'presence' ? { origin: 'presence', initiativeId: opts.initiativeId } : {}) },
      })
    }
    durableRun = opts.durableRunId
      ? durableRuns.get(opts.durableRunId)
      : durableRuns.start({ sessionId, message, origin: opts.origin, maxIterations: opts.maxIterations, taskId: opts.taskId || null })
  } catch (error) {
    
    
    
    
    activeSessions.delete(sessionId)
    throw error
  }
  const durableRunId = durableRun?.id
  recordBagEvent(getConfig(), durableRun, { key: `${durableRunId}:request`, type: 'request', payload: { message: String(message).slice(0, 8000), coverage: String(message).length > 8000 ? 'partial' : 'complete' } })
  const heartbeat = durableRunId
    ? setInterval(() => durableRuns.heartbeat(durableRunId), Math.max(1_000, Math.floor(durableRuns.leaseMs / 3)))
    : null
  heartbeat?.unref?.()

  try {
    const modified = await $('agent:start', state);
    const finalMessage = modified?.message || state.message;

    
    if (modified?.selectedTools) {
      _classifiedTools.set(sessionId, modified.selectedTools.map(t => t.name))
    } else {
      _classifiedTools.delete(sessionId)
    }


    
    if (opts.maxIterations) {
      _maxIterOverrides.set(sessionId, opts.maxIterations)
    } else {
      _maxIterOverrides.delete(sessionId)
    }

    
    
    
    
    try {
      _activeSpecialist.set(sessionId, opts.specialistId
        ? getSpecialistById(opts.specialistId)
        : resolveSessionSpecialist(sessionId))
    } catch (e) {
      console.warn('[Agent] Falha ao resolver especialista da sessão:', e.message)
      _activeSpecialist.delete(sessionId)
    }

    if (abortSignal?.aborted) {
      $('agent:aborted', state);

      const err = new Error('Aborted before start')
      err.name = 'AbortError'

      throw err
    }

    
    
    if (!(getConfig()?.bag?.capture === true && Number(getConfig()?.bag?.history_max_tokens) > 0)) {
      await compressIfNeeded(sessionId, callLLM, abortSignal)
    }
    const experienceBlock = modified?.experienceBlock || null
    
    
    
    const activeSpecialistForPrompt = _activeSpecialist.get(sessionId) || null
    const specialistBlock = activeSpecialistForPrompt ? composeSpecialistPrompt(activeSpecialistForPrompt) : ''
    const baseBlocks = Array.isArray(modified.promptBlock)
      ? modified.promptBlock
      : (modified.promptBlock ? [modified.promptBlock] : [])
    const optionBlocks = Array.isArray(opts.promptBlock)
      ? opts.promptBlock
      : (opts.promptBlock ? [opts.promptBlock] : [])
    const promptBlocksWithSpecialist = specialistBlock
      ? [...baseBlocks, ...optionBlocks, `## Especialista ativo: ${activeSpecialistForPrompt.name}\n\n${specialistBlock}`]
      : [...baseBlocks, ...optionBlocks]
    const builtSystem = await buildSystem(
      getSummaryContext(sessionId),
      sessionId,
      false,
      experienceBlock,
      promptBlocksWithSpecialist,
      finalMessage,
      durableRunId,
      opts.toolAllowlist && activeSpecialistForPrompt?.toolsAllowlist ? opts.toolAllowlist.filter(name => activeSpecialistForPrompt.toolsAllowlist.includes(name)) : opts.toolAllowlist || activeSpecialistForPrompt?.toolsAllowlist || null,
    )
    try {
      opts.onInputTrace?.({ text: finalMessage, inputTrace: builtSystem.inputTrace })
    } catch (error) {
      console.warn('[Agent] Falha ao publicar proveniência do contexto:', error.message)
    }
    if (!opts.resume && !earlyUserMessage && !reusedUserMessage) {
      await pushMessage(sessionId, {
        role: 'user',
        content: finalMessage,
        metadata: { ...normalizeMessageMetadata(opts.messageMetadata), ...(opts.origin === 'presence' ? { origin: 'presence', initiativeId: opts.initiativeId } : {}) },
        inputTrace: builtSystem.inputTrace,
      })
    }

    durableRuns.checkpoint(durableRunId, { phase: opts.resume ? 'resumed' : 'context-ready', iteration: 0 })
    const response = await agentLoop(builtSystem.prompt, sessionId, onProgress, abortSignal, durableRunId, {
      recoveryTool: opts.recoveryTool,
      recoveryNotice: opts.recoveryNotice,
    }, { cwd: opts.cwd, model: opts.model, requiredTools: opts.requiredTools, skillRequiredTools: builtSystem.skillRequiredTools, toolMode: opts.toolMode, toolAllowlist: opts.toolAllowlist, scopedTools: opts.scopedTools, onWork: opts.onWork, governance: opts.governance, maxActions: opts.maxActions, origin: opts.origin, presenceKind: opts.presenceKind, allowApprovedAction: opts.allowApprovedAction,
      protectedSkillNames: builtSystem.inputTrace?.sources?.filter(source => source.type === 'agent_md' && source.activation === 'explicit_development').map(source => source.name).filter(Boolean) || [] });

    const resolvedModel = _resolvedModels.get(sessionId) || null
    const endState = await $('agent:response', {
      ...state,
      response,
      model: resolvedModel?.model || state.model,
      provider: resolvedModel?.provider || null,
    });
    recordBagEvent(getConfig(), durableRuns.get(durableRunId), { key: `${durableRunId}:delivery`, type: 'delivery', payload: { text: String(response).slice(0, 8000), epistemicStatus: 'assistant_reported' } })
    durableRuns.complete(durableRunId, response)
    return response;
  } catch (error) {
    if (opts.resume) {
      const attempts = Number(durableRuns.get(durableRunId)?.attempts || 1)
      const delayMs = Math.min(30_000, 1_000 * (2 ** Math.max(0, attempts - 1)))
      durableRuns.scheduleRetry(durableRunId, error?.message || error, delayMs)
      $('agent:recovery-retry-scheduled', { runId: durableRunId, sessionId, attempts, delayMs })
    } else {
      durableRuns.fail(durableRunId, error?.message || error)
    }
    throw error
  } finally {
    if (heartbeat) clearInterval(heartbeat)
    try {
      const { finishSessionTraces } = await import('../../android-device/lib/action-trace.js');
      await finishSessionTraces(sessionId);
    } catch { /* O registro Android não bloqueia a conclusão do agente. */ }
    $('agent:finally', state);
    activeSessions.delete(sessionId)
  }
}



export function forgetSession(sessionId) {
  _classifiedTools.delete(sessionId)
  _resolvedModels.delete(sessionId)
  _maxIterOverrides.delete(sessionId)
  _activeSpecialist.delete(sessionId)
}

/**
 * Fixa (ou limpa, com `auto`/null) o acesso de modelo de uma sessão.
 */
export function setSessionModel(sessionId, model) {
  const value = setModelOverride(sessionId, model)
  if (!value) _resolvedModels.delete(sessionId)
  return { sessionId, model: value }
}

export function getSessionModel(sessionId) {
  return {
    sessionId,
    model: getModelOverride(sessionId),
    resolved: _resolvedModels.get(sessionId) ?? null
  }
}

/**
 * Fixa (ou limpa, com `auto`/null) o propósito de uma sessão. Enquanto houver
 * override, a classificação automática não decide mais o roteamento do turno.
 */
export function setSessionPurpose(sessionId, purpose) {
  const value = setPurposeOverride(sessionId, purpose)
  
  
  if (!value) _classifiedPurpose.delete(sessionId)
  return { sessionId, purpose: value }
}

export function getSessionPurpose(sessionId) {
  return {
    sessionId,
    purpose: getPurposeOverride(sessionId),
    
    
    classified: _classifiedPurpose.get(sessionId) ?? null
  }
}






function salvageFromReasoning(parsed) {
  const raw = (parsed?.reasoning ?? parsed?.cot ?? '').toString()
  const cleaned = raw.replace(/<\/?think>/gi, '').trim()
  if (!cleaned) return null
  const paras = cleaned.split(/\n\s*\n/).map(p => p.trim()).filter(Boolean)
  const last = paras[paras.length - 1] || cleaned
  return last.length > 0 ? last : null
}





function artifactNameFromHtml(html, index = 0) {
  const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]
    ?.trim()
    .replace(/[^a-z0-9._-]+/gi, '-')
    .replace(/^-+|-+$/g, '')
  return `${title || (index ? `interface-${index + 1}` : 'index')}.html`
}

async function createHtmlArtifactDirective(html, sessionId, index) {
  const result = await invokeRuntimeTool('artifacts', 'create_artifact', {
    name: artifactNameFromHtml(html, index),
    content: html,
    sessionId,
    open: 'canvas',
  })
  const artifact = result?.success ? result.artifact : null
  if (!artifact?.id) throw new Error(result?.error || 'artefato não retornou um id')
  return `\`\`\`artifact\n${JSON.stringify({
    id: artifact.id,
    sessionId: artifact.sessionId || sessionId,
    name: artifact.name,
    open: 'canvas',
  })}\n\`\`\``
}

async function promoteInlineHtmlArtifacts(content, sessionId) {
  if (typeof content !== 'string' || !content.trim()) return content

  const htmlBlock = /```html\s*\n([\s\S]*?)```/gi
  let seen = 0
  let promoted = false
  let output = ''
  let cursor = 0
  let match

  while ((match = htmlBlock.exec(content)) !== null) {
    output += content.slice(cursor, match.index)
    cursor = match.index + match[0].length
    const html = match[1].trim()
    if (!html) {
      output += match[0]
      continue
    }

    try {
      output += await createHtmlArtifactDirective(html, sessionId, seen++)
      promoted = true
    } catch (error) {
      
      
      console.warn('[Agent] Não foi possível promover HTML inline:', error.message)
      output += match[0]
    }
  }

  if (!promoted) {
    const rawHtml = content.trim()
    if (/^(?:<!doctype\s+html[^>]*>\s*)?<html[\s>]/i.test(rawHtml)) {
      try {
        return await createHtmlArtifactDirective(rawHtml, sessionId, 0)
      } catch (error) {
        console.warn('[Agent] Não foi possível promover documento HTML:', error.message)
      }
    }
    return content
  }
  return output + content.slice(cursor)
}

async function persistAssistantResponse(response, sessionId) {
  const message = buildAssistantMessage(response)
  message.content = await promoteInlineHtmlArtifacts(message.content, sessionId)
  await pushMessage(sessionId, message)
  return message
}





function specialistOverrideId(model, providers) {
  return providers?.length ? `${model}@${providers[0]}` : model
}




async function callWithSpecialistFallback(callFn, baseOpts, modelSpec) {
  if (!modelSpec?.fallbackModel) return callFn(baseOpts)
  try {
    return await callFn(baseOpts)
  } catch (e) {
    if (e?.name === 'AbortError') throw e
    const fallbackOverride = specialistOverrideId(modelSpec.fallbackModel, modelSpec.providers)
    return await callFn({ ...baseOpts, requirements: { ...baseOpts.requirements, override: fallbackOverride } })
  }
}

async function agentLoop(system, sessionId, onProgress = null, abortSignal = null, durableRunId = null, recovery = {}, execution = {}) {
  const maxIterations = _maxIterOverrides.get(sessionId) ?? getMaxIterations()
  let iterations = 0
  let emptyRetries = 0
  const watchdog = new SessionWatchdog()
  const meta = getMetacognition()
  const metacore = getMetacore()
  const turnOutcomes = []
  const reactiveOutcomes = []
  const skillRecomposition = { calls: 0, lastCallIteration: -Infinity, lastOutcomeCount: 0 }
  const turnContext = createTurnContext({ runId: durableRunId, sessionId, turnId: execution.turnId })
  const outcomeEvaluator = new OutcomeEvaluator()
  const coordinator = new TurnCoordinator({
    context: turnContext,
    journal: new RunJournal(durableRuns, durableRunId),
    emit: (name, payload) => { $(name, payload) },
  })
  let kernelStarted = false
  let executedActions = 0

  
  
  
  
  
  
  
  
  const resumableRecoveryCalls = new Map()
  const addResumableRecoveryCall = call => {
    if (!call?.id || !call?.name) return
    const policy = call.recoveryPolicy || recoveryPolicyFor(call)
    if (['read-only', 'idempotent'].includes(policy)) {
      resumableRecoveryCalls.set(call.id, { ...call, recoveryPolicy: policy })
    }
  }
  addResumableRecoveryCall(recovery.recoveryTool)
  if (execution.origin !== 'presence') for (const call of terminalMissingToolCalls(getMessages(sessionId))) addResumableRecoveryCall(call)
  const resumableRecoveryIds = new Set(resumableRecoveryCalls.keys())
  const repairedToolCallIds = await repairMissingToolResults(sessionId, { skipIds: resumableRecoveryIds })
  let requiresInterruptedToolDisclosure = repairedToolCallIds.length > 0
  if (repairedToolCallIds.length) {
    const recoveredTool = recovery.recoveryTool
    if (recoveredTool && repairedToolCallIds.includes(recoveredTool.id)) {
      durableRuns.toolCompleted(durableRunId, recoveredTool.id, {
        ok: false,
        error: { message: 'Tool result unavailable after interrupted execution' },
      })
    }
    const recoveryWarning = 'Uma ferramenta de um turno anterior foi interrompida antes de produzir resultado durável. ' +
      'O estado da operação é desconhecido. Não diga que ela foi concluída. Informe a interrupção ou use uma ferramenta de leitura para verificar o estado antes de concluir.'
    recovery.recoveryNotice = [recovery.recoveryNotice, recoveryWarning].filter(Boolean).join(' ')
    $('agent:tool-result-repaired', { sessionId, runId: durableRunId, toolCallIds: repairedToolCallIds })
  }

  
  let _cachedSystem = null

  
  function checkAborted() {
    if (abortSignal?.aborted) {
      const err = new Error('Generation aborted by user')
      err.name = 'AbortError'
      throw err
    }
  }

  async function governanceGate(toolCall) {
    const decision = await evaluateGovernanceAction({ sessionId, tool: toolCall.name, input: toolCall.input }, {requireReview: execution.governance?.requireReview === true, reviewSource: execution.governance?.reviewSource, continuation: execution.origin === 'presence' ? { origin: 'presence', presenceKind: execution.presenceKind, maxIterations: 2, maxActions: 1, toolAllowlist: execution.toolAllowlist || [], governance: { requireReview: true, reviewSource: 'presence' }, allowApprovedAction: true } : null, authorize: () => execution.governance?.authorize?.(toolCall)})
    if (decision.allowed) {
      
      
      if (decision.autoApproved) {
        $('agent:governance-warning', {
          sessionId,
          iteration: iterations,
          mode: decision.mode,
          tool: toolCall.name,
          command: decision.command,
          reason: decision.reason,
          decisionId: decision.decisionId
        })
      }
      return null
    }
    if (decision.classification === 'needs_confirmation' && execution.governance?.propose) {
      const proposal = await execution.governance.propose(decision);
      return {deferred:true,text:JSON.stringify({executed:false,status:'pending_review',proposalId:proposal.id,message:'Proposta registrada na mesa de relatórios. A ação NÃO foi executada. Continue apenas trabalho independente.'})};
    }
    const header = decision.classification === 'blocked' ? 'AÇÃO BLOQUEADA' : 'CONFIRMAÇÃO NECESSÁRIA'
    const detail = `${header}: ${decision.reason} (decisão: ${decision.decisionId})`
    
    
    
    
    
    return { text: detail, confirmation: decision.structuredInput || null }
  }

  async function emitToolEvent(name, payload) {
    try { await $(name, payload) } catch { /* observadores nunca interrompem a tool */ }
  }

  async function executeToolCall(tc, { preapproved = false } = {}) {
    const startTime = Date.now()
    const toolSchema = schemaForTool(tc.name)
    ensureOperationId(tc, toolSchema)
    const iterationContext = createIterationContext(turnContext, iterations, { iterationId: tc.iterationId })
    const toolContext = createToolContext(iterationContext, tc, { operationId: tc.operationId })
    tc.id ||= toolContext.toolCallId
    tc.iterationId ||= toolContext.iterationId
    tc.operationId ||= toolContext.operationId
    const correlation = correlationFields(toolContext)
    let result, outcome, blocked = false, confirmation = null
    $('agent:tool-start', { sessionId, iteration: iterations, tool: tc.name, input: tc.input, ...correlation, correlation })
    try {
      checkAborted()
      assertExecutionTool(tc, extendAllowlist(execution.toolAllowlist, sessionId))
      if (Number.isInteger(execution.maxActions) && executedActions >= execution.maxActions) throw new Error('Orçamento de ações do turno esgotado')
      const gate = preapproved ? null : await governanceGate(tc)
      if (kernelStarted) coordinator.transition('governed', { iteration: iterations, ...correlation })
      if (gate) {
        result = gate.text
        confirmation = gate.confirmation
        outcome = gate.deferred ? normalizeToolOutcome({executed:false,status:'pending_review',detail:result}, {operationId:tc.operationId,changedState:false}) : toolOutcomeError(result, { operationId: tc.operationId, category: 'governance' })
        blocked = !gate.deferred
        if (kernelStarted && blocked) coordinator.transition(confirmation ? 'waiting-approval' : 'checkpointed', {
          phase: confirmation ? 'waiting-approval' : 'governance-blocked', iteration: iterations, ...correlation,
        })
      } else {
        checkAborted()
        executedActions++
        if (!isGovernanceReadOnly({tool:tc.name,input:tc.input})) await execution.onWork?.();
        if (kernelStarted) coordinator.transition('tool-executing', { iteration: iterations, ...correlation })
        await emitToolEvent('tool_before', { sessionId, tool: tc.name, payload: tc.input, governed: true, ...correlation, correlation })
        durableRuns.toolStarted(durableRunId, tc, iterations, {
          policy: recoveryPolicyFor(tc),
          operationId: tc.operationId || tc.input?.idempotencyKey || tc.input?.idempotency_key,
          reconcileTool: toolSchema.reconcileTool,
        })
        if (![BAG_TOOL_SCHEMA.name, BAG_CHECKPOINT_SCHEMA.name].includes(tc.name)) recordBagEvent(getConfig(), durableRuns.get(durableRunId), { key: `${durableRunId}:${tc.id}:start`, type: 'tool_started', payload: { callId: tc.id, tool: tc.name, status: 'unknown' } })
        result = tc.name === BAG_TOOL_SCHEMA.name
          ? retrieveBagEvidence(getConfig(), durableRuns.get(durableRunId), tc.input)
          : tc.name === BAG_CHECKPOINT_SCHEMA.name
          ? updateBagCheckpoint(getConfig(), durableRuns.get(durableRunId), tc.input, tc.id)
          : await dispatchBuiltin(tc.name, tc.input, {
            bagReadScope: getConfig()?.bag?.reuse_reads === true
              ? JSON.stringify([sessionId, durableRuns.get(durableRunId)?.taskId]) : null,
          })
        if (result === null) result = await invokeTool(tc.name, tc.input)
        if (tc.name !== 'request_tool_access') {
          const grantedTarget = tc.name === 'run_runtime_tool' ? tc.input?.tool
            : tc.name === 'run_tool' ? tc.input?.name : tc.name
          consumeGrantedTool(sessionId, grantedTarget)
        }
        outcome = normalizeToolOutcome(result, { operationId: tc.operationId })
        if (outcome.ok && outcome.changedState === true && outcome.value?.sourceEvidence) {
          const evidence = { ...outcome.value.sourceEvidence, sessionId, ...correlation, taskId: durableRuns.get(durableRunId)?.taskId || correlation.runId }
          try { stabilityReceipts.recordLocalChange(evidence) }
          catch (error) {
            
            
            outcome.metrics.evidenceRecorded = false
            outcome.metrics.evidenceError = 'LOCAL_EVIDENCE_UNAVAILABLE'
          }
          await emitToolEvent('runtime:source_changed', evidence)
        }
      }
    } catch (e) {
      outcome = toolOutcomeError(e, { operationId: tc.operationId })
      result = outcome.error.message
    }
    const durationMs = Date.now() - startTime
    outcome = outcome || normalizeToolOutcome(result, { operationId: tc.operationId })
    outcome.metrics = { ...outcome.metrics, durationMs }
    const is_error = !outcome.ok
    turnOutcomes.push(outcome)
    reactiveOutcomes.push({ tool: tc.name, status: outcome.ok ? 'success' : 'error', errorCategory: outcome.error?.category || null, iteration: iterations })
    result = legacyToolResult(outcome)
    const archivedResult = getConfig()?.bag?.capture === true ? captureToolResult(result, 1024 * 1024) : { coverage: 'unknown' }
    const bagReceipt = ![BAG_TOOL_SCHEMA.name, BAG_CHECKPOINT_SCHEMA.name].includes(tc.name) ? recordBagEvent(getConfig(), durableRuns.get(durableRunId), { key: `${durableRunId}:${tc.id}:result`, type: 'tool_result',
      evidence: archivedResult.coverage === 'complete' ? archivedResult.result : null, payload: {
      callId: tc.id, tool: tc.name, ok: outcome.ok, changedState: outcome.changedState ?? null,
      ...captureToolResult(result), resource: readEvidence(tc.name, outcome), epistemicStatus: 'observed',
    } }) : null
    const observableOutcome = publicToolOutcome(outcome)
    await emitToolEvent('tool_after', {
      sessionId,
      tool: tc.name,
      governed: true,
      outcome: observableOutcome,
      ...correlation,
      correlation,
      payload: {
        ok: outcome.ok,
        error: outcome.error?.message,
        outcome: observableOutcome,
        durationMs
      },
      
      
      ...(tc.name === 'run_shell' ? { shellPatterns: shellPatternsForHook(tc.input?.command) } : {})
    })
    meta.recordToolUse(tc.name, outcome.ok, durationMs)
    await pushMessage(sessionId, { ...buildToolResultMessage(tc.id, result, is_error),
      ...(bagReceipt?.evidenceRevision ? { bagEvidence: { revision: bagReceipt.evidenceRevision, taskId: durableRuns.get(durableRunId)?.taskId } } : {}),
    })
    durableRuns.toolCompleted(durableRunId, tc.id, outcome)
    if (kernelStarted && !blocked) coordinator.transition('checkpointed', { phase: 'tool-completed', iteration: iterations, ...correlation, ok: outcome.ok })
    $('agent:tool-end', { sessionId, iteration: iterations, tool: tc.name, result, outcome, is_error, durationMs, ...correlation, correlation })
    return { blocked, confirmation, outcome, correlation }
  }

  
  
  
  if (resumableRecoveryCalls.size) {
    for (const recoveryCall of resumableRecoveryCalls.values()) {
      const resumed = await executeToolCall(recoveryCall)
      if (!resumed.outcome?.ok) requiresInterruptedToolDisclosure = true
    if (resumed.blocked && resumed.confirmation) {
      const content = `${await confirmationIntro(resumed.confirmation)}\n\n\`\`\`thinkiac\n${JSON.stringify(resumed.confirmation)}\n\`\`\``
      await pushMessage(sessionId, { role: 'assistant', content })
      return content
    }
    }
  }

  coordinator.transition('context-compiled', { iteration: 0 })
  kernelStarted = true

  while (iterations < maxIterations) {
    const iterationStartedAt = Date.now()
    
    checkAborted()

    
    
    const approvedAction = Number.isInteger(execution.maxActions) && executedActions >= execution.maxActions ? null : execution.origin === 'presence' && !execution.allowApprovedAction ? null : await claimApprovedAction({ sessionId })
    if (approvedAction) {
      await executeToolCall({ id: `governance:${approvedAction.decisionId}`, name: approvedAction.tool, input: approvedAction.input }, { preapproved: true })
      iterations++
      continue
    }

    
    
    
    
    const queuedMessages = drainQueue(sessionId)
    for (const queued of queuedMessages) {
      await pushMessage(sessionId, { role: 'user', content: queued })
      if (onProgress) onProgress({ type: 'user_message', text: queued })
    }
    
    metacore.checkPatterns(sessionId);
    const cmd = metacore.getCommand(sessionId);
    if (cmd?.action === 'pause') {
      const pauseMsg = `*${cmd.instruction}*\n\n(Motivo: ${cmd.reason})`;
      await pushMessage(sessionId, { role: 'assistant', content: pauseMsg });
      const pending = getPendingReset();
      if (pending) { clearPendingReset(); executeReset(pending.reason); }
      return pauseMsg;
    }
    
    let crossSessionHint = null;
    let effectiveSystem = null;
    if (iterations === 0) {
      try {
        const msgs = getMessages(sessionId);
        const lastUser = [...msgs].reverse().find(m => m.role === 'user');
        if (lastUser) crossSessionHint = await metacore.getHints(sessionId, lastUser.content || '', []);
      } catch (e) { /* hints sao opcionais */ }
    }
    

    iterations++
    coordinator.transition('model-selected', { iteration: iterations })
    durableRuns.checkpoint(durableRunId, { phase: 'llm-started', iteration: iterations })
    $('agent:iteration-start', { sessionId, iteration: iterations, maxIterations });

    await refreshRuntimeTools()

    
    
    
    
    let tools = [...BUILTIN_SCHEMAS, ...listToolSchemas().filter(t => t.mode !== 'builtin')]
    if (getConfig()?.bag?.capture === true) tools.push(BAG_TOOL_SCHEMA, BAG_CHECKPOINT_SCHEMA)
    
    const activeSpecialist = _activeSpecialist.get(sessionId) || null
    const grantedToolNames = getGrantedToolNames(sessionId)
    const effectiveToolAllowlist = extendAllowlist(execution.toolAllowlist, sessionId)
    const effectiveSpecialistAllowlist = extendAllowlist(activeSpecialist?.toolsAllowlist, sessionId)
    const availableTools = selectExecutionTools(tools, {
      toolMode: execution.toolMode,
      toolAllowlist: effectiveToolAllowlist,
      allowlist: effectiveSpecialistAllowlist,
    })
    tools = selectExecutionTools(tools, {
      classifiedNames: _classifiedTools.get(sessionId),
      requiredTools: [...new Set([...(execution.requiredTools || []), ...(execution.skillRequiredTools || []), ...grantedToolNames, 'request_tool_access'])],
      toolMode: execution.toolMode,
      toolAllowlist: effectiveToolAllowlist,
      always: t => t.reach === 'always' || ALWAYS_INCLUDE_TOOLS.includes(t.name),
      allowlist: effectiveSpecialistAllowlist,
    })
    if (!['all', 'selected'].includes(execution.toolMode)) {
      const lastUser = [...getMessages(sessionId)].reverse().find(m => m.role === 'user')
      tools = await applyToolSelectionHook($, {
        tools, availableTools, sessionId, runId: durableRunId, iteration: iterations,
        message: lastUser?.content, routingIntent: lastUser?.content,
        recentOutcomes: reactiveOutcomes.slice(-3),
        signal: {
          newInstruction: queuedMessages.length > 0,
          recoverableFailure: turnOutcomes.slice(-1).some(outcome => !outcome.ok && outcome.error?.category !== 'governance'),
          consecutiveFailures: turnOutcomes.slice(-3).filter(outcome => !outcome.ok && outcome.error?.category !== 'governance').length,
          governance: turnOutcomes.slice(-1).some(outcome => outcome.error?.category === 'governance') ? 'pending' : null,
          cancelled: abortSignal?.aborted === true,
        },
        abortSignal,
        requiredTools: [...new Set([...(execution.requiredTools || []), ...(execution.skillRequiredTools || []), ...grantedToolNames, 'request_tool_access'])],
        always: t => t.reach === 'always' || ALWAYS_INCLUDE_TOOLS.includes(t.name),
      })
    }
    
    const hasNewSkillOutcome = turnOutcomes.length > skillRecomposition.lastOutcomeCount
    let skillSignal = {
      newInstruction: queuedMessages.length > 0,
      recoverableFailure: hasNewSkillOutcome && turnOutcomes.slice(-1).some(outcome => !outcome.ok && outcome.error?.category !== 'governance'),
      consecutiveFailures: turnOutcomes.slice(-3).filter(outcome => !outcome.ok && outcome.error?.category !== 'governance').length,
      stagnation: hasNewSkillOutcome && turnOutcomes.length >= 3 && turnOutcomes.slice(-3).every(outcome => !outcome.ok),
      governance: turnOutcomes.slice(-1).some(outcome => outcome.error?.category === 'governance') ? 'pending' : null,
      cancelled: abortSignal?.aborted === true,
    }
    try {
      const enriched = await $('agent:skills:signal', {
        sessionId, runId: durableRunId, iteration: iterations, signal: skillSignal,
        recentOutcomes: reactiveOutcomes.slice(-3),
      })
      if (enriched?.signal && typeof enriched.signal === 'object') skillSignal = { ...skillSignal, ...enriched.signal }
    } catch { /* detector opcional; os gatilhos locais continuam válidos */ }
    const skillDecision = decideSkillRecomposition({ state: skillRecomposition, signal: skillSignal, config: getConfig(), iteration: iterations })
    if (skillDecision.action === 'refresh') {
      const lastUser = [...getMessages(sessionId)].reverse().find(message => message.role === 'user')
      try {
        
        
        const recomposed = await composeSkills(sessionId, lastUser?.content || '', {
          cache: new Map(),
          protectedNames: execution.protectedSkillNames || [],
        })
        execution.skillRequiredTools = recomposed.requiredTools || []
        const replacement = `<!-- agent:skills:start -->\n${recomposed.block ? `## Skills ativas (roteadas por relevância)\n\n${recomposed.block}` : ''}\n<!-- agent:skills:end -->`
        const skillRegion = /<!-- agent:skills:start -->[\s\S]*?<!-- agent:skills:end -->/
        if (!skillRegion.test(system)) throw new Error('skill region unavailable in compiled prompt')
        system = system.replace(skillRegion, replacement)
        skillRecomposition.calls += 1
        skillRecomposition.lastCallIteration = iterations
        skillRecomposition.lastOutcomeCount = turnOutcomes.length
        $('agent:skills:recomposed', {
          sessionId, runId: durableRunId, iteration: iterations, reason: skillDecision.reason,
          calls: skillRecomposition.calls, selected: recomposed.sources.map(source => source.name),
        })
      } catch (error) {
        
        skillRecomposition.calls += 1
        skillRecomposition.lastCallIteration = iterations
        skillRecomposition.lastOutcomeCount = turnOutcomes.length
        $('agent:skills:recomposition-failed', {
          sessionId, runId: durableRunId, iteration: iterations, reason: skillDecision.reason,
          calls: skillRecomposition.calls, error: error?.message || 'unknown',
        })
      }
    }
    const rawMsgs = getMessages(sessionId)
    const sanitized = sanitizeMessages(rawMsgs)
    const finalizedMessages = finalizeForAPI(sanitized)
    const archivedContext = compactArchivedReads(finalizedMessages, {
      receipts: Number(getConfig()?.bag?.history_max_tokens) > 0 ? availableBagEvidence(getConfig(), durableRuns.get(durableRunId), rawMsgs) : new Map(),
      taskId: durableRuns.get(durableRunId)?.taskId,
      maxTokens: getConfig()?.bag?.capture === true ? getConfig()?.bag?.history_max_tokens : null,
    })
    const bagContext = getConfig()?.bag?.compact_reads === true ? compactBagReads(archivedContext.messages) : null
    const history = compactHistoryToBudget(bagContext?.messages || archivedContext.messages, {
      maxTokens: getConfig()?.bag?.history_max_tokens,
    })
    const messages = history.messages
    if (archivedContext.archived || archivedContext.overBudget) $('agent:bag:archive', { sessionId, runId: durableRunId, archived: archivedContext.archived, overBudget: archivedContext.overBudget, inputUpperBound: archivedContext.inputUpperBound })
    if (bagContext) $('agent:bag:context', { sessionId, runId: durableRunId, iteration: iterations, ...bagContext.metrics })
    if (history.compactedTurns || history.overBudget) $('agent:bag:history', { sessionId, runId: durableRunId, iteration: iterations,
      droppedTurns: history.droppedTurns, compactedTurns: history.compactedTurns, overBudget: history.overBudget, estimatedTokens: history.estimatedTokens })

    
    let currentSystem = refreshOperationalBag(system, operationalBagPrompt(getConfig(), durableRuns.get(durableRunId)));
    if (history.compactedTurns) currentSystem += '\n\n[Contexto: algumas chamadas e resultados antigos de ferramentas foram omitidos por limite de histórico. Não presuma seu conteúdo.]'
    if (recovery.recoveryNotice) currentSystem += `\n\n[${recovery.recoveryNotice}]`
    
    
    
    
    
    
    
    
    
    
    
    
    

    checkAborted()
    $('agent:llm-start', { sessionId, iteration: iterations, messages, tools });

    
    if (crossSessionHint) {
      currentSystem = currentSystem + '\n\n[Cross-session Hint] ' + crossSessionHint;
    }

    
    if (cmd?.action === 'reorient') {
      currentSystem = currentSystem + '\n\n[Metacore Directive] ' + cmd.instruction;
    }
    $('agent:input:segments', { sessionId, runId: durableRunId, iteration: iterations,
      ...measureInputSegments({ system: currentSystem, messages, tools }) })
    
    const useTokenStream = !crossSessionHint && !cmd?.action 
    const turnIntent = [...messages].reverse().find((message) => message?.role === 'user')?.content
    
    
    
    
    
    const specialistModelSpec = !execution.model && activeSpecialist ? resolveSpecialistModelSpec(activeSpecialist) : null
    const specialistOverride = specialistModelSpec
      ? specialistOverrideId(specialistModelSpec.model, specialistModelSpec.providers)
      : null
    const requirements = {
      requires: { modalities: ['text:input'], ...(tools.length ? { tools: true } : {}) },
      prefers: typeof turnIntent === 'string' ? { intent: turnIntent } : {},
      override: execution.model || specialistOverride || getModelOverride(sessionId),
    }
    let nativeBlocked = null;
    
    
    
    
    
    const runtimeControlledCodex = (getConfig()?.llm?.pools ?? []).some(pool =>
      pool?.enabled && pool.provider === 'codex-cli'
      && (pool.cli?.execution_mode ?? 'runtime-controlled') === 'runtime-controlled')
    const turnTools = (execution.scopedTools || runtimeControlledCodex) ? openTurnTools(sessionId, tools, async (name, input) => {
      checkAborted();
      if(nativeBlocked)throw new Error('Turno aguardando autorização.');
      assertExecutionTool({name,input},extendAllowlist(activeSpecialist?.toolsAllowlist, sessionId));
      coordinator.transition('model-responded', {iteration:iterations,nativeTool:true});
      coordinator.transition('parsed', {iteration:iterations,nativeTool:true});
      const tc = {id: 'mcp-' + randomUUID(), name, input};
      injectToolSession([tc], sessionId);
      setPrivilegedContext({session_id: sessionId, tool_call: name});
      await pushMessage(sessionId, {role: 'assistant', content: '', tool_calls: [{id:tc.id,type:'function',function:{name,arguments:JSON.stringify(tc.input)}}]});
      const result = await executeToolCall(tc);
      if(result.blocked)nativeBlocked=result;
      else coordinator.transition('model-selected', {iteration:iterations,nativeTool:true});
      if (!result.outcome.ok) throw new Error(result.outcome.error?.message || 'Ferramenta bloqueada.');
      return legacyToolResult(result.outcome);
    }, abortSignal) : null;
    const cliOpts = { requireGovernedTools: execution.origin === 'presence', ...(turnTools ? {turnToolsToken: turnTools.token, reportToolsOnly: execution.governance?.requireReview === true} : {}), bagTaskId: durableRuns.get(durableRunId)?.taskId };
    let response
    let iterationProducedOutput = false
    try {
      response = await withRetry(async () => {
        iterationProducedOutput = false
        if (useTokenStream) {
          return callWithSpecialistFallback(opts => modelGateway.legacy({ ...opts, mode: 'stream' }), {
            system: currentSystem, messages, tools, requirements, abortSignal, sessionId, cwd: execution.cwd, cliOpts,
            onToken: (delta) => {
              iterationProducedOutput = true
              if (onProgress) onProgress({ type: 'token', text: delta })
            },
            
            
            onProgress: (evt) => {
              if (evt.type === 'tool-step' || evt.type === 'tool-result' || evt.type === 'reasoning') iterationProducedOutput = true
              if (evt.type === 'tool-result' && evt.threadId && evt.itemId) recordBagEvent(getConfig(), durableRuns.get(durableRunId), {
                key: `codex:${evt.threadId}:${evt.itemId}:result`, type: 'tool_result',
                payload: { callId: evt.itemId, tool: evt.name, result: evt.content, coverage: 'partial', epistemicStatus: 'observed' },
              })
              if (onProgress) onProgress(evt)
            },
          }, specialistModelSpec)
        }
        return callWithSpecialistFallback(opts => modelGateway.legacy({ ...opts, mode: 'call' }), { system: currentSystem, messages, tools, requirements, abortSignal, sessionId, cwd: execution.cwd, cliOpts }, specialistModelSpec)
      }, undefined, {
        signal: abortSignal,
        shouldRetry: error => {
          const status = Number(error?.status ?? error?.statusCode)
          return !iterationProducedOutput
            && error?.name !== 'AbortError'
            && error?.noRetry !== true
            && error?.retryable !== false
            && ![400, 401, 403, 404, 409, 422].includes(status)
        },
        onRetry: ({ nextAttempt, delayMs }) => {
          onProgress?.({ type: 'step', label: `Falha transitória; tentando novamente (${nextAttempt}/3)…`, reasoning: null })
          $('agent:request-retry', { sessionId, runId: durableRunId, iteration: iterations, attempt: nextAttempt, delayMs })
        },
      })
    } finally { turnTools?.close(); }
    if(nativeBlocked){
      const content=nativeBlocked.confirmation
        ? await confirmationIntro(nativeBlocked.confirmation)+'\n\n```thinkiac\n'+JSON.stringify(nativeBlocked.confirmation)+'\n```'
        : nativeBlocked.outcome.error?.message || 'Execução bloqueada.';
      await pushMessage(sessionId,{role:'assistant',content});
      coordinator.transition('finalized',{reason:'native-tool-blocked'});
      return content;
    }

    $('agent:llm-end', { sessionId, iteration: iterations, response });
    coordinator.transition('model-responded', { iteration: iterations, model: response?.model, provider: response?.provider })
    
    
    
    
    
    await Promise.resolve()
    
    
    if (onProgress) {
      const usage = getTurnUsage(sessionId)
      if (usage) onProgress({ type: 'usage', usage })
    }
    checkAborted()

    let parsed
    try {
      parsed = parseResponse(response)
      coordinator.transition('parsed', { iteration: iterations, toolCallCount: parsed.tool_calls?.length || 0 })
      
      
      if (parsed.model) {
        _resolvedModels.set(sessionId, { model: parsed.model, provider: parsed.provider, source: requirements.override ? 'override' : 'auto' })
        if (onProgress) onProgress({ type: 'model', model: parsed.model, provider: parsed.provider, source: requirements.override ? 'override' : 'auto' })
      }
    } catch (e) {
      console.warn(`[Agent] parseResponse falhou na iteração ${iterations}: ${e.message}`)
      await pushMessage(sessionId, {
        role: 'assistant',
        content: `*Erro ao processar resposta da LLM: ${e.message}*`
      })
      await pushMessage(sessionId, {
        role: 'user',
        content: "A resposta da LLM foi inválida (erro de parsing). Por favor, resuma a conversa do meu penúltimo ao último ponto que funcionou, no mesmo idioma que minhas mensagens, e continue de onde parou."
      })
      
      if (onProgress) onProgress({ type: 'commit' })
      coordinator.transition('checkpointed', { phase: 'parse-failed', iteration: iterations, error: e.message })
      continue
    }

    
    
    
    
    
    
    if (parsed.tool_calls.length === 0) {
      let finalText = (parsed.text ?? '').trim();

      
      
      
      
      if (requiresInterruptedToolDisclosure
        && !/(interrompid|indispon[ií]vel|desconhecid|n[aã]o consegui|n[aã]o foi poss[ií]vel|falh)/i.test(finalText)) {
        finalText = 'Não consegui confirmar o resultado de uma operação interrompida. O estado pode estar incompleto; preciso verificá-lo antes de afirmar que foi concluída.'
      }

      
      
      if (finalText.length < 1) {
        const salvaged = salvageFromReasoning(parsed);
        if (salvaged) finalText = salvaged;
      }

      
      
      if (finalText.length < 1 && emptyRetries < 2) {
        emptyRetries++;
        $('agent:generation-short', { sessionId, iteration: iterations, text: finalText });

        await persistAssistantResponse(response, sessionId);
        await pushMessage(sessionId, {
          role: 'user',
          content: "Sua última resposta veio vazia (conteúdo todo dentro de <think> ou sem texto visível). Responda agora ao usuário com o resultado final em texto normal, FORA de qualquer bloco <think>, no mesmo idioma das mensagens dele. Use StructuredInput, Markmap, D2 ou Tabelas MD se ajudar."
        });
        
        if (onProgress) onProgress({ type: 'commit' });

        iterations++;
        continue;
      }

      if (finalText.length < 1) {
        finalText = 'Não foi possível gerar uma resposta: o modelo encerrou sem produzir texto.'
        $('agent:generation-empty', { sessionId, iteration: iterations })
      }

      await persistAssistantResponse(response, sessionId);
      durableRuns.checkpoint(durableRunId, { phase: 'assistant-final', iteration: iterations })

      
      
      
      maybeTitleSession(sessionId, callLLM)
        .then(title => { if (title) notifySessionsUpdated('titled', sessionId) })
        .catch(() => {})

      const pending = getPendingReset()
      if (pending) { clearPendingReset(); executeReset(pending.reason) }

      
      try {
        const toolCalls = getMessages(sessionId)
          .filter(m => m.role === 'assistant' && Array.isArray(m.tool_calls))
          .flatMap(m => m.tool_calls.map(tc => tc.name || tc.function?.name))
          .filter(Boolean)
        const msgs = getMessages(sessionId)
        const lastUserMsg = [...msgs].reverse().find(m => m.role === 'user')
        await metacore.learnTemplate({
          sessionId,
          objective: lastUserMsg?.content?.slice(0, 200) || '',
          toolsUsed: [...new Set(toolCalls)],
          template: `Pipeline concluída: ${toolCalls.slice(0, 5).join(' → ')}`,
        })
      } catch (e) {
        console.warn('[Metacore] learnTemplate falhou:', e.message)
      }
      
      $('agent:success', { sessionId, iteration: iterations, text: finalText || '[done]' });
      $('agent:outcome', {
        sessionId, runId: durableRunId, turnId: turnContext.turnId,
        ...outcomeEvaluator.evaluate(turnOutcomes, { finalText }),
        outcomes: turnOutcomes,
      })
      coordinator.transition('finalized', { iteration: iterations, reason: 'assistant-final' })

      return finalText;
    }

    const watchdogHit = watchdog.check(parsed.tool_calls)
    if (watchdogHit) {
      $('agent:loop-detected', { sessionId });

      await pushMessage(sessionId, { role: 'assistant', content: watchdogHit })
      await pushMessage(sessionId, {
        role: 'user',
        content: "[ReAct Insert] You got stuck in a loop and used the same tool repeatedly. Summarize the session (conversation history) from my second-to-last message to the most recent, using the same language as my previous messages. Return only the progress (if any) and options on how to continue (if applicable), using StructuredInput, Markmap (preferred), and D2. [/ReAct Insert]"
      });
      
      if (onProgress) onProgress({ type: 'commit' });

      continue;
      
      
      
    }

    if (onProgress) {
      const labels = parsed.tool_calls.map(tc => toolLabel(tc.name)).join(' · ')
      onProgress({ label: `${labels}...`, reasoning: parsed.reasoning ?? null, iteration: iterations, max: maxIterations })
    }

    
    if (parsed.reasoning) {
      const prompt = `
      Você é um destilador de memória para um agente autônomo.
Sua tarefa é analisar o 'Raciocínio Bruto' gerado pelo agente durante uma tarefa e extrair APENAS 'o ouro' (conhecimento reutilizável).

O que consideramos 'Ouro':
- Preferências ou restrições explícitas do usuário descobertas agora.
- Soluções de contorno (workarounds) para erros específicos de ferramentas.
- Fatos concretos deduzidos que serão úteis no futuro.

O que é 'Lixo' (Ignorar):
- O passo a passo da execução ("Vou chamar a ferramenta X").
- Resultados temporários que só servem para a iteração atual.
- Divagações genéricas.

Responda ESTRITAMENTE no seguinte formato JSON:
{
  "has_gold": boolean, // true apenas se encontrou algo da lista de 'Ouro'
  "category": "user_preference" | "tool_workaround" | "fact" | null,
  "golden_nugget": "Uma frase curta, direta e sem enrolação com a informação extraída, ou null."
}`;

      try {
        if (parsed.reasoning.length > 150) {
          const extract = await $('llm:call', {
            prompt,
            purpose: 'classification'
          });

          const distillation = JSON.parse(extract.text);
          const note = normalizeDistillation(distillation, {
            iteration: iterations,
            tools: parsed.tool_calls.map(tc => tc.name),
          })

          if (note) {
            $('bag:add', {
              sessionId,
              type: 'note',
              content: JSON.stringify(note)
            })
          }
        }
      } catch (e) { }
    }

    await persistAssistantResponse(response, sessionId)
    durableRuns.checkpoint(durableRunId, { phase: 'assistant-tools-persisted', iteration: iterations })
    
    
    if (onProgress) onProgress({ type: 'commit' })

    
    
    injectToolSession(parsed.tool_calls, sessionId)

    
    
    
    let pendingConfirmation = null
    const iterationOutcomes = []
    for (const tc of parsed.tool_calls) {
      checkAborted()
      
      
      
      
      onProgress?.({ type: 'tool-step', name: tc.name, input: tc.input, toolCallId: tc.id })
      setPrivilegedContext({ session_id: sessionId, tool_call: tc.name })
      const { blocked, confirmation, outcome } = await executeToolCall(tc)
      if (outcome) iterationOutcomes.push(outcome)
      
      
      
      
      if (onProgress && outcome) {
        let preview
        try {
          preview = typeof outcome.ok
            ? (outcome.ok ? outcome.value : outcome.error?.message)
            : null
          if (preview && typeof preview !== 'string') preview = JSON.stringify(preview)
        } catch { preview = '[resultado não serializável]' }
        onProgress({ type: 'tool-result', name: tc.name, content: preview ?? '', toolCallId: tc.id })
      }
      if (blocked) {
        if (confirmation) pendingConfirmation = confirmation
        break
      }
    }

    
    
    
    
    
    
    if (pendingConfirmation) {
      const block = '```thinkiac\n' + JSON.stringify(pendingConfirmation) + '\n```'
      const content = `${await confirmationIntro(pendingConfirmation)}\n\n${block}`
      await pushMessage(sessionId, { role: 'assistant', content })
      if (onProgress) onProgress({ type: 'commit' })
      $('agent:success', { sessionId, iteration: iterations, text: '[needs-confirmation]' })
      $('agent:outcome', {
        sessionId, runId: durableRunId, turnId: turnContext.turnId,
        ...outcomeEvaluator.evaluate(turnOutcomes), outcomes: turnOutcomes,
        completed: false, waitingApproval: true,
      })
      coordinator.transition('finalized', { iteration: iterations, reason: 'waiting-approval' })
      return content
    }
    

    
    try {
      const evaluation = outcomeEvaluator.evaluate(iterationOutcomes)
      const iterationErrors = iterationOutcomes.filter(outcome => !outcome.ok).map(outcome => outcome.error)
      await metacore.observe({
        sessionId,
        iteration: iterations,
        toolCalls: parsed.tool_calls.map(tc => ({ name: tc.name, input: tc.input })),
        errors: iterationErrors.length > 0 ? iterationErrors : [],
        outcomes: iterationOutcomes,
        duration: Date.now() - iterationStartedAt,
        madeProgress: evaluation.madeProgress,
        changedState: evaluation.changedState,
        verified: evaluation.verified,
        approximationLevel: _classifiedTools.get(sessionId) ? 'classified' : 'default',
      })
    } catch (e) {
      console.warn('[Metacore] observe falhou:', e.message)
    }
    
    if (meta.shouldReflect()) {
      const reflection = await meta.reflect()
      $('agent:reflection', { sessionId, iteration: iterations, reflection });

      if (onProgress) onProgress({ label: 'Reflexao concluida', reasoning: `${reflection.insights.length} insights`, iteration: iterations, max: maxIterations })
    }
  }

  if (meta.shouldReflect()) await meta.reflect()
  const rollbackMsg = await attemptLoopGuardRollback(sessionId)
  const limitMsg = `Limite de iteracoes atingido (${maxIterations}).`
  const finalMsg = rollbackMsg ? `${limitMsg}\n\n${rollbackMsg}` : limitMsg
  await pushMessage(sessionId, { role: 'assistant', content: finalMsg })
  $('agent:outcome', {
    sessionId, runId: durableRunId, turnId: turnContext.turnId,
    ...outcomeEvaluator.evaluate(turnOutcomes), outcomes: turnOutcomes,
    completed: false, reason: 'iteration-limit',
  })
  if (kernelStarted && coordinator.state !== 'finalized') {
    coordinator.transition('finalized', { iteration: iterations, reason: 'iteration-limit' })
  }

  const pending = getPendingReset()
  if (pending) { clearPendingReset(); executeReset(pending.reason) }

  return finalMsg
}























const WATCHDOG_EXACT_THRESHOLD = 3
const WATCHDOG_TOOL_THRESHOLD = 15

class SessionWatchdog {
  constructor() {
    this.exactCalls = new Map()
    this.toolCalls = new Map()
  }

  check(toolCalls) {
    for (const tc of toolCalls) {
      const exactKey = `${tc.name}:${JSON.stringify(tc.input)}`
      const exactCount = (this.exactCalls.get(exactKey) || 0) + 1
      this.exactCalls.set(exactKey, exactCount)
      if (exactCount >= WATCHDOG_EXACT_THRESHOLD) {
        return `Loop detectado: "${tc.name}" chamado ${exactCount}x com o mesmo input. Abortando.`
      }
      const toolCount = (this.toolCalls.get(tc.name) || 0) + 1
      this.toolCalls.set(tc.name, toolCount)
      
      
      
    }
    return null
  }
}
