import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { SessionStore } from './lib/session-store.js'
import { CodexRuntime } from './lib/runtime.js'
import { initChatBus, publish, sessionsUpdated } from './lib/chat-bus.js'
import { getCodexModelCatalog } from './lib/model-catalog.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const store = new SessionStore(join(dirname(fileURLToPath(import.meta.url)), 'data', 'sessions'))
const profilesDir = join(root, 'terminal', 'profiles')
export const runtime = new CodexRuntime({ store, root, profilesDir, emit: (sessionId, item) => publish(sessionId, { type: 'chat:event', session_id: sessionId, seq: item.id, epoch: item.epoch, event: item.event, data: item.data }), sessionsUpdated })
initChatBus()

export async function chatSend(req, res) {
  /** @internal_router chat/send
   * @method POST */
  const { session_id = 'default', message } = req.body ?? {}; if (!message) { res?.status?.(400); return { error: 'message é obrigatória' } } return runtime.send({ sessionId: session_id, message })
}
export function chatCancel(req) {
  /** @internal_router chat/cancel
   * @method POST */
  const session_id = req.body?.session_id ?? 'default'; return { cancelled: runtime.cancel(session_id), session_id }
}
export function chatReconnect(req) {
  /** @internal_router chat/stream/reconnect
   * @method POST */
  const session_id = req.body?.session_id ?? 'default'; const last = Number(req.body?.last_event_id ?? 0); return { ...runtime.status(session_id), events: runtime.cursor(session_id).filter(event => event.id > last), epoch: runtime.cursor(session_id).at(-1)?.epoch ?? null }
}
export function sessionHistory(req) {
  /** @internal_router sessions/:sessionId/history
   * @method GET */
  return runtime.history(req.params?.sessionId)
}
export function sessionStatus(req) {
  /** @internal_router sessions/:sessionId/status
   * @method GET */
  return runtime.status(req.params?.sessionId)
}
export function sessionClear(req) {
  /** @internal_router sessions/:sessionId/clear
   * @method GET */
  store.erase(req.params?.sessionId); return { success: true }
}
export function sessionsList() {
  /** @internal_router sessions/list
   * @method GET */
  return store.list()
}
export function workspaceGet(req) {
  /** @internal_router session/workspace
   * @method GET */
  return { workspace: runtime.workspace(req.query?.session_id ?? 'default') }
}
export function workspaceSet(req, res) {
  /** @internal_router session/workspace
   * @method POST */
  try { return { workspace: runtime.setWorkspace(req.body?.session_id ?? 'default', req.body?.path).workspace } } catch (error) { res?.status?.(400); return { error: error.message } }
}
export function workspaceBrowse(req, res) {
  /** @internal_router workspaces/browse
   * @method GET */
  try { return runtime.browse(req.query?.path) } catch (error) { res?.status?.(400); return { error: error.message } }
}
export function sessionModelGet(req) {
  /** @internal_router session/model
   * @method GET */
  const model = store.load(req.query?.session_id ?? 'default').model || 'auto'
  const catalog = getCodexModelCatalog()
  // Não esconda uma seleção persistida se o cache foi apagado entre dois boots;
  // ela ainda é válida para o Codex CLI e o usuário precisa conseguir trocá-la.
  if (model !== 'auto' && !catalog.accesses.some(access => access.id === model)) {
    catalog.accesses.push({
      id: model, model, name: model, provider: 'codex-cli',
      enabled: true, authenticated: true, available: true,
      metadata: { poolName: 'codex-cli', poolLabel: 'Codex CLI' },
      purpose: { name: 'Codex CLI', description: '' },
    })
  }
  return { model, catalog }
}
export function sessionModelSet(req) {
  /** @internal_router session/model
   * @method POST */
  return { model: runtime.setModel(req.body?.session_id ?? 'default', req.body?.model).model }
}
export function providerGet() {
  /** @internal_router provider
   * @method GET */
  return { provider: 'codex-cli', model: null }
}
export function thinkingTitles() {
  /** @internal_router chat/thinking-titles
   * @method GET */
  return { titles: ['Preparando workspace', 'Codex está trabalhando', 'Validando resultado'] }
}
export function titleConfig() {
  /** @internal_router sessions/title-config
   * @method GET */
  return { enabled: false, every: 0, model: null }
}
export function sessionFeedback() {
  /** @internal_router sessions/:sessionId/feedback
   * @method POST */
  return { success: true }
}
