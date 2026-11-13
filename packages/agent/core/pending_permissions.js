














import { randomUUID } from 'node:crypto'

const pending = new Map() 

/**
 * Registra um pedido de permissão e devolve { requestId, promise }.
 * A promise resolve com { decision: 'allow'|'deny', reason?: string }.
 * No timeout, resolve (não rejeita) com decision:'deny' e um motivo — assim o
 * hook sempre recebe uma decisão bem-formada, nunca um erro solto.
 *
 * @param {{ sessionId, toolName, toolInput, toolUseId }} req
 * @param {{ timeoutMs?: number }} opts - default 30min; 0/null/Infinity = sem teto
 */
export function registerPendingPermission({ sessionId, toolName, toolInput, toolUseId }, { timeoutMs = 30 * 60_000 } = {}) {
  const requestId = randomUUID()

  const promise = new Promise((resolve) => {
    const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timeoutHandle = hasTimeout
      ? setTimeout(() => {
          pending.delete(requestId)
          resolve({ decision: 'deny', reason: `Tempo esgotado (${Math.round(timeoutMs / 60000)}min sem resposta).` })
        }, timeoutMs)
      : null

    pending.set(requestId, {
      resolve, sessionId, toolName, toolInput, toolUseId,
      createdAt: new Date().toISOString(),
      timeoutHandle,
    })
  })

  return { requestId, promise }
}

/** Metadados de um pedido pendente (sem a promise), ou null. */
export function peekPendingPermission(requestId) {
  const p = pending.get(requestId)
  if (!p) return null
  const { resolve, timeoutHandle, ...meta } = p
  return { requestId, ...meta }
}

/** Todos os pedidos pendentes de uma sessão (metadados). */
export function listPendingPermissions(sessionId) {
  const out = []
  for (const [requestId, p] of pending) {
    if (p.sessionId === sessionId) out.push({ requestId, toolName: p.toolName, toolInput: p.toolInput, toolUseId: p.toolUseId, createdAt: p.createdAt })
  }
  return out
}

/**
 * Resolve o pedido `requestId` com a decisão do usuário.
 * @param {string} requestId
 * @param {'allow'|'deny'} decision
 * @param {string} [reason]
 * @returns {boolean} true se havia pedido pendente
 */
export function resolvePendingPermission(requestId, decision, reason = null) {
  const p = pending.get(requestId)
  if (!p) return false
  pending.delete(requestId)
  if (p.timeoutHandle) clearTimeout(p.timeoutHandle)
  p.resolve({ decision: decision === 'allow' ? 'allow' : 'deny', reason: reason ?? undefined })
  return true
}

/** Human HTTP replies must match both the request and its owning session. */
export function resolveSessionPermission(sessionId, requestId, decision, reason = null) {
  const request = pending.get(requestId)
  if (!sessionId || request?.sessionId !== sessionId) return false
  return resolvePendingPermission(requestId, decision, reason)
}

/** Cancela (nega) todos os pedidos pendentes de uma sessão. Ex.: turno abortado. */
export function cancelSessionPermissions(sessionId, reason = 'Turno cancelado.') {
  let n = 0
  for (const [requestId, p] of [...pending]) {
    if (p.sessionId !== sessionId) continue
    pending.delete(requestId)
    if (p.timeoutHandle) clearTimeout(p.timeoutHandle)
    p.resolve({ decision: 'deny', reason })
    n++
  }
  return n
}
