

























const pending = new Map() 

export function hasPendingQuestion(sessionId) {
  return pending.has(sessionId)
}

export function peekPendingQuestion(sessionId) {
  const p = pending.get(sessionId)
  return p ? { question: p.question, createdAt: p.createdAt } : null
}

/**
 * Registra uma pergunta pendente pra `sessionId` e devolve uma Promise que
 * resolve com o texto de resposta (via resolvePendingQuestion) ou rejeita
 * por timeout/cancelamento. Só uma pergunta pendente por vez por sessão.
 *
 * @param {string} sessionId
 * @param {string} question
 * @param {{ timeoutMs?: number }} opts - default 30min; 0/null/Infinity = sem teto
 */
export function registerPendingQuestion(sessionId, question, { timeoutMs = 30 * 60_000 } = {}) {
  if (pending.has(sessionId)) {
    throw new Error(`Já existe uma pergunta pendente pra sessão "${sessionId}".`)
  }

  return new Promise((resolve, reject) => {
    const hasTimeout = timeoutMs != null && Number.isFinite(timeoutMs) && timeoutMs > 0
    const timeoutHandle = hasTimeout
      ? setTimeout(() => {
          pending.delete(sessionId)
          reject(new Error(`Usuário não respondeu em ${Math.round(timeoutMs / 60000)}min.`))
        }, timeoutMs)
      : null

    pending.set(sessionId, {
      resolve, reject, question,
      createdAt: new Date().toISOString(),
      timeoutHandle,
    })
  })
}

/**
 * Resolve a pergunta pendente de `sessionId` com o texto de resposta.
 * @returns {boolean} true se havia pergunta pendente (e foi resolvida)
 */
export function resolvePendingQuestion(sessionId, answerText) {
  const p = pending.get(sessionId)
  if (!p) return false
  pending.delete(sessionId)
  if (p.timeoutHandle) clearTimeout(p.timeoutHandle)
  p.resolve(answerText)
  return true
}

/** Cancela a pergunta pendente de `sessionId` (rejeita a Promise). */
export function cancelPendingQuestion(sessionId, reason = 'cancelado') {
  const p = pending.get(sessionId)
  if (!p) return false
  pending.delete(sessionId)
  if (p.timeoutHandle) clearTimeout(p.timeoutHandle)
  p.reject(new Error(reason))
  return true
}
