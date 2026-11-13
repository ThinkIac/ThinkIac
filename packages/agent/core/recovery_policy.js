import { randomUUID } from 'crypto'

const POLICIES = new Set(['none', 'read-only', 'idempotent', 'reconcile'])

export function ensureOperationId(toolCall, schema = {}) {
  if (!toolCall || schema.recoveryPolicy === 'read-only' || schema.recoveryPolicy === 'none') return toolCall?.operationId || null
  toolCall.operationId ||= randomUUID()
  return toolCall.operationId
}

export function resolveRecoveryPolicy(toolCall, schema = {}, { isReadOnly = false } = {}) {
  const declared = schema.recoveryPolicy || toolCall?.recoveryPolicy
  if (POLICIES.has(declared)) return declared
  if (isReadOnly) return 'read-only'
  
  return 'reconcile'
}

export function recoveryInstruction(toolCall) {
  if (!toolCall || toolCall.recoveryPolicy !== 'reconcile') return null
  const operation = toolCall.operationId ? ` (operationId: ${toolCall.operationId})` : ''
  const reconcile = toolCall.reconcileTool
    ? ` Execute primeiro a tool declarada de reconciliação ${toolCall.reconcileTool}${operation}.`
    : ` Reconcilie primeiro o estado externo/local${operation}.`
  return `RECUPERAÇÃO: a tool ${toolCall.name} foi interrompida após iniciar e o resultado é desconhecido. Não a repita automaticamente.${reconcile}`
}
