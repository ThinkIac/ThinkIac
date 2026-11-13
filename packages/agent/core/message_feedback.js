import { forget as memoryForget, remember as memoryRemember } from '../../memory/lib/graph.js'

const FEEDBACK_VALUES = new Set(['like', 'dislike'])
export const DISLIKE_REASONS = new Set([
  'Resposta incorreta',
  'Não resolveu o pedido',
  'Faltou clareza',
  'Outro',
])

export function normalizeFeedback(input = {}) {
  const value = input.value
  if (!FEEDBACK_VALUES.has(value)) throw new Error('feedback inválido')

  if (value === 'like') {
    return { value, reason: null, comment: null }
  }

  const reason = typeof input.reason === 'string' ? input.reason.trim() : ''
  if (!DISLIKE_REASONS.has(reason)) throw new Error('motivo do dislike é obrigatório')

  const comment = typeof input.comment === 'string' ? input.comment.trim() : ''
  if (comment.length > 1000) throw new Error('comentário excede 1000 caracteres')
  return { value, reason, comment: comment || null }
}

export function applyAssistantFeedback(messages, assistantOrdinal, input, now = new Date()) {
  const ordinal = Number(assistantOrdinal)
  if (!Number.isInteger(ordinal) || ordinal < 0) throw new Error('resposta inválida')

  const feedback = { ...normalizeFeedback(input), updated_at: now.toISOString() }
  let seen = -1
  const message = (messages ?? []).find((item) => {
    if (item?.role !== 'assistant' || !String(item.content ?? '').trim()) return false
    seen += 1
    return seen === ordinal
  })
  if (!message) throw new Error('resposta não encontrada')

  message.feedback = feedback
  return feedback
}

function compactText(value, maxLength) {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim()
  return text.length <= maxLength ? text : `${text.slice(0, maxLength - 1)}…`
}

function assistantMessageAt(messages, assistantOrdinal) {
  let seen = -1
  return (messages ?? []).find((item) => {
    if (item?.role !== 'assistant' || !String(item.content ?? '').trim()) return false
    seen += 1
    return seen === Number(assistantOrdinal)
  })
}

export function buildFeedbackMemory(sessionId, messages, assistantOrdinal, feedback) {
  const ordinal = Number(assistantOrdinal)
  const assistant = assistantMessageAt(messages, ordinal)
  if (!assistant) throw new Error('resposta não encontrada')

  const assistantIndex = messages.indexOf(assistant)
  const user = messages.slice(0, assistantIndex).reverse()
    .find(item => item?.role === 'user' && String(item.content ?? '').trim())
  const marker = `[message-feedback:${sessionId}:${ordinal}]`
  const verdict = feedback.value === 'like'
    ? 'O usuário aprovou uma resposta.'
    : 'O usuário desaprovou uma resposta.'
  const details = [
    marker,
    verdict,
    feedback.reason ? `Motivo: ${feedback.reason}.` : null,
    feedback.comment ? `Comentário: ${compactText(feedback.comment, 300)}.` : null,
    user ? `Pedido relacionado: ${compactText(user.content, 350)}` : null,
    `Resposta avaliada: ${compactText(assistant.content, 500)}`,
  ].filter(Boolean)

  return { marker, content: details.join('\n') }
}

export async function persistFeedbackMemory(memory, {
  forget = memoryForget,
  remember = memoryRemember,
} = {}) {
  await forget(memory.marker)
  return remember({
    content: memory.content,
    entity: 'Preferências de resposta do usuário',
    type: 'preference',
    sessionId: memory.sessionId ?? null,
    source: 'message_feedback',
  })
}
