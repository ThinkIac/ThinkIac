const ROUTE_BASE = '/codex'
export const capabilities = Object.freeze(['sessions', 'streaming', 'workspace'])
const endpoint = path => `${ROUTE_BASE}${String(path || '').startsWith('/') ? path : `/${path}`}`
export const request = (path, options = {}) => fetch(endpoint(path), options)
export const resourceUrl = path => endpoint(path)
let socket; let ready = false; let subscriptions = []; let reconnectTimer; const handlers = new Set(); const reopenHandlers = new Set(); const commandHandlers = new Set()
const isSocketOpen = (candidate) => typeof WebSocket !== 'undefined' && candidate?.readyState === WebSocket.OPEN
const sendSubscriptions = () => { if (isSocketOpen(socket)) socket.send(JSON.stringify({ type: 'codex:subscribe', sessions: subscriptions })) }
export function connect() { if (typeof window === 'undefined' || socket) return; const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'; socket = new WebSocket(`${protocol}//${window.location.host}/ws?session=codex-ui-${crypto.randomUUID?.() ?? Date.now()}`); socket.addEventListener('open', () => { ready = true; sendSubscriptions(); for (const handler of reopenHandlers) handler() }); socket.addEventListener('message', event => { let message; try { message = JSON.parse(event.data) } catch { return } if (message.type === 'codex:pong') return; if (['chat:event', 'codex:sessions-updated', 'bus:event'].includes(message.type)) { const normalized = message.type === 'codex:sessions-updated' ? { ...message, type: 'sessions:updated' } : message; for (const handler of handlers) handler(normalized) } }); socket.addEventListener('close', () => { ready = false; socket = null; reconnectTimer = setTimeout(connect, 1500) }); socket.addEventListener('error', () => { try { socket?.close() } catch {} }) }
export function subscribe(sessionIds) { subscriptions = [...new Set((sessionIds ?? []).filter(Boolean))]; sendSubscriptions() }
export function send(value) { if (!isSocketOpen(socket)) return false; try { socket.send(JSON.stringify(value)); return true } catch { return false } }
export function on(handler) { handlers.add(handler); return () => handlers.delete(handler) }
export function onReopen(handler) { reopenHandlers.add(handler); return () => reopenHandlers.delete(handler) }
export function onCommand(handler) { commandHandlers.add(handler); return () => commandHandlers.delete(handler) }
export const setUiState = () => false; export const sendSnapshot = () => false; export const isReady = () => ready
