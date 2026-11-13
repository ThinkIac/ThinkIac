import { SessionWriter } from './session-writer.js'
import { readFileSync, existsSync, mkdirSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { eventCall as $ } from '../host/agent_host.js'
import {
  remember as memoryRemember,
  recall as memoryRecall,
  forget as memoryForget,
  getFactsText,
  getScheduledTasks as memoryGetScheduledTasks,
  consolidate as memoryConsolidate,
} from '../../memory/lib/graph.js'
import {
  applyAssistantFeedback,
  buildFeedbackMemory,
  persistFeedbackMemory,
} from '../core/message_feedback.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const MEM_DIR = join(PKG_DIR, '..', 'sessions')

const sessionWriter = new SessionWriter(MEM_DIR)

const MAX_COMPRESS = 15
const MAX_SUMMARY_CHARS = 2000
const MAX_RECOMPRESS_ATTEMPTS = 3

const sessions = new Map()

const ensureDir = () => { if (!existsSync(MEM_DIR)) mkdirSync(MEM_DIR, { recursive: true }) }
const fp = (id) => join(MEM_DIR, `${id}.json`)

export function getSession(id = 'default') {
  if (sessions.has(id)) return sessions.get(id)

  ensureDir()

  if (existsSync(fp(id))) {
    try {
      const raw = JSON.parse(readFileSync(fp(id), 'utf8'))

      
      
      
      
      const isToolProtocolMessage = m => m?.role === 'tool' && typeof m.tool_call_id === 'string'
        || m?.role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length > 0
      const cleanMessages = Array.isArray(raw.messages)
        ? raw.messages
            .filter(m => m && typeof m === 'object' && typeof m.content === 'string'
              && (m.content.trim().length > 0 || isToolProtocolMessage(m)))
            .map(m => ({
              ...m,
              role: typeof m.role === 'string' ? m.role : 'assistant'
            }))
        : []

      const s = {
        ...raw,
        id,
        messages: cleanMessages
      }

      sessions.set(id, s)
      return s
    } catch {
      
    }
  }

  const s = {
    id,
    messages: [],
    summary: null,
    created_at: new Date().toISOString()
  }

  sessions.set(id, s)
  return s
}

export function pushMessage(sid, msg) {
  const s = getSession(sid)
  if (!msg?.role) msg.role = 'assistant'
  if (!msg.createdAt) msg.createdAt = new Date().toISOString()
  s.messages.push(msg)
  save(s)
}
export async function pushMessageAsync(sid, msg) {
  const s = getSession(sid)
  if (!msg?.role) msg.role = 'assistant'
  if (!msg.createdAt) msg.createdAt = new Date().toISOString()
  s.messages.push(msg)
  await sessionWriter.write(s)
}
export function getMessages(sid) { return getSession(sid).messages }

export async function replaceMessagesAsync(sid, messages) {
  const session = getSession(sid)
  session.messages = messages
  await sessionWriter.write(session)
}

export function getSessionWorkspace(sid) {
  return getSession(sid).workspace ?? null
}

export function setSessionWorkspace(sid, workspace) {
  const session = getSession(sid)
  session.workspace = workspace ?? null
  save(session)
  return session.workspace
}

export function getSummaryContext(sid) {
  const s = getSession(sid), facts = getFactsText().split('\n').filter(line => !/METACOGNITION\s*\|/.test(line)).join('\n')
  return (facts ? `[Long-term memory]\n${facts}\n\n` : '')
    + (s.summary ? `[Previous summary]\n${s.summary}\n\n---\n\n` : '')
}

export async function compressIfNeeded(sid, callLLM, abortSignal = null) {
  const state = { sid }
  const session = getSession(sid)

  if (session.messages.length < MAX_COMPRESS || abortSignal?.aborted) return

  state.messagesCount = session.messages.length
  $('agent:compress:started', state)

  let keep = session.messages.slice(-15)
  const firstUser = keep.findIndex(m => m.role === 'user')
  if (firstUser > 0) keep = keep.slice(firstUser)

  const old = session.messages.slice(0, session.messages.length - keep.length)
  if (!old.length) return

  try {
    $('agent:compress:summarizing', {
      ...state,
      messagesToCompressCount: old.length,
      messagesKeepingCount: keep.length
    })

    const res = await callLLM({
      system: 'Summarize concisely. Preserve: tools created, decisions, scheduled tasks, facts.',
      messages: [{ role: 'user', content: JSON.stringify(old) }],
      tools: [],
      abortSignal,
    })

    state.newSummary = res.choices?.[0]?.message?.content ?? ''
    session.summary = session.summary ? `${session.summary}\n\n---\n\n${state.newSummary}` : state.newSummary
    session.messages = keep
    await sessionWriter.write(session)
  } finally {
    $('agent:compress:finally', { ...state, totalSummaryLength: session.summary.length })
  }
}

export async function compressFacts(callLLM, abortSignal = null) {
  if (abortSignal?.aborted) return
  return memoryConsolidate({ callLLM })
}

export function setSessionTitle(sid, title, messageCount = null) {
  const s = getSession(sid)
  s.title = title || null
  s.title_message_count = messageCount ?? s.messages.length
  s.title_generated_at = new Date().toISOString()
  save(s)
  return s.title
}

export function getSessionTitle(sid) {
  return getSession(sid).title ?? null
}

export async function setAssistantFeedback(sid, assistantOrdinal, feedback) {
  const session = getSession(sid)
  const saved = applyAssistantFeedback(session.messages, assistantOrdinal, feedback)
  save(session)
  const memory = buildFeedbackMemory(sid, session.messages, assistantOrdinal, saved)
  try {
    await persistFeedbackMemory({ ...memory, sessionId: sid })
  } catch (err) {
    await $('memory:error', { source: 'message_feedback', sessionId: sid, error: err.message })
  }
  const assistant = session.messages.filter(item => item?.role === 'assistant' && String(item.content ?? '').trim())[Number(assistantOrdinal)]
  const assistantIndex = assistant ? session.messages.indexOf(assistant) : -1
  const user = assistantIndex > 0 ? session.messages.slice(0, assistantIndex).reverse()
    .find(item => item?.role === 'user' && String(item.content ?? '').trim()) : null
  await $('agent:message-feedback', {
    sessionId: sid,
    request: user?.content || null,
    response: assistant?.content || null,
    value: saved.value,
    reason: saved.reason,
  })
  return saved
}

export function clearSession(id) {
  sessions.delete(id)
  sessionWriter.deleteSync(id)
}

function save(s) { sessionWriter.writeSync(s) }

export async function appendFact(text) {
  return memoryRemember({ content: text })
}

export async function removeFact(query) {
  const { removed } = await memoryForget(query)
  return removed
}

export function getScheduledTasks() {
  return memoryGetScheduledTasks()
}

export async function storeEmbedding(text) {
  return memoryRemember({ content: text })
}

export async function searchEmbeddings(query, limit = 5) {
  const results = await memoryRecall(query, { limit })
  return results.map(r => ({ text: r.content, score: r.score, created_at: r.createdAt }))
}
