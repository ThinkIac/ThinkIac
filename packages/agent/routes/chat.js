import { runAgent, activeSessions } from "../core/agent.js"
import { hasPendingQuestion, resolvePendingQuestion } from "../core/pending_questions.js"
import { eventCall } from '../host/agent_host.js'
import * as chatBus from '../core/chat_bus.js'
import * as queue from '../core/message_queue.js'
import { resetTurnUsage, getTurnUsage } from '../core/turn_usage.js'
import { thinkingTitlesFor, STATIC_TITLES } from '../core/thinking_titles.js'
import { normalizeMessageMetadata } from '../core/message_metadata.js'
import { createChatEventState } from '../core/chat_event_state.js'
import { getSessionWorkspace } from '../memory/session.js'
import { createWorkspaceResolver, resolveWorkspaceSelection, workspaceRootsFromModule } from '../core/workspace.js'
import { createGovernanceResumeCoordinator } from '../core/governance_resume.js'
import { hasApprovedAction, approvedContinuation } from '../../governance/service.js'

chatBus.init()
const workspaceResolver = createWorkspaceResolver(workspaceRootsFromModule(import.meta.url))


const activeStreamControllers = new Map()






const eventState = createChatEventState()
const cleanupTimers = new Map()    

const CLEANUP_DELAY_MS = 60_000   

const waitForSession = () => new Promise(resolve => setTimeout(resolve, 50))




const governanceResume = createGovernanceResumeCoordinator({
  isActive: sessionId => activeSessions.has(sessionId),
  delay: waitForSession,
  resume: resumeApprovedGovernanceAction,
})







const TURN_IDLE_MS = 180_000  




function makeIdleWatchdog(abortController, ms = TURN_IDLE_MS) {
  const state = { timedOut: false }
  let timer = null
  const bump = () => {
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => {
      if (!abortController.signal.aborted) {
        state.timedOut = true
        abortController.abort()
      }
    }, ms)
  }
  const stop = () => { if (timer) { clearTimeout(timer); timer = null } }
  return { state, bump, stop }
}

function pushEvent(sessionId, event, data) {
  return eventState.push(sessionId, event, data)
}



export function emit(sessionId, event, data) {
  const item = pushEvent(sessionId, event, data)
  if (!item) return null
  chatBus.publish(sessionId, {
    type: 'chat:event', session_id: sessionId, epoch: item.epoch,
    seq: item.id, event, data,
  })
  return item
}

export function beginEventCycle(sessionId) {
  return eventState.begin(sessionId)
}

function emitDone(sessionId, response) {
  const data = { response, session_id: sessionId, usage: getTurnUsage(sessionId), timestamp: new Date().toISOString() }
  const terminal = emit(sessionId, 'done', data)
  if (terminal) {
    eventCall('agent:response-published', {
      response, sessionId, epoch: terminal.epoch, seq: terminal.id,
    }).catch(() => {})
  }
  return terminal
}

async function resumeApprovedGovernanceAction(session_id) {
  
  
  if (!hasApprovedAction({ sessionId: session_id })) return
  const continuation = approvedContinuation({ sessionId: session_id })
  const presenceController = continuation?.origin === 'presence' ? new AbortController() : null
  let presenceTimeout
  let presenceGuardSignal
  const abortPresenceContinuation = () => presenceController?.abort()
  if (continuation?.origin === 'presence') {
    const guard = await eventCall('presence:control', { schemaVersion: 1, action: 'guard' })
    if (!guard?.success || !guard.result.allowed || guard.result.signal?.aborted) return
    const current = guard.result.config
    if (continuation.presenceKind && !current.classes.includes(continuation.presenceKind)) return
    if (continuation.presenceKind === 'act' && current.mode !== 'autonomous') return
    if (continuation.toolAllowlist.some(tool => !current.toolAllowlist.includes(tool)) || current.maxActions < 1) return
    presenceGuardSignal = guard.result.signal
    presenceGuardSignal?.addEventListener('abort', abortPresenceContinuation, { once: true })
  }
  const epoch = beginEventCycle(session_id)
  if (cleanupTimers.has(session_id)) {
    clearTimeout(cleanupTimers.get(session_id))
    cleanupTimers.delete(session_id)
  }

  if (presenceController) {
    activeStreamControllers.set(session_id, presenceController)
    presenceTimeout = setTimeout(() => presenceController.abort(), 120000)
    presenceTimeout.unref?.()
  }
  resetTurnUsage(session_id)
  emit(session_id, 'start', { session_id, internal: 'governance-resume' })
  chatBus.notifySessionsUpdated('governance_resume_start', session_id)
  try {
    const response = await runAgent('', session_id, (progress) => {
      if (progress.type === 'token') emit(session_id, 'token', { text: progress.text, session_id })
      else if (progress.type === 'reasoning') emit(session_id, 'reasoning', { text: progress.text, session_id })
      else if (progress.type === 'commit') emit(session_id, 'commit', {})
      else emit(session_id, 'step', { label: progress.label ?? 'Resuming approved action…', reasoning: progress.reasoning ?? null })
    }, presenceController?.signal || null, { resume: true, ...continuation })
    emitDone(session_id, response)
  } catch (error) {
    emit(session_id, 'error', { error: 'Could not resume the approved action. The decision remains recorded; try again from the session.' })
    console.error('[Agent] Governance resume failed:', error.message)
  } finally {
    clearTimeout(presenceTimeout)
    presenceGuardSignal?.removeEventListener('abort', abortPresenceContinuation)
    if (presenceController && activeStreamControllers.get(session_id) === presenceController) activeStreamControllers.delete(session_id)
    chatBus.notifySessionsUpdated('governance_resume_end', session_id)
    const timer = setTimeout(() => {
      eventState.remove(session_id, epoch)
      cleanupTimers.delete(session_id)
    }, CLEANUP_DELAY_MS)
    cleanupTimers.set(session_id, timer)
  }
}

export function cancelPresenceContinuation() {
  activeStreamControllers.get('presence:personal')?.abort()
}

export function scheduleGovernanceResume(sessionId) {
  return governanceResume.schedule(sessionId)
}




function summarizeToolInput(input) {
  if (!input || typeof input !== 'object') return ''
  const pick = input.file_path || input.path || input.command || input.pattern
    || input.query || input.url || input.prompt || input.description
  if (pick) return String(pick).replace(/\s+/g, ' ').trim().slice(0, 60)
  try { return JSON.stringify(input).slice(0, 60) } catch { return '' }
}





async function startTurn(session_id, message, metadata = {}, { retry = false } = {}) {
  
  
  const workspace = await resolveWorkspaceSelection(workspaceResolver, getSessionWorkspace(session_id))
  const messageMetadata = {
    ...normalizeMessageMetadata(metadata),
    ...(workspace ? { workspace } : {}),
  }
  
  const epoch = beginEventCycle(session_id)
  if (cleanupTimers.has(session_id)) {
    clearTimeout(cleanupTimers.get(session_id))
    cleanupTimers.delete(session_id)
  }

  
  resetTurnUsage(session_id)

  
  eventCall('agent:message', { message, sessionId: session_id }).catch(() => { })

  emit(session_id, 'start', { session_id, message })
  emit(session_id, 'user_message', { text: message, metadata: messageMetadata })
  chatBus.notifySessionsUpdated('turn_start', session_id)

  const abortController = new AbortController()
  activeStreamControllers.set(session_id, abortController)
  const watchdog = makeIdleWatchdog(abortController)

  ;(async () => {
    try {
      watchdog.bump()
      const response = await runAgent(message, session_id, (progress) => {
        watchdog.bump()
        if (progress.type === 'token') {
          emit(session_id, 'token', { text: progress.text, session_id })
        } else if (progress.type === 'reasoning') {
          emit(session_id, 'reasoning', { text: progress.text, session_id })
        } else if (progress.type === 'tool-step') {
          
          
          
          const summary = summarizeToolInput(progress.input)
          emit(session_id, 'step', {
            label: `${progress.name}${summary ? ` · ${summary}` : ''}`,
            reasoning: null,
            args: progress.input ?? null,
            toolCallId: progress.toolCallId ?? progress.itemId ?? null,
            startedAt: progress.startedAt ?? new Date().toISOString(),
          })
        } else if (progress.type === 'tool-result') {
          
          
          emit(session_id, 'step', {
            result: progress.content ?? '',
            toolCallId: progress.toolCallId ?? progress.itemId ?? null,
            completedAt: progress.completedAt ?? new Date().toISOString(),
          })
        } else if (progress.type === 'model') {
          
          emit(session_id, 'model', {
            model: progress.model,
            provider: progress.provider ?? null,
            session_id
          })
        } else if (progress.type === 'usage') {
          
          
          emit(session_id, 'usage', { usage: progress.usage, session_id })

        } else if (progress.type === 'commit') {
          emit(session_id, 'commit', {})
        } else if (progress.type === 'user_message') {
          emit(session_id, 'user_message', { text: progress.text })
        } else {
          emit(session_id, 'step', {
            label: progress.label ?? '',
            reasoning: progress.reasoning ?? null,
            iteration: progress.iteration ?? null,
            max: progress.max ?? null,
          })
        }
      }, abortController.signal, {
        messageMetadata,
        persistUserMessageEarly: true,
        reuseLastUserMessage: retry,
        cwd: workspace?.path,
        onInputTrace: ({ text, inputTrace }) => emit(session_id, 'input_trace', { text, inputTrace }),
      })

      emitDone(session_id, response)
    } catch (e) {
      if (watchdog.state.timedOut) {
        emit(session_id, 'timeout', { session_id, retryable: true })
      } else if (e.name === 'AbortError' || abortController.signal.aborted) {
        emitDone(session_id, '*Geração interrompida.*')
      } else {
        console.log(e)
        emit(session_id, 'error', { error: e.message })
      }
    } finally {
      watchdog.stop()
      activeStreamControllers.delete(session_id)
      chatBus.notifySessionsUpdated('turn_end', session_id)

      
      if (queue.size(session_id) > 0 && !hasPendingQuestion(session_id)) {
        const msgs = queue.drain(session_id)
        const next = msgs[0]
        await startTurn(
          session_id,
          msgs.map(item => typeof item === 'string' ? item : item.message).join('\n\n'),
          typeof next === 'string' ? {} : next.metadata,
        )
      } else {
        
        const timer = setTimeout(() => {
          eventState.remove(session_id, epoch)
          cleanupTimers.delete(session_id)
        }, CLEANUP_DELAY_MS)
        cleanupTimers.set(session_id, timer)
      }
    }
  })()
}

export async function submitChatMessage({ message, session_id = 'default', metadata = {}, retry = false } = {}) {
  if (!message) {
    return { error: '`message` is required', status: 400 }
  }

  
  
  if (hasPendingQuestion(session_id)) {
    resolvePendingQuestion(session_id, message)
    return { accepted: true, forwarded: true, session_id }
  }

  
  
  if (activeSessions.has(session_id)) {
    const position = queue.enqueue(session_id, { message, metadata: normalizeMessageMetadata(metadata) })
    emit(session_id, 'queued', { text: message, position })
    return { queued: true, position, session_id }
  }

  await startTurn(session_id, message, metadata, { retry: retry === true })
  return { accepted: true, session_id }
}

export async function chatSend(req, res) {
  /**
   * @register_router chat/send
   * @method POST
   */
  const result = await submitChatMessage(req.body ?? {})
  if (result?.status === 400) {
    res.status(400).json({ error: result.error })
    return
  }
  return result
}

export async function chatStream(req, res) {
  /**
   * @register_router chat/stream
   * @method POST
   * @streaming
   */
  const { message, session_id = 'default', retry = false } = req.body ?? {}

  if (!message) {
    res.status(400).json({ error: '`message` is required' })
    return
  }

  
  
  
  if (hasPendingQuestion(session_id)) {
    resolvePendingQuestion(session_id, message)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    res.write(`event: start\n`)
    res.write(`data: ${JSON.stringify({ session_id, message })}\n\n`)
    res.write(`event: done\n`)
    res.write(`data: ${JSON.stringify({ response: '(resposta encaminhada para a tarefa em andamento)', session_id })}\n\n`)
    res.end()
    return
  }

  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()

  const send = (event, data) => {
    
    const item = pushEvent(session_id, event, data)
    if (!item) return null
    try {
      res.write(`event: ${event}\n`)
      res.write(`data: ${JSON.stringify(data)}\n\n`)
      if (typeof res.flush === 'function') res.flush()
    } catch {
      
    }
    return item
  }

  
  if (activeSessions.has(session_id)) {
    
    
    res.write('event: error\n')
    res.write(`data: ${JSON.stringify({ error: `Sessão "${session_id}" já está processando.` })}\n\n`)
    res.end()
    return
  }

  const epoch = beginEventCycle(session_id)

  
  eventCall('agent:message', { message, sessionId: session_id }).catch(() => { })

  send('start', { session_id, message })

  
  
  
  
  
  const heartbeat = setInterval(() => {
    try {
      res.write(': ping\n\n')
      if (typeof res.flush === 'function') res.flush()
    } catch { /* cliente desconectou — geração segue até o fim mesmo assim */ }
  }, 15_000)

  
  
  const abortController = new AbortController()
  activeStreamControllers.set(session_id, abortController)
  const watchdog = makeIdleWatchdog(abortController)

  try {
    watchdog.bump()
    const response = await runAgent(message, session_id, (progress) => {
      watchdog.bump()
      if (progress.type === 'token') {
        send('token', { text: progress.text, session_id })
      } else if (progress.type === 'reasoning') {
        send('reasoning', { text: progress.text, session_id })
      } else if (progress.type === 'usage') {
        send('usage', { usage: progress.usage, session_id })
      } else if (progress.type === 'model') {
        send('model', {
          model: progress.model,
          provider: progress.provider ?? null,
          session_id
        })
      } else if (progress.type === 'tool-step') {
        const summary = summarizeToolInput(progress.input)
        send('step', {
          label: `${progress.name}${summary ? ` · ${summary}` : ''}`,
          reasoning: null,
          args: progress.input ?? null,
          toolCallId: progress.toolCallId ?? progress.itemId ?? null,
          startedAt: progress.startedAt ?? new Date().toISOString(),
        })
      } else if (progress.type === 'tool-result') {
        send('step', {
          result: progress.content ?? '',
          toolCallId: progress.toolCallId ?? progress.itemId ?? null,
          completedAt: progress.completedAt ?? new Date().toISOString(),
        })
      } else {
        send('step', {
          label: progress.label ?? '',
          reasoning: progress.reasoning ?? null,
          iteration: progress.iteration ?? null,
          max: progress.max ?? null,
        })
      }
    }, abortController.signal, {
      persistUserMessageEarly: true,
      reuseLastUserMessage: retry === true,
    })

    const terminal = send('done', { response, session_id, usage: getTurnUsage(session_id) })
    if (terminal) eventCall('agent:response-published', {
      response, sessionId: session_id, epoch: terminal.epoch, seq: terminal.id,
    }).catch(() => {})
  } catch (e) {
    if (watchdog.state.timedOut) {
      send('timeout', { session_id, retryable: true })
    } else if (e.name === 'AbortError' || abortController.signal.aborted) {
      const response = '*Geração interrompida.*'
      const terminal = send('done', { response, session_id, usage: getTurnUsage(session_id) })
      if (terminal) eventCall('agent:response-published', {
        response, sessionId: session_id, epoch: terminal.epoch, seq: terminal.id,
      }).catch(() => {})
    } else {
      console.log(e)
      send('error', { error: e.message })
    }
  } finally {
    watchdog.stop()
    clearInterval(heartbeat)
    activeStreamControllers.delete(session_id)

    
    if (!cleanupTimers.has(session_id)) {
      const cleanupTimer = setTimeout(() => {
        eventState.remove(session_id, epoch)
        cleanupTimers.delete(session_id)
      }, CLEANUP_DELAY_MS)
      cleanupTimers.set(session_id, cleanupTimer)
    }

    res.end()
  }
}

export async function chatCancel(req, res) {
  /**
   * @register_router chat/cancel
   * @method POST
   */
  const { session_id = 'default' } = req.body ?? {}

  
  queue.clear(session_id)

  const ctrl = activeStreamControllers.get(session_id)
  if (ctrl) {
    ctrl.abort()
    activeStreamControllers.delete(session_id)
    return { success: true, message: `Sessão "${session_id}" cancelada.` }
  }

  return { success: false, message: `Nenhuma sessão ativa para "${session_id}".` }
}

export async function chatThinkingTitles(req, res) {
  /**
   * @register_router chat/thinking-titles
   * @method POST
   *
   * Frases curtas exibidas enquanto o agente pensa, geradas por modelo de
   * classificação a partir da mensagem. Nunca falha: sem `message`, ou com o
   * modelo fora do ar, devolve a lista estática — a UI só precisa de algo para
   * mostrar, e um erro aqui não pode manchar um turno que está funcionando.
   */
  const { message = '' } = req.body ?? {}
  if (!message) return { titles: [...STATIC_TITLES] }
  return { titles: await thinkingTitlesFor(message) }
}

export async function chatStreamReconnect(req, res) {
  /**
   * @register_router chat/stream/reconnect
   * @method POST
   */
  const { session_id = 'default', epoch = null, last_event_id = null } = req.body ?? {}

  const active = activeSessions.has(session_id)
  const replay = eventState.replay(session_id, { epoch, seq: last_event_id })
  const events = replay.events

  
  const cycle = eventState.current(session_id)
  const lastEvent = cycle?.events[cycle.events.length - 1] ?? null
  const done = lastEvent?.event === 'done'
  const result = done ? lastEvent.data.response : null
  const errorEvent = lastEvent?.event === 'error' ? lastEvent.data.error : null

  return {
    epoch: replay.epoch, events, active, done, result, error: errorEvent,
    cursor_mismatch: replay.cursorMismatch,
  }
}
