






import { eventCall } from '../host/agent_host.js'
import { submitChatMessage } from '../routes/chat.js'



const SHELL_HOME = '/view/shell/Index'
const MAX_PREVIEW = 240
const RESPONSE_TTL_MS = 24 * 60 * 60 * 1000
const pendingChatReplies = new Map()
const consumedReplies = new Map()

function runtimeOrigin() {
  const configured = process.env.THINKIAC_PUBLIC_URL || process.env.AGENT_PUBLIC_URL
  try { return new URL(configured || 'https://thinkiac.cloud').origin } catch { return 'https://thinkiac.cloud' }
}

function prune(now = Date.now()) {
  for (const [id, item] of pendingChatReplies) {
    if (now - item.createdAt > RESPONSE_TTL_MS) pendingChatReplies.delete(id)
  }
  for (const [id, at] of consumedReplies) {
    if (now - at > RESPONSE_TTL_MS) consumedReplies.delete(id)
  }
}

function preview(response) {
  return String(response || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PREVIEW)
}

export function mobileResponseNotification(payload = {}, emit = eventCall) {
  const sessionId = String(payload.sessionId || '').trim()
  const message = preview(payload.response)
  if (!sessionId || !message) return Promise.resolve(payload)

  const notificationId = `chat:${sessionId}:${payload.epoch ?? 'turn'}:${payload.seq ?? Date.now()}`.slice(0, 128)
  const click = new URL(`${SHELL_HOME}?open=chat&session=${encodeURIComponent(sessionId)}`, runtimeOrigin()).toString()
  prune()
  pendingChatReplies.set(notificationId, { sessionId, createdAt: Date.now() })
  return Promise.resolve(emit('device:notify', {
    id: notificationId,
    title: 'ThinkIac',
    message,
    click,
    sessionId,
    
    
    discreteId: `chat:${sessionId}`,
    interaction: 'prompt',
    context: { kind: 'chat-response', sessionId },
  })).catch(() => {}).then(() => payload)
}

export async function onDeviceResponse(payload = {}, emit = eventCall, submit = submitChatMessage) {
  /**
   * @register_hook device:response
   * @description Encaminha respostas digitadas em notificações de chat para a sessão que originou o cartão.
   */
  const id = String(payload.id || '')
  const action = String(payload.action || '')
  const value = String(payload.value || '').trim()
  prune()
  if (action !== 'submit' || !value || consumedReplies.has(id)) return payload
  const pending = pendingChatReplies.get(id)
  if (!pending) return payload

  
  
  pendingChatReplies.delete(id)
  consumedReplies.set(id, Date.now())
  await Promise.resolve(emit('device:notify', {
    appId: payload.appId,
    title: 'ThinkIac',
    message: 'Respondendo…',
    click: new URL(`${SHELL_HOME}?open=chat&session=${encodeURIComponent(pending.sessionId)}`, runtimeOrigin()).toString(),
    discreteId: `chat:${pending.sessionId}`,
  })).catch(() => {})
  await submit({
    message: value,
    session_id: pending.sessionId,
    metadata: { source: 'android-notification', appId: payload.appId },
  })
  return payload
}

export function onAgentResponsePublished(payload) {
  /**
   * @register_hook agent:response-published
   * @description Publica a resposta final do chat como notificação atualizável por sessão para aparelhos pareados.
   */
  return mobileResponseNotification(payload)
}
