import { onMessage, broadcast } from 'logos'

const subscriptions = new Map()
let initialized = false

export function initChatBus() {
  if (initialized) return
  initialized = true
  onMessage('codex:subscribe', (message, socket) => {
    const wanted = new Set(Array.isArray(message.sessions) ? message.sessions : [])
    const current = socket._codexSubscriptions ?? new Set()
    for (const id of current) if (!wanted.has(id)) subscriptions.get(id)?.delete(socket)
    for (const id of wanted) { if (!subscriptions.has(id)) subscriptions.set(id, new Set()); subscriptions.get(id).add(socket) }
    if (!socket._codexSubscriptions) socket.on('close', () => { for (const id of socket._codexSubscriptions ?? []) subscriptions.get(id)?.delete(socket) })
    socket._codexSubscriptions = wanted
  })
  onMessage('codex:ping', (message, socket) => { try { socket.send(JSON.stringify({ type: 'codex:pong', t: message?.t })) } catch {} })
}

export function publish(sessionId, payload) { for (const socket of subscriptions.get(sessionId) ?? []) { if (socket.readyState === 1) try { socket.send(JSON.stringify(payload)) } catch {} } }
export function sessionsUpdated(reason, sessionId) { try { broadcast({ type: 'codex:sessions-updated', reason, session_id: sessionId }) } catch {} }
