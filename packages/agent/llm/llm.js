import { buildChatRequest, bagContextLimit } from './chat_request.js'
import { codexBagBinding } from '../core/bag_runtime.js'
import { runCodexAppServer } from './codex_app_server.js'
import { getPolicy as getCodexSessionPolicy } from '../../governance/lib/policy.js'


export function configuredCliTimeout(opts) {
  return Object.prototype.hasOwnProperty.call(opts ?? {}, 'timeout_ms')
    ? opts.timeout_ms
    : undefined
}









import { eventCall as $ } from '../host/agent_host.js'
import { getConfig, getDefaultModel, getEmbedModel } from '../utils/config.js'
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildSlots,
  getNextSlot,
  reportSlotSuccess,
  reportSlotFailure,
  notifySlotDisabled,
  getSlotStatus,
  permGateActive,
  resolvePermissionMode,
  acquireSlotLease,
} from './llm_keys.js'
import {
  expandModelChain, chainHasElm, resolveElm, isElm, listElms,
} from './elm.js'
import { execCliProvider, execCliProviderStream } from './cli_exec.js'
import { classifyCliFailure, cliFailureDisposition } from './cli_failures.js'
import { getBridgeToken } from '../core/session_channel.js'
import { openTurnTools } from '../core/turn_tools.js'
import { ensureCliSession, touchCliSession, withCliSessionLock, peekCliSession, resetCliSession } from './cli_sessions.js'
import {
  isAnthropicProvider,
  getAnthropicHeaders,
  buildAnthropicBody,
  anthropicResponseToOpenAIShape,
} from './providers/anthropic.js'
import { isMaritacaProvider, runMaritacaTurn } from './providers/maritaca.js'
import { isOllamaProvider, runOllamaTurn, ollamaHasModel } from './providers/ollama.js'
import { runMobileCloudTurn } from './providers/mobile_cloud.js'
import { createThinkTagFilter } from './stream_utils.js'
import { flattenToPrompt, buildCliToolsPreamble, extractCliToolCalls } from './text_tool_protocol.js'
import { serializeToolResult } from './tool_results.js'
import { resolveGlobalModelFresh } from './model_registry.js'
import { fetchWithRetry } from './http_retry.js'


const FATAL_ERRORS = new Set([401, 402, 403])

function httpFailureDisposition(response) {
  if (FATAL_ERRORS.has(response.status)) return { forceDisable: true, reason: 'invalid_credential' }
  if (response.status !== 429) return { forceDisable: false, reason: `http_${response.status}` }
  const raw = response.headers?.get?.('retry-after')
  const seconds = Number(raw)
  const date = Date.parse(raw)
  const cooldownMs = Number.isFinite(seconds) ? Math.max(1000, seconds * 1000)
    : Number.isFinite(date) ? Math.max(1000, date - Date.now()) : 60000
  return { forceDisable: true, reason: 'rate_limit', cooldownMs }
}








function normalizeCliResultUsage(resultEvent) {
  if (!resultEvent?.usage) return null
  return {
    prompt_tokens: resultEvent.usage.input_tokens || 0,
    completion_tokens: resultEvent.usage.output_tokens || 0,
    cost: typeof resultEvent.total_cost_usd === 'number' ? resultEvent.total_cost_usd : undefined,
  }
}














function textFromCliNdjson(stdout) {
  const raw = String(stdout || '')
  const blocks = []
  let resultText = ''
  let sawJson = false

  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed[0] !== '{') continue
    let obj
    try { obj = JSON.parse(trimmed) } catch { continue }
    sawJson = true
    if (obj?.type === 'assistant') {
      for (const b of obj.message?.content || []) {
        if (b?.type === 'text' && b.text) blocks.push(b.text)
      }
    } else if (obj?.type === 'result' && typeof obj.result === 'string') {
      resultText = obj.result
    }
  }

  if (!sawJson) return raw.trim()
  
  
  return (resultText || blocks.join('')).trim()
}

function getMimeType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const mimes = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif'
  };
  return mimes[ext] || 'application/octet-stream';
}
























/**
 * Executa um slot "modo cli" e devolve a resposta no formato chat-completions.
 * Lança em caso de falha — o chamador (callLLM) trata como qualquer outra
 * falha de slot (reportSlotFailure + tenta o próximo).
 *
 * Exportada (não só de uso interno de callLLM/callLLMStream) porque
 * run_engineer_task (builtin_tools.js) chama esse mesmo caminho diretamente
 * pra invocar um slot claude-cli fora do loop de resolução/model-chain —
 * `extraEnv` existe por causa disso: permite injetar env vars por-chamada
 * (ex.: AGENT_ENGINEER_SESSION_ID/AGENT_BASE_URL pra bridge do ask_user)
 * além do que já vem fixo em slot.cli.env (isolamento de conta).
 */


function lastUserMessage(messages) {
  if (!Array.isArray(messages)) return null
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i]
    if (m?.role === 'user') return typeof m.content === 'string' ? m.content : JSON.stringify(m.content)
  }
  return null
}






function discardsToolList(slot, cliOpts = null) {
  if (slot?.mode !== 'cli') return false
  if (slot.provider !== 'claude-cli' && slot.provider !== 'codex-cli') return false
  const opts = cliOpts ? { ...slot.cli?.opts, ...cliOpts } : slot.cli?.opts
  if (opts?.mcp === false) return false
  
  return !opts?.turnToolsToken
}

export async function runCliSlot(slot, chainModel, params) {
  if (params.cliOpts?.requireGovernedTools) throw new Error('Presence requer provider API com ferramentas mediadas; CLI nativa não aceita neste turno.');
  
  
  
  
  
  
  const opts = params.cliOpts ? { ...slot.cli.opts, ...params.cliOpts } : slot.cli.opts
  const usesMcp = (slot.provider === 'claude-cli' || slot.provider === 'codex-cli') && opts?.mcp !== false
  const sysMode = params.systemMode || opts?.system_prompt_mode || 'replace'
  if (slot.provider === 'codex-cli' && params.sessionId && params.cliOpts?.bagTaskId && getConfig()?.bag?.codex_resume === true) {
    return withCliSessionLock(slot.provider, params.sessionId, () => _runCliSlotInner(slot, chainModel, params, false))
  }
  const persist = slot.provider === 'claude-cli' && usesMcp && params.sessionId != null
    && opts?.persist_session !== false && sysMode !== 'append'
  if (persist) {
    return withCliSessionLock(slot.provider, params.sessionId, async () => {
      try {
        return await _runCliSlotInner(slot, chainModel, params, true)
      } catch (e) {
        
        
        
        
        
        if (isMissingSessionError(e) && peekCliSession(slot.provider, params.sessionId)) {
          resetCliSession(slot.provider, params.sessionId)
          console.warn(`[cli_sessions] resume falhou (${String(e.message || '').slice(0, 140)}); recomeçando sessão limpa para ${params.sessionId}`)
          return await _runCliSlotInner(slot, chainModel, params, true)
        }
        throw e
      }
    })
  }
  return _runCliSlotInner(slot, chainModel, params, false)
}




function isMissingSessionError(e) {
  const blob = `${e?.message || ''} ${e?.stderr || ''}`.toLowerCase()
  return /no conversation found|session .*not found|no session with|could not find session|invalid session|resume.*not found/.test(blob)
}

async function _runCliSlotInner(slot, chainModel, { system, messages, tools = [], extraEnv = null, onToken = null, onProgress = null, sessionId = null, systemMode = null, cliOpts = null, cwd = null, abortSignal = null }, persist = false) {
  const { bin, buildArgs } = slot.cli
  
  
  
  const opts = cliOpts ? { ...slot.cli.opts, ...cliOpts } : slot.cli.opts

  
  
  
  
  
  
  
  
  
  
  
  
  const permEnv = {}
  if (opts?.turnToolsToken) permEnv.AGENT_TURN_TOOLS_TOKEN = opts.turnToolsToken
  if (sessionId != null) {
    permEnv.AGENT_SESSION_ID = String(sessionId)
    if (!extraEnv?.AGENT_SESSION_TOKEN) permEnv.AGENT_SESSION_TOKEN = getBridgeToken()
    if (!extraEnv?.AGENT_BASE_URL) permEnv.AGENT_BASE_URL = process.env.AGENT_BASE_URL || 'http://localhost:5040'
  }
  if (permGateActive(opts)) {
    
    
    
    
    
    permEnv.AGENT_PERMISSION_MODE = resolvePermissionMode(opts)
    if (opts.risky_patterns) {
      permEnv.AGENT_PERMISSION_RISKY_PATTERNS = Array.isArray(opts.risky_patterns)
        ? opts.risky_patterns.join(',') : String(opts.risky_patterns)
    }
    if (opts.auto_allow_tools) {
      permEnv.AGENT_PERMISSION_AUTO_ALLOW = Array.isArray(opts.auto_allow_tools)
        ? opts.auto_allow_tools.join(',') : String(opts.auto_allow_tools)
    }
    if (opts.permission_fallback) permEnv.AGENT_PERMISSION_FALLBACK = String(opts.permission_fallback)
    if (opts.agent_base_url) permEnv.AGENT_BASE_URL = String(opts.agent_base_url)
    if (opts.permission_timeout_ms != null) permEnv.AGENT_PERMISSION_TIMEOUT_MS = String(opts.permission_timeout_ms)
  }
  const callEnv = (slot.cli?.env || extraEnv || Object.keys(permEnv).length)
    ? { ...slot.cli?.env, ...extraEnv, ...permEnv }
    : undefined

  
  
  
  
  
  
  
  
  
  
  
  
  
  const usesMcp = (slot.provider === 'claude-cli' || slot.provider === 'codex-cli') && opts?.mcp !== false
  const promptTools = usesMcp ? [] : tools

  
  
  
  
  
  
  if (usesMcp && tools.length && !opts?.turnToolsToken) {
    console.warn(`[llm] slot ${slot.provider} com MCP nativo: as ${tools.length} tools passadas na chamada foram DESCARTADAS — o subprocesso usa o catálogo MCP completo. Use strictTools para exigir a seleção.`)
  }

  
  
  
  
  
  
  const usesSystemFlag = slot.provider === 'claude-cli'

  
  
  
  
  
  
  
  
  let sessCwd = null, sessionUuid = null, resume = false
  if (persist) {
    const s = ensureCliSession(slot.provider, sessionId)
    sessCwd = s.cwd; sessionUuid = s.uuid; resume = !s.isNew
    console.log(`[cli_sessions] ${resume ? 'resume' : 'new'} ${slot.provider} session=${sessionId} uuid=${sessionUuid} cwd=${sessCwd}`)
  }

  
  
  const prompt = (persist && resume)
    ? (lastUserMessage(messages) ?? flattenToPrompt(null, messages, buildCliToolsPreamble(promptTools)))
    : flattenToPrompt(usesSystemFlag ? null : system, messages, buildCliToolsPreamble(promptTools))

  
  
  
  
  const codexStream = slot.provider === 'codex-cli' && (onToken || onProgress)
  
  
  
  
  
  
  const mcpEnv = {}
  for (const key of ['AGENT_TURN_TOOLS_TOKEN', 'AGENT_SESSION_ID', 'AGENT_SESSION_TOKEN', 'AGENT_BASE_URL', 'THINKIAC_MCP_TOKEN', 'AGENT_MCP_HTTP_URL']) {
    const value = callEnv?.[key] ?? (slot.provider === 'codex-cli' ? process.env[key] : undefined)
    if (value != null && value !== '') mcpEnv[key] = String(value)
  }
  const cliCtx = usesSystemFlag
    ? { system: resume ? null : system, systemMode, sessionUuid, resume, mcpEnv }
    : (Object.keys(mcpEnv).length || cwd ? { mcpEnv, workspaceDir: cwd } : undefined)
  if (slot.provider === 'codex-cli') {
    const codexCwd = opts?.cwd || cwd || process.cwd()
    const sessionPolicy = sessionId != null ? getCodexSessionPolicy(sessionId) : null
    const args = buildArgs(chainModel, opts, {
      ...cliCtx, workspaceDir: codexCwd, sessionPolicy, transport: 'app-server',
    })
    const binding = codexBagBinding(getConfig(), { sessionId, taskId: cliOpts?.bagTaskId }, {
      account: slot.id, cwd: codexCwd, home: callEnv?.CODEX_HOME || callEnv?.HOME || null,
      model: chainModel, bin, sessionPolicy,
    })
    const delivery = binding?.prepare(messages)
    
    
    const codexPrompt = delivery
      ? flattenToPrompt(system, delivery.messages, buildCliToolsPreamble(promptTools))
      : prompt
    const codexResult = await runCodexAppServer({
      resumeThreadId: binding?.threadId, onThread: binding ? value => binding.started(value) : null,
      bin, args, input: codexPrompt, cwd: codexCwd, env: callEnv, model: chainModel,
      
      
      sessionId, executionMode: opts.execution_mode ?? opts.executionMode ?? 'runtime-controlled',
      timeoutMs: configuredCliTimeout(opts), approvalTimeoutMs: opts?.permission_timeout_ms,
      signal: abortSignal, onToken,
      onProgress: event => {
        if (event.type === 'codex-usage') {
          const u = event.usage
          if (u) $('agent:token:usage', {
            usage: { prompt_tokens: u.inputTokens, completion_tokens: u.outputTokens, total_tokens: u.totalTokens },
            model: chainModel, provider: slot.provider, sessionId,
          })
        } else onProgress?.(event)
      },
    }).catch(error => {
      
      
      if (binding) error.noRetry = true
      throw error
    })
    try { binding?.completed(codexResult) }
    catch (error) { error.noRetry = true; throw error }
    return codexResult
  }
  const args = buildArgs(chainModel, codexStream ? { ...opts, stream: true } : opts, cliCtx)

  
  
  
  
  
  
  
  
  
  
  if ((opts?.stream || codexStream) && (onToken || onProgress)) {
    let finalText = ''
    let streamedText = ''
    
    
    
    
    const isCodex = slot.provider === 'codex-cli'
    let pendingMsg = null
    
    
    
    
    
    
    let codexError = null
    
    
    
    let sawResult = false
    const { stdout } = await execCliProviderStream({
      bin,
      args,
      input: prompt,
      cwd: opts?.cwd || sessCwd || undefined,
      timeoutMs: opts?.timeout_ms,
      env: callEnv,
      accountLabel: slot.cli?.account ?? null,
      onEvent: (obj) => {
        if (isCodex) {
          const ct = obj?.type
          if (ct === 'error' || ct === 'turn.failed') {
            codexError = obj.message || obj.error?.message || codexError
            return
          }
          if (ct === 'item.started') {
            const it = obj.item || {}
            if (it.type === 'command_execution' && onProgress) {
              onProgress({ type: 'tool-step', name: 'shell', input: it.command })
            } else if (it.type === 'mcp_tool_call' && onProgress) {
              onProgress({ type: 'tool-step', name: it.tool || it.tool_name || it.server || 'mcp', input: it.arguments ?? it.input ?? null })
            }
            return
          }
          if (ct === 'item.completed') {
            const it = obj.item || {}
            if (it.type === 'agent_message') {
              
              if (pendingMsg != null && onProgress) onProgress({ type: 'reasoning', text: pendingMsg })
              pendingMsg = it.text || ''
            } else if (it.type === 'command_execution' && onProgress) {
              const out = String(it.aggregated_output || '')
              onProgress({ type: 'tool-result', content: out.slice(0, 4000) })
            } else if (it.type === 'mcp_tool_call' && onProgress) {
              const r = it.result ?? it.output ?? ''
              onProgress({ type: 'tool-result', content: typeof r === 'string' ? r : JSON.stringify(r) })
            } else if (it.type === 'reasoning' && onProgress) {
              onProgress({ type: 'reasoning', text: it.text || it.summary || '' })
            }
            return
          }
          if (ct === 'turn.completed') {
            
            
            finalText = pendingMsg ?? finalText
            if (finalText && onToken) onToken(finalText)
            const u = obj.usage
            if (u && typeof $ !== 'undefined') {
              $('agent:token:usage', {
                usage: { prompt_tokens: u.input_tokens, completion_tokens: u.output_tokens, total_tokens: (u.input_tokens || 0) + (u.output_tokens || 0) },
                model: chainModel, provider: slot.provider, sessionId,
              })
            }
          }
          return
        }
        const t = obj?.type
        if (t === 'stream_event') {
          const ev = obj.event || {}
          if (ev.type === 'content_block_delta') {
            const d = ev.delta || {}
            if (d.type === 'text_delta' && d.text) {
              streamedText += d.text
              if (onToken) onToken(d.text)
            } else if (d.type === 'thinking_delta' && d.thinking) {
              if (onProgress) onProgress({ type: 'reasoning', text: d.thinking })
            }
          }
          return
        }
        if (t === 'assistant') {
          
          
          for (const b of (obj.message?.content || [])) {
            if (b?.type === 'tool_use' && onProgress) {
              onProgress({ type: 'tool-step', name: b.name, input: b.input })
            }
          }
          return
        }
        if (t === 'user') {
          for (const b of (obj.message?.content || [])) {
            if (b?.type === 'tool_result' && onProgress) {
              const c = b.content
              onProgress({ type: 'tool-result', tool_use_id: b.tool_use_id, content: typeof c === 'string' ? c : JSON.stringify(c) })
            }
          }
          return
        }
        if (t === 'result') {
          sawResult = true
          if (typeof obj.result === 'string') finalText = obj.result
          const usage = normalizeCliResultUsage(obj)
          if (usage && typeof $ !== 'undefined') {
            $('agent:token:usage', { usage, model: chainModel, provider: slot.provider, sessionId })
          }
        }
      },
    })
    
    
    
    
    
    
    
    
    
    
    const content = sawResult
      ? (finalText || pendingMsg || streamedText || '')
      : (finalText || pendingMsg || streamedText || textFromCliNdjson(stdout) || '')

    
    
    
    if (codexError && !finalText && !pendingMsg) {
      const err = new Error(`[cli:${bin}] ${codexError}`)
      err.failureKind = classifyCliFailure(codexError)
      err.stderr = codexError
      err.account = slot.cli?.account ?? null
      throw err
    }

    if (persist) touchCliSession(slot.provider, sessionId)
    return {
      choices: [{ message: { content, tool_calls: undefined }, finish_reason: 'stop' }],
      model: chainModel,
    }
  }

  const { stdout } = await execCliProvider({
    bin,
    args,
    input: prompt,
    cwd: opts?.cwd || sessCwd || undefined,
    
    
    
    timeoutMs: opts?.timeout_ms,
    env: callEnv, 
    accountLabel: slot.cli?.account ?? null,
  })

  
  
  
  
  
  
  let content = stdout
  if (opts?.stream) {
    let usage = null
    for (const line of stdout.split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      let obj
      try { obj = JSON.parse(trimmed) } catch { continue }
      if (obj?.type === 'result') usage = normalizeCliResultUsage(obj)
    }
    
    
    
    
    content = textFromCliNdjson(stdout)
    if (usage && typeof $ !== 'undefined') {
      $('agent:token:usage', { usage, model: chainModel, provider: slot.provider, sessionId })
    }
  }

  if (usesMcp) {
    if (persist) touchCliSession(slot.provider, sessionId)
    return {
      choices: [{ message: { content, tool_calls: undefined }, finish_reason: 'stop' }],
      model: chainModel,
    }
  }

  const { cleaned, toolCalls } = extractCliToolCalls(content)

  return {
    choices: [{
      message: {
        content: cleaned,
        tool_calls: toolCalls.length ? toolCalls : undefined,
      },
      finish_reason: toolCalls.length ? 'tool_calls' : 'stop',
    }],
    model: chainModel,
  }
}



/**
 * Carimba na resposta crua qual modelo/provider efetivamente respondeu.
 * Com pool, chain de fallback e ELM, o chamador não tem como saber: o modelo
 * pedido pode não ser o que respondeu. parseResponse() promove esses campos
 * para o topo, e daí eles chegam à UI (identificador de modelo por mensagem).
 */
function stampModel(data, { model, provider } = {}) {
  if (!data || typeof data !== 'object') return data
  try {
    data._model = model ?? null
    data._provider = provider ?? null
  } catch { /* resposta congelada: identificar o modelo nunca quebra o turno */ }
  return data
}

/**
 * Versão streaming de callLLM: faz fetch com stream:true, lê chunks SSE,
 * emite tokens via onToken(deltaText). Reconstrói resposta no mesmo formato
 * de callLLM() para compatibilidade com parseResponse().
 *
 * Aceita mesmos parâmetros de callLLM() + onToken callback.
 *
 * Failover (igual callLLM, mas no caminho streaming): se um slot falhar ANTES
 * de emitir qualquer token visível — caso típico do claude-cli quando o plano
 * acaba e o binário sai com código 1 na largada — tenta o próximo slot na
 * ordem "outra conta do MESMO provider primeiro, depois outro modelo base"
 * (ver orderSlotsForFallback). Só paramos de tentar quando algum texto já saiu
 * na UI (não dá pra "des-emitir" e recomeçar em outra conta sem duplicar a
 * resposta) ou quando esgotam os slots — e aí o erro é sanitizado antes de
 * subir, pra nunca vazar "[cli:claude] saiu com código 1"/stderr pro usuário.
 */
export async function callLLMStream({ system, messages, tools = [], model = null, requirements = null, abortSignal = null, sessionId = null, onToken = null, onProgress = null, cwd = null, cliOpts = null }) {
  messages = normalizeToolOrder(messages)
  const config = getConfig()
  const allSlots = buildSlots(config).filter(slot => !cliOpts?.requireGovernedTools || slot.mode !== 'cli')
  let slots = allSlots
  const resolution = !model ? await resolveGlobalModelFresh(requirements ?? { requires: { modalities: ['text:input'], ...(tools.length ? { tools: true } : {}) } }) : null
  const resolvedPoolName = resolution?.selected?.metadata?.poolName ?? null
  const explicitOverride = resolution?.source === 'override'
  const requestMaxTokens = resolveRequestMaxTokens(
    config,
    resolution?.selected,
    estimateRequestInputTokens({ system, messages, tools }),
  )
  if (resolution && !resolution.ok) throw new Error(`Nenhum modelo compatível: ${resolution.code}`)
  if (resolution?.selected) {
    model = resolution.selected.model
    const selectedSlots = slots.filter(slot => slot.poolName === resolution.selected.metadata?.poolName)
    if (selectedSlots.length) slots = selectedSlots
  }
  if (!slots.length) throw new Error('Nenhum pool LLM ativo.')

  
  
  
  const primary = getNextSlot(slots)
  const blockedIds = new Set(
    getSlotStatus(allSlots)
      .filter(status => status.blocked && status.id !== primary.id)
      .map(status => status.id)
  )
  const attemptOrder = orderSlotsForFallback(allSlots, slots, primary, {
    strictScope: explicitOverride,
    blockedIds,
  })

  
  
  
  
  let streamedAny = false
  const wrappedOnToken = onToken
    ? (delta) => { streamedAny = true; onToken(delta) }
    : null

  let lastError = null
  const maxAttempts = Math.min(attemptOrder.length, 6)
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const slot = attemptOrder[attempt]
    
    
    let elmModel = null
    if (isElm(model, config)) {
      const members = resolveElm(model, config).models
      elmModel = members.find(m => slot.provider === 'anthropic' ? !m.includes('/') : !/^claude-/.test(m))
        ?? members[0]
    }
    
    
    
    
    
    
    const routedModel = resolvedPoolName && slot.poolName !== resolvedPoolName ? null : model
    const chainModel = slot.provider === 'codex-cli'
      ? (elmModel || routedModel || slot.model || undefined)
      : (elmModel || routedModel || slot.model || getDefaultModel())
    try {
      const releaseSlot = await acquireSlotLease(slot, abortSignal)
      try { return await attemptStreamSlot(slot, chainModel) }
      finally { releaseSlot() }
    } catch (e) {
      if (!canFailoverAfter(e)) throw e
      lastError = e
      
      if (streamedAny) {
        throw explicitOverride
          ? sanitizePinnedProviderError(e, { model, poolName: resolvedPoolName })
          : sanitizeProviderError(e)
      }
      
    }
  }
  throw explicitOverride
    ? sanitizePinnedProviderError(lastError, { model, poolName: resolvedPoolName })
    : sanitizeProviderError(lastError)

  
  
  
  async function attemptStreamSlot(slot, chainModel) {

  
  
  
  
  
  let pendingVisibleText = ''
  const emitVisible = (text) => {
    if (!text) return
    if (tools.length > 0) pendingVisibleText += text
    else wrappedOnToken?.(text)
  }
  const flushVisible = () => {
    if (pendingVisibleText) {
      wrappedOnToken?.(pendingVisibleText)
      pendingVisibleText = ''
    }
  }

  
  
  
  
  
  if (slot.mode === 'cli') {
    
    
    
    const cliStreaming = (
      (slot.provider === 'claude-cli' && slot.cli?.opts?.stream) ||
      slot.provider === 'codex-cli'
    ) && (wrappedOnToken || onProgress)
    try {
      const data = await runCliSlot(slot, chainModel, {
        system, messages, tools, sessionId,
        cwd, abortSignal, cliOpts,
        onToken: cliStreaming ? emitVisible : null,
        onProgress: cliStreaming ? onProgress : null,
      })
      reportSlotSuccess(slot.id)
      const fullContent = data.choices[0].message.content
      if (!cliStreaming) emitVisible(fullContent)
      if (!cliStreaming && fullContent && typeof $ !== 'undefined') {
        $('agent:token:usage', { usage: { completion_tokens: fullContent.length }, model: chainModel, provider: slot.provider, sessionId })
      }
      if (data.choices?.[0]?.message?.tool_calls?.length) pendingVisibleText = ''
      else flushVisible()
      return stampModel(data, { model: chainModel, provider: slot.provider })
    } catch (e) {
      const disposition = cliFailureDisposition(e)
      const state = reportSlotFailure(slot.id, e.message, disposition)
      
      
      
      if (state.disabled && !state.disabled_until) notifySlotDisabled(slot, disposition.reason).catch(() => { })
      throw e
    }
  }

  
  
  
  
  
  if (isAnthropicProvider(slot.provider)) {
    let failureReported = false
    try {
      const anthropicBody = buildAnthropicBody({
        model: chainModel, system, messages, tools,
        maxTokens: requestMaxTokens, temperature: config.llm?.temperature,
      })
      const res = await fetchWithRetry(slot.url, {
        method: 'POST',
        headers: getAnthropicHeaders(slot),
        body: JSON.stringify(anthropicBody),
        signal: abortSignal ?? undefined,
      }, slot.retry)
      if (!res.ok) {
        const text = await res.text()
        const disposition = httpFailureDisposition(res)
        const state = reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`, disposition)
        failureReported = true
        if (state.disabled && !state.disabled_until) notifySlotDisabled(slot, disposition.reason).catch(() => { })
        throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
      }
      const data = anthropicResponseToOpenAIShape(await res.json())
      reportSlotSuccess(slot.id)
      const fullContent = data.choices[0].message.content
      emitVisible(fullContent)
      if (data.usage && typeof $ !== 'undefined') {
        $('agent:token:usage', { usage: data.usage, model: chainModel, provider: slot.provider, sessionId })
      }
      if (data.choices?.[0]?.message?.tool_calls?.length) pendingVisibleText = ''
      else flushVisible()
      return stampModel(data, { model: chainModel, provider: slot.provider })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      if (!failureReported) reportSlotFailure(slot.id, e.message)
      throw e
    }
  }

  
  
  
  
  
  if (isMaritacaProvider(slot.provider)) {
    let failureReported = false
    try {
      const data = await runMaritacaTurn(slot, { chainModel, system, messages, tools, onToken: emitVisible, onProgress, abortSignal })
      reportSlotSuccess(slot.id)
      if (data.choices?.[0]?.message?.tool_calls?.length) pendingVisibleText = ''
      else flushVisible()
      return stampModel(data, { model: chainModel, provider: slot.provider })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      if (FATAL_ERRORS.has(e.status)) {
        const state = reportSlotFailure(slot.id, e.message)
        failureReported = true
        if (state.disabled) notifySlotDisabled(slot).catch(() => { })
      }
      if (!failureReported) reportSlotFailure(slot.id, e.message)
      throw e
    }
  }

  
  
  
  
  
  
  if (isOllamaProvider(slot.provider)) {
    try {
      const data = await runOllamaTurn(slot, {
        chainModel, system, messages, tools,
        onToken: emitVisible, onProgress, abortSignal,
        maxTokens: requestMaxTokens, temperature: config.llm?.temperature,
        timeoutMs: config.llm?.timeout_ms,
      })
      reportSlotSuccess(slot.id)
      if (data.usage && typeof $ !== 'undefined') {
        $('agent:token:usage', { usage: data.usage, model: chainModel, provider: slot.provider, sessionId })
      }
      if (data.choices?.[0]?.message?.tool_calls?.length) pendingVisibleText = ''
      else flushVisible()
      return stampModel(data, { model: chainModel, provider: slot.provider })
    } catch (e) {
      if (e.name === 'AbortError') throw e
      reportSlotFailure(slot.id, e.message)
      throw e
    }
  }

  if (slot.provider === 'thinkiac-mobile-cloud') {
    const body = buildChatRequest({ model: chainModel, system, messages, tools, maxTokens: requestMaxTokens, temperature: config.llm?.temperature, slot, sessionId })
    const data = await runMobileCloudTurn(chainModel, body)
    reportSlotSuccess(slot.id)
    const text = data.choices?.[0]?.message?.content
    if (text) emitVisible(text)
    return stampModel(data, { model: chainModel, provider: slot.provider })
  }

  const body = buildChatRequest({ model: chainModel, system, messages, tools, stream: true,
    maxTokens: requestMaxTokens, temperature: config.llm?.temperature, slot, sessionId,
    openrouter: config.llm?.openrouter,
    contextLimit: bagContextLimit(config, slot, chainModel, resolution?.selected),
    onBudget: budget => $('agent:bag:budget', { sessionId, model: chainModel, provider: slot.provider, ...budget }),
  })

  const res = await fetchWithRetry(slot.url, {
    method: 'POST',
    headers: slot.headers,
    body: JSON.stringify(body),
    signal: abortSignal ?? undefined,
  }, slot.retry)

  if (!res.ok) {
    const text = await res.text()
    const disposition = httpFailureDisposition(res)
    const state = reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`, disposition)
    if (state.disabled && !state.disabled_until) notifySlotDisabled(slot, disposition.reason).catch(() => { })
    throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
  }

  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  let fullContent = ''
  let fullReasoning = ''
  const toolCallsAccum = {}  

  
  
  
  
  
  const thinkFilter = createThinkTagFilter(
    (text) => { fullContent += text; emitVisible(text) },
    (text) => { fullReasoning += text; if (onProgress) onProgress({ type: 'reasoning', text }) }
  )

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })

    const lines = buffer.split('\n')
    buffer = lines.pop()  

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6).trim()
      if (data === '[DONE]') break

      let chunk
      try { chunk = JSON.parse(data) } catch { continue }

      
      
      
      
      if (chunk?.error) {
        const message = typeof chunk.error === 'string'
          ? chunk.error
          : chunk.error.message || 'O provider encerrou o stream com erro.'
        const error = new Error(message)
        error.code = chunk.error.type || chunk.error.code || 'stream_error'
        throw error
      }

      const delta = chunk.choices?.[0]?.delta
      if (!delta) continue

      
      if (delta.content) thinkFilter.push(delta.content)

      
      
      
      if (delta.reasoning_content) {
        fullReasoning += delta.reasoning_content
        if (onProgress) onProgress({ type: 'reasoning', text: delta.reasoning_content })
      }

      
      if (delta.tool_calls) {
        for (const tc of delta.tool_calls) {
          const idx = tc.index
          if (!toolCallsAccum[idx]) {
            toolCallsAccum[idx] = { id: tc.id || `call_${idx}`, function: { name: '', arguments: '' } }
          }
          if (tc.id) toolCallsAccum[idx].id = tc.id
          if (tc.function?.name) toolCallsAccum[idx].function.name += tc.function.name
          if (tc.function?.arguments) toolCallsAccum[idx].function.arguments += tc.function.arguments
        }
      }
    }
  }
  thinkFilter.end()

  reportSlotSuccess(slot.id)

  
  const toolCalls = Object.values(toolCallsAccum)
  const finishReason = toolCalls.length > 0 ? 'tool_calls' : 'stop'

  if (toolCalls.length === 0) flushVisible()

  if (fullContent && typeof $ !== 'undefined') {
    $('agent:token:usage', { usage: { completion_tokens: fullContent.length }, model: chainModel, provider: slot.provider, sessionId })
  }

  return stampModel({
    choices: [{
      message: {
        content: fullContent,
        reasoning_content: fullReasoning || undefined,
        tool_calls: toolCalls.length > 0 ? toolCalls.map(tc => ({ ...tc, type: 'function' })) : undefined,
      },
      finish_reason: finishReason,
    }],
    model: chainModel,
  }, { model: chainModel, provider: slot.provider })
  } 
}



/**
 * Ordena os slots pra tentar na sequência que o usuário espera quando um
 * provider falha: a conta atual, depois AS OUTRAS CONTAS DO MESMO PROVIDER
 * (ex.: pool claude-cli com N logins), e só então escala pra outros modelos
 * base (demais slots do pool do propósito e, por fim, o conjunto completo).
 * Sem duplicar slots (dedupe por id).
 */
export function orderSlotsForFallback(allSlots, usableSlots, primary, { strictScope = false, blockedIds = new Set() } = {}) {
  const seen = new Set()
  const order = []
  const add = (s) => {
    if (s && !blockedIds.has(s.id) && !seen.has(s.id)) {
      seen.add(s.id)
      order.push(s)
    }
  }
  add(primary)                                                          
  for (const s of usableSlots) if (s.provider === primary.provider) add(s) 
  for (const s of usableSlots) add(s)                                    
  if (!strictScope) {
    for (const s of allSlots) add(s)                                     
  }
  return order
}

/** Trocar de slot só é seguro antes de cancelamento ou qualquer efeito do turno. */
export function canFailoverAfter(error) {
  return error?.name !== 'AbortError' && !error?.noRetry
}

/**
 * Resolve o teto de saída da requisição. Em pools free, `tpm` é também o
 * maior orçamento que uma única chamada pode pedir sem ser rejeitada antes
 * da geração. O menor teto declarado sempre vence.
 */
export function resolveRequestMaxTokens(config, selectedAccess = null, estimatedInputTokens = 0) {
  const configured = Number(config?.llm?.max_tokens)
  const maxOutput = Number(selectedAccess?.capabilities?.maxOutputTokens)
  const tpm = Number(selectedAccess?.metadata?.limits?.tpm)
  const tpmOutputBudget = Number.isFinite(tpm) && tpm > 0
    ? Math.max(1, tpm - Math.max(0, Number(estimatedInputTokens) || 0))
    : null
  const ceilings = [configured, maxOutput, tpmOutputBudget].filter(value => Number.isFinite(value) && value > 0)
  return ceilings.length ? Math.floor(Math.min(...ceilings)) : null
}

/** Estimativa conservadora para reservar o pedaço do TPM gasto pelo prompt. */
export function estimateRequestInputTokens({ system = '', messages = [], tools = [] } = {}) {
  let chars = String(system).length
  try { chars += JSON.stringify(messages ?? []).length } catch { chars += String(messages).length }
  try { chars += JSON.stringify(tools ?? []).length } catch { chars += String(tools).length }
  
  
  return Math.ceil(chars / 3.5) + 32
}

/**
 * Converte a última falha de provider numa Error limpa pro usuário. O detalhe
 * cru (ex.: "[cli:claude] saiu com código 1" + stderr do binário) fica só no
 * log do servidor — NUNCA sobe pra UI (routes/chat.js emite `err.message`).
 * O erro original vai preservado em `.cause` pra debugging programático.
 */
export function sanitizeProviderError(err) {
  const detail = err?.message || String(err ?? 'desconhecido')
  console.warn(`[llm] Todos os slots/modelos falharam — último erro: ${detail}`)
  if (err?.stderr) console.warn(`[llm] stderr do provider: ${err.stderr}`)
  const clean = new Error(
    'Não consegui gerar uma resposta agora — todas as contas e modelos disponíveis falharam. Tente novamente em instantes.'
  )
  clean.cause = err
  clean.sanitized = true
  return clean
}

/** Erro seguro e específico para um override manual que não fez failover. */
export function sanitizePinnedProviderError(err, { model, poolName } = {}) {
  const detail = err?.message || String(err ?? 'desconhecido')
  console.warn(`[llm] Override ${model ?? 'desconhecido'}@${poolName ?? 'desconhecido'} falhou: ${detail}`)
  const isDeviceLocal = poolName === 'thinkiac-mobile-local'
  const clean = new Error(
    `O modelo selecionado "${model ?? 'desconhecido'}" falhou no pool "${poolName ?? 'desconhecido'}"; ` +
    (isDeviceLocal
      ? 'não troquei automaticamente para outro provider. Verifique se o modelo foi baixado e se o Runtime local está online.'
      : 'não troquei automaticamente para outro provider. Verifique a chave, a cota e a disponibilidade desse pool.')
  )
  clean.cause = err
  clean.sanitized = true
  clean.pinned = true
  return clean
}



/**
 * Executa uma chamada chat-completion roteando pelo próximo slot disponível.
 *
 * Em caso de erro fatal (4xx acima), o slot é penalizado e a chamada
 * é automaticamente refeita no próximo slot (até MAX_RETRIES tentativas).
 *
 * @param {{
 *   system:   string,
 *   messages: { role: string, content: any }[],
 *   tools?:   object[],
 *   model?:   string | null
 * }} opts
 * @returns {Promise<object>}  Resposta raw da API (formato OpenAI-compatible)
 */
export async function callLLM({ system, messages, tools = [], model = null, requirements = null, abortSignal = null, sessionId = null, strictTools = false, cwd = null, cliOpts = null }) {
  messages = normalizeToolOrder(messages)
  const config = getConfig()
  let allSlots = buildSlots(config).filter(slot => !cliOpts?.requireGovernedTools || slot.mode !== 'cli')
  let slots = allSlots

  const resolution = !model ? await resolveGlobalModelFresh(requirements ?? { requires: { modalities: ['text:input'], ...(tools.length ? { tools: true } : {}) } }) : null
  const resolvedPoolName = resolution?.selected?.metadata?.poolName ?? null
  const explicitOverride = resolution?.source === 'override'
  const requestMaxTokens = resolveRequestMaxTokens(
    config,
    resolution?.selected,
    estimateRequestInputTokens({ system, messages, tools }),
  )
  if (resolution && !resolution.ok) throw new Error(`Nenhum modelo compatível: ${resolution.code}`)
  if (resolution?.selected) {
    model = resolution.selected.model
    const selectedSlots = slots.filter(slot => slot.poolName === resolution.selected.metadata?.poolName)
    if (selectedSlots.length) slots = selectedSlots
  }

  if (!slots.length) {
    throw new Error(
      'Nenhum pool LLM ativo. Configure llm.pools em agent.config.json.'
    )
  }

  
  
  
  
  
  
  
  
  
  
  if (strictTools) {
    const direct = allSlots.filter(s => !discardsToolList(s, cliOpts))
    if (!direct.length) {
      throw new Error(
        'strictTools: nenhum pool LLM consegue respeitar o catálogo explícito desta chamada.'
      )
    }
    allSlots = direct
    slots = slots.filter(s => direct.includes(s))
  }

  let usableSlots = slots
  const elmChain = model ? [model] : []

  
  
  
  
  
  
  
  
  try {
    return await attemptPool(usableSlots)
  } catch (narrowError) {
    if (!canFailoverAfter(narrowError)) throw narrowError
    if (explicitOverride) {
      throw sanitizePinnedProviderError(narrowError, { model, poolName: resolvedPoolName })
    }
    if (usableSlots === allSlots) throw narrowError
    return await attemptPool(allSlots)
  }

  async function attemptPool(pool) {
  const maxRetries = Math.min(pool.length, 5)
  let lastError = null

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    const slot = getNextSlot(pool)
    const routedModel = resolvedPoolName && slot.poolName !== resolvedPoolName ? null : model

    
    const rawChain = routedModel
      ? [routedModel]
      : [slot.model ?? getDefaultModel()]
    
    
    
    
    const chainFromElm = chainHasElm(rawChain, config)
    let modelChain = expandModelChain(rawChain, config)

    
    
    
    
    
    
    
    if (slot.provider === 'codex-cli') {
      
      
      
      
      modelChain = [slot.model]
    } else if (slot.mode === 'cli' || isMaritacaProvider(slot.provider)) {
      modelChain = [slot.model ?? modelChain[0]]
    } else if (!routedModel || chainFromElm) {
      
      
      
      
      
      
      
      modelChain = slot.provider === 'anthropic'
        ? modelChain.filter(m => !m.includes('/'))
        : modelChain.filter(m => !/^claude-/.test(m))
      if (!modelChain.length) modelChain = [slot.model ?? getDefaultModel()]
    }

    
    let slotSucceeded = false
    for (const chainModel of modelChain) {
      let failureReported = false
      const releaseSlot = await acquireSlotLease(slot, abortSignal)

      try {
        let data

        if (slot.mode === 'cli') {
          
          
          
          
          data = await runCliSlot(slot, chainModel, { system, messages, tools, sessionId, cwd, abortSignal, cliOpts })
        } else if (isAnthropicProvider(slot.provider)) {
          
          
          
          
          const anthropicBody = buildAnthropicBody({
            model: chainModel,
            system,
            messages,
            tools,
            maxTokens: requestMaxTokens,
            temperature: config.llm?.temperature,
          })

          const res = await fetchWithRetry(slot.url, {
            method: 'POST',
            headers: getAnthropicHeaders(slot),
            body: JSON.stringify(anthropicBody),
            signal: abortSignal ?? undefined,
          }, slot.retry)

          if (FATAL_ERRORS.has(res.status) || res.status === 429) {
            const text = await res.text()
            const state = reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`, httpFailureDisposition(res))
            failureReported = true
            if (state.disabled && !state.disabled_until) notifySlotDisabled(slot).catch(() => { })
            lastError = new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
            break 
          }

          if (!res.ok) {
            throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${await res.text()}`)
          }

          data = anthropicResponseToOpenAIShape(await res.json())
        } else if (isMaritacaProvider(slot.provider)) {
          
          
          
          
          
          try {
            data = await runMaritacaTurn(slot, { chainModel, system, messages, tools, abortSignal })
          } catch (e) {
            if (FATAL_ERRORS.has(e.status)) {
              const state = reportSlotFailure(slot.id, e.message)
              failureReported = true
              if (state.disabled) notifySlotDisabled(slot).catch(() => { })
              lastError = e
              break
            }
            throw e
          }
        } else if (isOllamaProvider(slot.provider)) {
          
          
          
          data = await runOllamaTurn(slot, {
            chainModel, system, messages, tools, abortSignal,
            maxTokens: requestMaxTokens, temperature: config.llm?.temperature,
            timeoutMs: config.llm?.timeout_ms,
          })
        } else if (slot.provider === 'thinkiac-mobile-cloud') {
          const body = buildChatRequest({ model: chainModel, system, messages, tools,
            maxTokens: requestMaxTokens, temperature: config.llm?.temperature, slot, sessionId })
          data = await runMobileCloudTurn(chainModel, body)
        } else {
          const body = buildChatRequest({ model: chainModel, system, messages, tools,
            maxTokens: requestMaxTokens, temperature: config.llm?.temperature, slot, sessionId,
            openrouter: config.llm?.openrouter,
            contextLimit: bagContextLimit(config, slot, chainModel, resolution?.selected),
            onBudget: budget => $('agent:bag:budget', { sessionId, model: chainModel, provider: slot.provider, ...budget }),
          })

          const res = await fetchWithRetry(slot.url, {
            method: 'POST',
            headers: slot.headers,
            body: JSON.stringify(body),
            signal: abortSignal ?? undefined,
          }, slot.retry)

          if (FATAL_ERRORS.has(res.status) || res.status === 429) {
            const text = await res.text()
            const state = reportSlotFailure(slot.id, `HTTP ${res.status}: ${text}`, httpFailureDisposition(res))
            failureReported = true
            if (state.disabled && !state.disabled_until) notifySlotDisabled(slot).catch(() => { })
            lastError = new Error(`[${slot.poolName}] HTTP ${res.status}: ${text}`)
            break 
          }

          if (!res.ok) {
            throw new Error(`[${slot.poolName}] HTTP ${res.status}: ${await res.text()}`)
          }

          data = await res.json()
        }

        reportSlotSuccess(slot.id)

        if (data.usage && typeof $ !== 'undefined') {
          $('agent:token:usage', { usage: data.usage, model: chainModel, provider: slot.provider, sessionId })
          /**
           * "usage": {
           *   "prompt_tokens": 50,
           *   "completion_tokens": 120,
           *   "total_tokens": 170
           * }
           */
        }

        return stampModel(data, { model: chainModel, provider: slot.provider })

      } catch (e) {
        if (e.name === 'AbortError' || e.noRetry) throw e
        lastError = e
        if (!failureReported) {
          
          
          
          const disposition = slot.mode === 'cli'
            ? cliFailureDisposition(e)
            : { reason: null, forceDisable: false, cooldownMs: 0 }
          const state = reportSlotFailure(slot.id, e.message, disposition)
          if (slot.mode === 'cli' && state.disabled && !state.disabled_until) {
            notifySlotDisabled(slot, disposition.reason).catch(() => { })
          }
        }
        
      } finally {
        releaseSlot()
      }
    }

    if (slotSucceeded) break
  }

  throw sanitizeProviderError(lastError)
  } 
}



/**
 * Gera embedding vetorial para um texto.
 * Usa o próximo slot ativo (mesma seleção round-robin do callLLM).
 *
 * @param   {string} text
 * @returns {Promise<number[]>}
 */
export async function getEmbedding(text) {
  /**
   * @register_hook llm:embed
   */
  const config = getConfig()
  
  
  
  
  
  
  const slots = buildSlots(config).filter(s =>
    s.mode !== 'cli' && !isAnthropicProvider(s.provider) && !isMaritacaProvider(s.provider) &&
    (!isOllamaProvider(s.provider) || ollamaHasModel(s.baseUrl, s.embedModel)))

  if (!slots.length) {
    throw new Error(
      'Nenhum pool HTTP configurado para embeddings (providers "modo cli" e Anthropic não suportam embeddings).'
    )
  }

  const slot = getNextSlot(slots)
  const embedModel = slot.embedModel ?? getEmbedModel()

  const res = await fetch(slot.embedUrl, {
    method: 'POST',
    headers: slot.headers,
    body: JSON.stringify({ model: embedModel, input: text }),
  })

  if (!res.ok) {
    throw new Error(`Embedding [${slot.poolName}] ${res.status}: ${await res.text()}`)
  }

  return (await res.json()).data[0].embedding
}



export function parseResponse(r) {
  
  
  
  const msg = r.choices?.[0]?.message ?? {}
  let rawContent = msg.content ?? ''

  
  let cot = null
  let visibleContent = rawContent

  const thinkMatch = rawContent.match(/<(?:think|thinking|thought)>([\s\S]*?)<\/(?:think|thinking|thought)>/i)
  if (thinkMatch) {
    cot = thinkMatch[1].trim()
    visibleContent = rawContent.replace(/<(?:think|thinking|thought)>[\s\S]*?<\/(?:think|thinking|thought)>/gi, '').trim()
  }

  return {
    stop_reason: r.choices?.[0]?.finish_reason ?? 'stop',
    model: r._model ?? null,
    provider: r._provider ?? null,
    text: visibleContent,
    reasoning: msg.reasoning_content ?? msg.reasoning ?? null,
    cot,
    cot_parsed: cot ? parseCoTBlock(cot) : null,
    tool_calls: (msg.tool_calls ?? []).map(tc => {
      let parsedInput = {}
      try {
        parsedInput = JSON.parse(tc.function.arguments ?? '{}')
      } catch (e) {
        console.warn(`[LLM] Tool call "${tc.function.name}" arguments contém JSON inválido: ${e.message}. Usando fallback.`)
        parsedInput = { _raw: tc.function.arguments, _error: e.message }
      }
      return {
        id: tc.id,
        name: tc.function.name,
        input: parsedInput,
      }
    }),
  }
}

function parseCoTBlock(cotText) {
  const result = {
    objetivo: null,
    hipotese: null,
    acao: null,
    alternativas: null,
    confianca: null,
    fallback: null,
  }

  const fieldPatterns = {
    objetivo: /objetivo[:：]\s*(.+?)(?=\n|$)/i,
    hipotese: /hipotese[:：]\s*(.+?)(?=\n|$)/i,
    acao: /acao[:：]\s*(.+?)(?=\n|$)/i,
    alternativas: /alternativas[:：]\s*(.+?)(?=\n|$)/i,
    confianca: /confianca[:：]\s*(\d+)/i,
    fallback: /fallback[:：]\s*(.+?)(?=\n|$)/i,
  }

  for (const [key, pattern] of Object.entries(fieldPatterns)) {
    const match = cotText.match(pattern)
    if (match) {
      result[key] = key === 'confianca' ? parseInt(match[1], 10) : match[1].trim()
    }
  }

  return result
}









export function normalizeToolOrder(messages) {
  if (!Array.isArray(messages)) return messages
  const out = []
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg?.role === 'assistant' && Array.isArray(msg.tool_calls) && msg.tool_calls.length > 0) {
      const seen = new Set()
      const calls = msg.tool_calls.filter(tc => tc?.id && !seen.has(tc.id) && seen.add(tc.id))
      const { tool_calls, ...rest } = msg
      if (calls.length === 0) { out.push(rest); continue }
      const byId = new Map()
      let j = i + 1
      while (j < messages.length && messages[j]?.role === 'tool') {
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
    if (msg?.role === 'tool') continue 
    out.push(msg)
  }
  return out
}

export function buildAssistantMessage(r) {
  const m = r.choices?.[0]?.message ?? {}
  return {
    ...m,
    content: m.content ?? '',
    reasoning_content: m.reasoning_content ?? m.reasoning ?? undefined,
    
    
    model: r._model ?? undefined,
    provider: r._provider ?? undefined,
  }
}

export function buildToolResultMessage(id, content, is_error = false) {
  const t = serializeToolResult(content)
  return { role: 'tool', tool_call_id: id, content: is_error ? `ERROR: ${t}` : t }
}


















export async function callLlm(payload) {
  /**
   * @register_tool call_llm
   * @description Chama a LLM configurada da Agent (provider/model do agent.config.json). Use para geração de texto, sumarização, classificação, extração etc. sem precisar configurar provider ou api_key.
   * @param {string?} prompt - Prompt simples (atalho para mensagem única de usuário)
   * @param {string?} system - System prompt (padrão: assistente genérico)
   * @param {string?} model - Override do modelo (padrão: usa pool ativo do config)
   * @param {object?} requirements - Contrato de capacidades, preferências e política.
   */
  const {
    prompt = null,
    system = 'You are a helpful assistant.',
    model = null,
    requirements = null,
  } = payload ?? {}

  if (!prompt) throw new Error('`prompt` é obrigatório')

  const response = await callLLM({
    system,
    messages: [{ role: 'user', content: prompt }],
    tools: [],
    model,
    requirements,
  })

  const parsed = parseResponse(response)

  return {
    success: true,
    text: parsed.text,
    model: response.model ?? null,
  }
}















const AGENT_MAX_STEPS = 6
const AGENT_MAX_TOOL_RESULT = 4000










/**
 * Extrai o primeiro objeto/array JSON de uma resposta de modelo.
 *
 * Modelo respondendo JSON quase sempre erra a moldura, não o conteúdo: envolve
 * em ```json, ou escreve "Aqui está:" antes. Rejeitar isso desperdiçaria uma
 * resposta boa, então varremos da primeira chave até o fechamento equilibrado.
 *
 * @param   {string} text
 * @returns {object|array|null} null = não havia JSON na resposta
 */
function extractJsonBlock(text) {
  const blob = String(text || '')
  const fenced = blob.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidates = fenced ? [fenced[1], blob] : [blob]

  for (const raw of candidates) {
    const src = raw.trim()
    const start = src.search(/[{[]/)
    if (start === -1) continue

    
    
    const open = src[start]
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let escaped = false
    for (let i = start; i < src.length; i++) {
      const ch = src[i]
      if (inStr) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inStr = false
        continue
      }
      if (ch === '"') inStr = true
      else if (ch === open) depth++
      else if (ch === close && --depth === 0) {
        try { return JSON.parse(src.slice(start, i + 1)) } catch { break }
      }
    }
  }
  return null
}

/**
 * Validação rasa contra o schema: tipo do topo e chaves `required` presentes.
 *
 * De propósito não é um validador de JSON Schema completo — o objetivo aqui é
 * decidir "vale a pena mandar o modelo tentar de novo?", e as falhas reais
 * observadas são estruturais (devolveu prosa, faltou um campo). Validação
 * profunda pediria uma dependência nova para pegar casos que o consumidor
 * (packages/tasks, deep-research) já checa por conta.
 *
 * @returns {string|null} mensagem do problema, ou null se passou
 */
function schemaMismatch(value, schema) {
  const want = schema?.type
  if (want === 'array' && !Array.isArray(value)) return 'esperado um array JSON no topo'
  if (want === 'object' || !want) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return 'esperado um objeto JSON no topo'
  }
  const required = Array.isArray(schema?.required) ? schema.required : []
  const missing = required.filter(k => value?.[k] === undefined)
  return missing.length ? `faltam os campos obrigatórios: ${missing.join(', ')}` : null
}

/** Instrução de formato anexada ao system quando há `output_schema`. */
function schemaInstruction(schema) {
  return '\n\nResponda SOMENTE com um JSON válido que satisfaça este JSON Schema, ' +
    'sem prosa e sem cercas de código:\n' + JSON.stringify(schema)
}

export async function callLlmAgent(payload) {
  /**
   * @register_tool call_llm_agent
   * @description Loop de agente CRU: chama a LLM com exatamente as tools listadas em `tool_names` (sem o catálogo MCP inteiro do Claude Code) e executa as tools que o modelo pedir. Lista vazia = nenhuma tool, só geração de texto. Use quando quiser controlar precisamente o que o agente enxerga — e o quanto custa.
   * @param {string} prompt - Objetivo/pergunta para o agente
   * @param {string?} system - System prompt (padrão: assistente genérico)
   * @param {string[]?} tool_names - Nomes EXATOS das tools liberadas. Vazio/omitido = nenhuma tool.
   * @param {string?} model - Override do modelo (padrão: pool ativo do config)
   * @param {object?} requirements - Contrato de capacidades, preferências e política.
   * @param {number?} max_steps - Teto de rodadas de tool-calling (padrão 6)
 * @param {object?} output_schema - JSON Schema da resposta final. Quando presente, o retorno traz `output` já parseado e validado (mesmo contrato do runAgentTask do lógos).
   * @param {object[]?} tool_bindings - Bindings compilados pelo Flow. Campos fixos não são mostrados ao modelo e prevalecem na execução.
   */
  const {
    prompt = null,
    system = 'You are a helpful assistant.',
    tool_names = [],
    model = null,
    requirements = null,
    max_steps = AGENT_MAX_STEPS,
    output_schema = null,
    tool_bindings = [],
  } = payload ?? {}

  if (!prompt) throw new Error('`prompt` é obrigatório')

  const schema = output_schema && typeof output_schema === 'object' ? output_schema : null
  const systemPrompt = schema ? `${system}${schemaInstruction(schema)}` : system

  const wanted = Array.isArray(tool_names) ? tool_names.filter(Boolean) : []
  const bindingsByName = new Map((Array.isArray(tool_bindings) ? tool_bindings : []).filter(b => b?.name).map(b => [b.name, b]))
  const maxSteps = Math.min(Math.max(Number(max_steps) || AGENT_MAX_STEPS, 1), 20)

  
  
  let tools = []
  let invoke = null
  if (wanted.length) {
    const bridge = await import('../core/runtime_bridge.js')
    invoke = bridge.invokeRuntimeTool
    const all = await bridge.discoverRuntimeTools()
    const byName = new Map(all.map(t => [t.name, t]))
    const missing = wanted.filter(n => !byName.has(n))
    if (missing.length) throw new Error(`tools inexistentes: ${missing.join(', ')}`)
    
    
    
    tools = wanted.map(n => {
      const t = byName.get(n)
      return {
        name: t.name,
        description: t.description || '',
        input_schema: bindingsByName.get(n)?.inputSchemaForModel || t.parameters || { type: 'object', properties: {} },
      }
    })
  }

  const messages = [{ role: 'user', content: prompt }]
  const trace = []
  let repaired = false 

  const executeSelectedTool = async (name, rawArgs, step) => {
    if (!wanted.includes(name)) throw new Error(`tool "${name}" não está liberada para este agente`)
    let args = rawArgs && typeof rawArgs === 'object' ? rawArgs : {}
    const binding = bindingsByName.get(name)
    if (binding) {
      args = { ...args, ...(binding.fixedArgs || {}) }
      const effectiveSchema = binding.schema
      const missing = (effectiveSchema?.required || []).filter(key => !Object.prototype.hasOwnProperty.call(args, key))
      if (missing.length) throw new Error(`argumentos obrigatórios ausentes: ${missing.join(', ')}`)
      for (const [key, spec] of Object.entries(effectiveSchema?.properties || {})) {
        if (!Object.prototype.hasOwnProperty.call(args, key) || !spec?.type) continue
        const actual = Array.isArray(args[key]) ? 'array' : (args[key] === null ? 'null' : typeof args[key])
        if (actual !== spec.type && !(args[key] === null && spec.nullable)) throw new Error(`argumento "${key}" deve ser ${spec.type}, recebido ${actual}`)
      }
    }
    const { getRuntimeExecutionContext } = await import('../core/runtime_execution_context.js')
    const parent = getRuntimeExecutionContext()
    const result = await invoke(null, name, args, parent ? {
      ...parent,
      flowContext: { ...(parent.flowContext || {}), toolBindingNodeId: binding?.id || null },
      authorize: () => parent.authorize?.({ name, input: args, nested: true, toolBindingNodeId: binding?.id || null }),
    } : { sessionId: null })
    trace.push({ step, tool: name, bindingId: binding?.id || undefined, aiArgNames: Object.keys(rawArgs || {}), fixedArgNames: binding?.fixedArgNames || [] })
    return result
  }

  for (let step = 0; step < maxSteps; step++) {
    
    
    
    
    const turnTools = openTurnTools(null, tools, (name, args) => executeSelectedTool(name, args, step))
    let response
    try {
      response = await callLLM({
        system: systemPrompt,
        messages,
        tools,
        model,
        requirements: requirements ?? {
          requires: { modalities: ['text:input'], ...(tools.length ? { tools: true } : {}) },
        },
        strictTools: true,
        cliOpts: { turnToolsToken: turnTools.token },
      })
    } finally {
      turnTools.close()
    }
    const parsed = parseResponse(response)
    const calls = parsed.tool_calls ?? []

    if (!calls.length) {
      const done = { success: true, text: parsed.text, model: response.model ?? null, steps: step + 1, tools: wanted, trace }
      if (!schema) return done

      const output = extractJsonBlock(parsed.text)
      const problem = output === null ? 'a resposta não continha JSON' : schemaMismatch(output, schema)
      if (!problem) return { ...done, output }

      
      
      
      if (repaired || step === maxSteps - 1) {
        return { ...done, success: false, error: `resposta não bate com output_schema (${problem})` }
      }
      repaired = true
      messages.push(buildAssistantMessage(response))
      messages.push({ role: 'user', content: `Sua resposta não pôde ser usada: ${problem}. Responda de novo com SOMENTE o JSON válido, sem prosa nem cercas de código.` })
      continue
    }

    messages.push(buildAssistantMessage(response))

    for (const call of calls) {
      const name = call.function?.name ?? call.name
      let args = call.function?.arguments ?? call.input ?? {}
      if (typeof args === 'string') { try { args = JSON.parse(args) } catch { args = {} } }

      let result
      let isError = false
      if (!wanted.includes(name)) {
        
        
        result = { error: `tool "${name}" não está liberada para este agente` }
        isError = true
      } else {
        try {
          result = await executeSelectedTool(name, args, step)
        }
        catch (e) { result = { error: e.message }; isError = true }
      }

      let content
      try { content = JSON.stringify(result) } catch { content = '{"error":"resultado não serializável"}' }
      if (content.length > AGENT_MAX_TOOL_RESULT) {
        content = `${content.slice(0, AGENT_MAX_TOOL_RESULT)}… [truncado: ${content.length} chars]`
      }
      const binding = bindingsByName.get(name)
      if (isError) trace.push({ step, tool: name, bindingId: binding?.id || undefined, error: true })
      messages.push(buildToolResultMessage(call.id, content, isError))
    }
  }

  return { success: false, error: `max_steps (${maxSteps}) atingido sem resposta final`, steps: maxSteps, tools: wanted, trace }
}

export async function listModels(payload) {
  /**
   * @register_tool list_models
   * @description Lista todos os modelos disponíveis no OpenRouter e suas respectivas propriedades (limites, contexto, preço). Útil para descobrir IDs de modelos e capacidades.
   * @param {string?} category - Filtrar modelos por categoria (ex: "programming", "roleplay", "finance", "legal", "health")
   * @param {string?} output_modalities - Filtrar por modalidade de saída (ex: "text", "image", "audio", "embeddings", "all"). Padrão: "text"
   * @param {string?} supported_parameters - Parâmetros separados por vírgula que o modelo precisa aceitar (ex: "tools", "structured_outputs")
   */
  const {
    category = null,
    output_modalities = 'text',
    supported_parameters = null,
  } = payload ?? {}

  const config = getConfig()
  const slots = buildSlots(config)

  if (!slots.length) {
    throw new Error(
      'Nenhum pool LLM ativo. Configure llm.pools em agent.config.json.'
    )
  }

  
  const slot = getNextSlot(slots)

  
  
  const baseUrl = slot.url.split('/chat/completions')[0]
  const targetUrl = new URL(`${baseUrl}/models`)

  
  targetUrl.searchParams.append('output_modalities', output_modalities)
  if (category) targetUrl.searchParams.append('category', category)
  if (supported_parameters) targetUrl.searchParams.append('supported_parameters', supported_parameters)

  try {
    const res = await fetch(targetUrl.toString(), {
      method: 'GET',
      headers: slot.headers, 
    })

    if (!res.ok) {
      throw new Error(`[${slot.poolName}] Erro ao buscar modelos HTTP ${res.status}: ${await res.text()}`)
    }

    const data = await res.json()

    
    
    
    const elmEntries = listElms(config).map(e => ({
      id: e.id,
      name: `ELM · ${e.id}`,
      description: e.description,
      elm: true,
      elm_tier: e.tier,
      elm_members: e.members,
      ...(e.modalities ? { output_modalities: e.modalities } : {}),
    }))
    const providerModels = data.data ?? []

    
    return {
      success: true,
      count: elmEntries.length + providerModels.length,
      models: [...elmEntries, ...providerModels]
    }

  } catch (error) {
    return {
      success: false,
      error: error.message
    }
  }
}




export const __testables = { extractJsonBlock, schemaMismatch, schemaInstruction, textFromCliNdjson }
