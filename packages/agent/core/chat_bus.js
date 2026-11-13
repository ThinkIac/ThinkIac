









import { broadcastMessage, eventCall, onHostMessage } from '../host/agent_host.js'

const subs = new Map() 
const fronts = new Map() 

export class FrontRegistry {
  constructor() { this.items = new Map() }

  upsert(tabId, state, ws) {
    if (!tabId || typeof tabId !== 'string') return null
    const now = new Date().toISOString()
    const previous = this.items.get(tabId)
    const item = {
      id: tabId,
      connectedAt: previous?.connectedAt ?? now,
      lastSeenAt: now,
      capabilities: Array.isArray(state?.capabilities) ? state.capabilities : (previous?.capabilities ?? []),
      route: state?.route ?? previous?.route ?? null,
      viewport: state?.viewport ?? previous?.viewport ?? null,
      platform: state?.platform ?? previous?.platform ?? null,
      activeChatSessionId: state?.activeChatSessionId ?? previous?.activeChatSessionId ?? null,
      snapshot: state?.snapshot ?? previous?.snapshot ?? null,
      ws,
    }
    this.items.set(tabId, item)
    return item
  }

  remove(tabId, ws) {
    const item = this.items.get(tabId)
    if (item && (!ws || item.ws === ws)) this.items.delete(tabId)
  }

  list() {
    return [...this.items.values()]
      .map(({ ws, snapshot, ...item }) => ({ ...item, hasSnapshot: !!snapshot }))
      .sort((a, b) => b.lastSeenAt.localeCompare(a.lastSeenAt))
  }

  get(tabId) { return this.items.get(tabId) ?? null }
}

export const frontRegistry = new FrontRegistry()

let initialized = false

export function init() {
  if (initialized) return
  initialized = true

  
  
  
  
  onHostMessage('bus:emit', (msg) => {
    if (!msg?.event) return
    eventCall(msg.event, msg.detail).catch(() => {})
  })

  
  
  
  
  
  onHostMessage('ping', (msg, ws) => {
    try { ws.send(JSON.stringify({ type: 'pong', t: msg?.t })) } catch { /* socket morreu */ }
  })

  onHostMessage('ui:hello', (msg, ws) => {
    const item = frontRegistry.upsert(msg?.tabId, msg, ws)
    if (!item) return
    ws._agentFrontId = item.id
    if (!ws._agentFrontCloseBound) {
      ws._agentFrontCloseBound = true
      ws.on('close', () => frontRegistry.remove(ws._agentFrontId, ws))
    }
  })

  onHostMessage('ui:state', (msg, ws) => {
    if (ws._agentFrontId) frontRegistry.upsert(ws._agentFrontId, msg, ws)
  })

  onHostMessage('ui:snapshot', (msg, ws) => {
    if (ws._agentFrontId) frontRegistry.upsert(ws._agentFrontId, { snapshot: msg?.snapshot }, ws)
  })

  onHostMessage('chat:subscribe', (msg, ws) => {
    const wanted = new Set(Array.isArray(msg.sessions) ? msg.sessions : [])
    const current = ws._agentSubs ?? new Set()

    for (const sid of current) {
      if (!wanted.has(sid)) {
        subs.get(sid)?.delete(ws)
        if (subs.get(sid)?.size === 0) subs.delete(sid)
      }
    }
    for (const sid of wanted) {
      if (!subs.has(sid)) subs.set(sid, new Set())
      subs.get(sid).add(ws)
    }

    if (!ws._agentSubs) {
      ws.on('close', () => {
        for (const sid of ws._agentSubs ?? []) {
          subs.get(sid)?.delete(ws)
          if (subs.get(sid)?.size === 0) subs.delete(sid)
        }
      })
    }
    ws._agentSubs = wanted
  })
}

export function publish(chatSessionId, payload) {
  const set = subs.get(chatSessionId)
  if (!set || set.size === 0) return 0
  const msg = JSON.stringify(payload)
  let sent = 0
  for (const ws of set) {
    if (ws.readyState === 1) {
      try { ws.send(msg); sent++ } catch { /* socket morreu no meio */ }
    } else {
      set.delete(ws)
    }
  }
  if (set.size === 0) subs.delete(chatSessionId)
  return sent
}

export function notifySessionsUpdated(reason, sessionId) {
  try {
    broadcastMessage({ type: 'sessions:updated', reason, session_id: sessionId })
  } catch { /* hub pode não estar montado ainda (boot) */ }
}

export function listConnectedFronts() { return frontRegistry.list() }
export function getConnectedFront(tabId) { return frontRegistry.get(tabId) }
export function sendFrontCommand(tabId, command) {
  const front = frontRegistry.get(tabId)
  if (!front || front.ws?.readyState !== 1) return false
  try { front.ws.send(JSON.stringify({ type: 'ui:command', command })); return true } catch { return false }
}
