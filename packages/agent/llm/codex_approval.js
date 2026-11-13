import { registerPendingPermission, resolvePendingPermission } from '../core/pending_permissions.js'



export async function requestCodexApproval(request, { sessionId, signal, timeoutMs, emit } = {}) {
  if (!sessionId || signal?.aborted) return { decision: 'decline' }
  const { requestId, promise } = registerPendingPermission({
    sessionId, toolName: `codex:${request.method}`, toolInput: request.params,
    toolUseId: request.params?.itemId ?? String(request.id),
  }, { timeoutMs })
  const cancel = () => resolvePendingPermission(requestId, 'deny', 'Turno encerrado.')
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    const publish = emit ?? (await import('../routes/chat.js')).emit
    await publish(sessionId, 'permission_request', {
      request_id: requestId, tool_name: `codex:${request.method}`,
      tool_input: request.params, tool_use_id: request.params?.itemId ?? String(request.id),
    })
    if (signal?.aborted) cancel()
    const result = await promise
    return { decision: result.decision === 'allow' ? 'accept' : 'decline' }
  } catch {
    return { decision: 'decline' }
  } finally {
    cancel()
    signal?.removeEventListener('abort', cancel)
  }
}
