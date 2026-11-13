import { broadcast } from 'logos'
import { consumeApproval, evaluateAction, getDecision, resolveConfirmation, resolveDeviceConfirmation } from './service.js'
import { isReadOnly } from './lib/engine.js'

// Leitura sem sessão continua passando: o engine classifica QUALQUER ação sem
// sessionId como 'blocked' (inclusive `list*`/`get*`), e barrar isso derrubaria
// até um `think agent:tool listTasks` de terminal. O que altera estado, não:
// esse falha fechado, porque sem sessão não há a quem pedir confirmação nem a
// quem atribuir a ação depois. GOVERNANCE_ALLOW_UNTRACKED=1 volta ao antigo
// (audita e deixa passar) pra quem precisar de automação fora de sessão.
const ALLOW_UNTRACKED = process.env.GOVERNANCE_ALLOW_UNTRACKED === '1'

const veto = (payload, code, reason, details) => ({ ...payload, veto: true, code, reason, ...(details ? { details } : {}) })

export async function resolveStructuredSubmission(payload = {}, dependencies = {}) {
  const resolve = dependencies.resolve || resolveConfirmation
  const notify = dependencies.notify || (detail => broadcast({
    type: 'bus:event',
    event: payload.responseEvent || 'structured-input:resolved',
    detail,
  }))
  const steps = Array.isArray(payload.steps) ? payload.steps : []
  const index = steps.findIndex(step => step?.governanceDecisionId)
  if (index < 0) return payload
  const step = steps[index]
  const answer = payload.responses?.[index]
  const approved = answer === step.confirmLabel
  await resolve({ sessionId: payload.sessionId, decisionId: step.governanceDecisionId, approved })
  const detail = {
    sessionId: payload.sessionId,
    submissionId: payload.submissionId,
    text: approved
      ? `Aprovação de governança registrada para a decisão ${step.governanceDecisionId}. Continue a ação previamente proposta.`
      : `Ação negada pelo usuário para a decisão ${step.governanceDecisionId}. Não execute a ação e informe alternativas seguras.`,
  }
  await notify(detail)
  return { ...payload, handled: true }
}

export async function onStructuredInputResolve(payload = {}) {
  /** @register_hook logos:governance:resolve */

  return resolveStructuredSubmission(payload)
}

export async function onDeviceResponse(payload = {}) {
  /**
   * @register_hook device:response
   * @description Resolve uma aprovação de governança respondida silenciosamente numa notificação Android.
   */
  await resolveDeviceConfirmation(payload)
  return payload
}

export async function onToolBefore(payload, context) {
  /** @register_hook tool_before */

  // O agentLoop tem o próprio gate (governanceGate) e marca payload.governed —
  // reavaliar aqui seria decisão em dobro na auditoria.
  if (payload?.governed) return payload

  // Chamadas de FORA do loop chegam pelo transporte MCP HTTP (Codex, Claude
  // Code, `think agent:*`). Esse caminho não tem outro ponto de parada: este
  // hook é o gate dele. Quando o bus dispara por veto() — o que o /mcp/call
  // faz — devolver `veto: true` interrompe a execução da tool; quando dispara
  // por pipeline(), o retorno só substitui o payload e o hook segue sendo
  // observador, como era antes. Por isso o payload original vai junto no
  // retorno: nenhum handler seguinte perde contexto.
  const sessionId = payload?.sessionId ?? null
  const tool = payload?.tool
  const input = payload?.payload

  // 1. Repetição de uma chamada que já foi confirmada. O consumo é de uso
  //    único e amarrado ao hash da ação, então uma aprovação não pode ser
  //    reciclada para outra tool nem para outros argumentos.
  const decisionId = context?.approval?.decisionId ?? null
  if (sessionId && decisionId) {
    const decision = getDecision({ sessionId, decisionId })
    if (decision?.status === 'denied') {
      return veto(payload, 'CONFIRMATION_DENIED', `CONFIRMAÇÃO NEGADA: o usuário negou esta ação (decisão: ${decisionId}).`)
    }
    try {
      await consumeApproval({ sessionId, decisionId, tool, input })
      return payload
    } catch (e) {
      return veto(payload, 'CONFIRMATION_DENIED', `CONFIRMAÇÃO INVÁLIDA: ${e.message} (decisão: ${decisionId}).`)
    }
  }

  // 2. Sem sessão rastreável.
  if (!sessionId) {
    const readOnly = isReadOnly({ tool, input })
    // A auditoria roda dos dois lados: uma tentativa barrada é justamente o
    // que precisa ficar registrado.
    try { await evaluateAction({ tool, input }) } catch { /* auditoria nunca derruba a tool */ }
    if (readOnly || ALLOW_UNTRACKED) return payload
    return veto(payload, 'MISSING_SESSION',
      'SESSÃO AUSENTE: esta ação altera estado e a chamada não tem sessão rastreável. ' +
      'Mande o header x-session-id (ou AURORA_SESSION_ID no processo que abriu a chamada).')
  }

  // 3. Avaliação normal, sob a política da sessão.
  try {
    const decision = await evaluateAction({ sessionId, tool, input })
    if (decision && !decision.allowed) {
      return decision.classification === 'blocked'
        ? veto(payload, 'GOVERNANCE_BLOCKED', `AÇÃO BLOQUEADA: ${decision.reason} (decisão: ${decision.decisionId})`, { decisionId: decision.decisionId })
        : veto(payload, 'CONFIRMATION_REQUIRED', `CONFIRMAÇÃO NECESSÁRIA: ${decision.reason} (decisão: ${decision.decisionId})`, { decisionId: decision.decisionId })
    }
  } catch (error) {
    // O gate é uma fronteira de segurança: indisponibilidade da política não
    // pode virar autorização implícita para uma ação mutável.
    return veto(
      payload,
      'GOVERNANCE_ERROR',
      `GOVERNANÇA INDISPONÍVEL: a ação não foi executada porque a avaliação falhou (${error?.message || error}).`,
    )
  }
  return payload
}
