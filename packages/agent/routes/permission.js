
















import {
  registerPendingPermission,
  resolveSessionPermission,
} from '../core/pending_permissions.js'
import { emit } from './chat.js'

export async function permissionAsk(req, res) {
  /**
   * @register_router permission/ask
   * @method POST
   */
  const { session_id, tool_name, tool_input, tool_use_id, timeout_ms } = req.body ?? {}

  if (!session_id || !tool_name) {
    res.status(400).json({ error: '`session_id` e `tool_name` são obrigatórios' })
    return
  }

  const { requestId, promise } = registerPendingPermission(
    { sessionId: session_id, toolName: tool_name, toolInput: tool_input ?? {}, toolUseId: tool_use_id ?? null },
    { timeoutMs: timeout_ms ?? undefined },
  )

  
  emit(session_id, 'permission_request', {
    request_id: requestId,
    tool_name,
    tool_input: tool_input ?? {},
    tool_use_id: tool_use_id ?? null,
  })

  
  const { decision, reason } = await promise
  res.json({ decision, reason: reason ?? null })
}

export async function permissionResolve(req, res) {
  /**
   * @register_router permission/resolve
   * @method POST
   */
  const { request_id, session_id, decision, reason } = req.body ?? {}

  if (!request_id || !session_id || (decision !== 'allow' && decision !== 'deny')) {
    res.status(400).json({ error: '`request_id` e `decision` ("allow"|"deny") são obrigatórios' })
    return
  }

  const ok = resolveSessionPermission(session_id, request_id, decision, reason ?? null)
  if (!ok) {
    res.status(409).json({ ok: false, error: 'Pedido indisponível nesta sessão.' })
    return
  }

  
  if (session_id) {
    emit(session_id, 'permission_resolved', { request_id, decision, reason: reason ?? null })
  }

  res.json({ ok, request_id, decision })
}
