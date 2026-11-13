const ROUTE_BASE = '/scriba-agent'

export const capabilities = Object.freeze(['sessions', 'streaming', 'tools', 'approvals'])

const endpoint = path => `${ROUTE_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`
export const request = (path, options = {}) => fetch(endpoint(path), options)
export const resourceUrl = path => endpoint(path)

let socket = null
let ready = false
let subscriptions = []
let reconnectTimer = null
const handlers = new Set()
const reopenHandlers = new Set()
const commandHandlers = new Set()

const isSocketOpen = (candidate) => typeof WebSocket !== 'undefined' && candidate?.readyState === WebSocket.OPEN

const sendSubscriptions = () => {
  if (isSocketOpen(socket)) socket.send(JSON.stringify({ type: 'scriba:subscribe', sessions: subscriptions }))
}

export function connect() {
  if (typeof window === 'undefined' || socket) return
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  socket = new WebSocket(`${protocol}//${window.location.host}/ws?session=scriba-ui-${crypto.randomUUID?.() ?? Date.now()}`)
  socket.addEventListener('open', () => { ready = true; sendSubscriptions(); for (const handler of reopenHandlers) handler() })
  socket.addEventListener('message', event => {
    let message
    try { message = JSON.parse(event.data) } catch { return }
    if (message.type === 'scriba:pong') return
    if (['chat:event', 'scriba:sessions-updated', 'bus:event'].includes(message.type)) {
      const normalized = message.type === 'scriba:sessions-updated' ? { ...message, type: 'sessions:updated' } : message
      for (const handler of handlers) handler(normalized)
    }
  })
  socket.addEventListener('close', () => { ready = false; socket = null; reconnectTimer = setTimeout(connect, 1500) })
  socket.addEventListener('error', () => { try { socket?.close() } catch {} })
}

export function subscribe(sessionIds) { subscriptions = [...new Set((sessionIds ?? []).filter(Boolean))]; sendSubscriptions() }
export function send(value) { if (!isSocketOpen(socket)) return false; try { socket.send(JSON.stringify(value)); return true } catch { return false } }
export function on(handler) { handlers.add(handler); return () => handlers.delete(handler) }
export function onReopen(handler) { reopenHandlers.add(handler); return () => reopenHandlers.delete(handler) }
export function onCommand(handler) { commandHandlers.add(handler); return () => commandHandlers.delete(handler) }
export function setUiState() { return false }
export function sendSnapshot() { return false }
export function isReady() { return ready }
