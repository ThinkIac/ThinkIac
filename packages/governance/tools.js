import { evaluateAction, getSessionPolicy, listDecisions, listPending, listSessionPolicies, resolveConfirmation, setSessionPolicy } from './service.js'

async function call(fn) { try { return { success: true, data: await fn() } } catch (error) { return { success: false, error: error.message } } }

export function evaluateGovernanceAction(args = {}) {
  /** @register_tool evaluateGovernanceAction
   * @description Classifica uma ação como safe, needs_confirmation ou blocked sem executá-la.
   * @param {string} sessionId - Sessão dona da ação
   * @param {string} tool - Tool pretendida
   * @param {object?} input - Argumentos da tool
   */
  return call(() => evaluateAction(args))
}

export function resolveGovernanceConfirmation(args = {}) {
  /** @register_tool resolveGovernanceConfirmation
   * @description Registra a resposta de um StructuredInput para uma confirmação de governança, de uso único.
   * @param {string} sessionId - Sessão dona da confirmação
   * @param {string} decisionId - Identificador da confirmação
   * @param {boolean} approved - Decisão explícita do usuário
   */
  return call(() => resolveConfirmation(args))
}

export function listGovernanceDecisions(args = {}) {
  /** @register_tool listGovernanceDecisions @description Lista a auditoria de decisões de governança por sessão. */
  return { success: true, data: listDecisions(args) }
}

export function listPendingConfirmations(args = {}) {
  /** @register_tool listPendingConfirmations @description Lista confirmações de governança pendentes (aguardando Aprovar/Negar), opcionalmente filtradas por sessão. */
  return { success: true, data: listPending(args) }
}

export function getGovernancePolicy(args = {}) {
  /** @register_tool getGovernancePolicy
   * @description Lê o modo de aprovação da sessão, o preset e a política do modo semi-automático.
   * @param {string} sessionId - Sessão consultada
   */
  return call(() => getSessionPolicy(args))
}

export function setGovernancePolicy(args = {}) {
  /** @register_tool setGovernancePolicy
   * @description Define o modo de aprovação, com presets semi Read only, Workspace edits ou Custom. A LLM classifica, mas a matriz determinística mantém ações sensíveis bloqueadas.
   * @param {string} sessionId - Sessão alvo
   * @param {string?} mode - auto, semi ou manual
   * @param {string?} preset - read_only, workspace_edits ou custom
   * @param {string?} prompt - Política em linguagem natural usada pelo modo semi
   */
  return call(() => setSessionPolicy(args))
}

export function listGovernancePolicies() {
  /** @register_tool listGovernancePolicies @description Lista os modos de aprovação configurados por sessão. */
  return { success: true, data: listSessionPolicies() }
}
