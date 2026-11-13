import assert from 'node:assert/strict'
import test from 'node:test'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  applyAssistantFeedback,
  buildFeedbackMemory,
  normalizeFeedback,
  persistFeedbackMemory,
} from './message_feedback.js'
import { clearSession, pushMessage, setAssistantFeedback } from '../memory/session.js'

const sessionsDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'sessions')

test('like não carrega motivo ou comentário anterior', () => {
  assert.deepEqual(normalizeFeedback({ value: 'like', reason: 'Outro', comment: 'x' }), {
    value: 'like', reason: null, comment: null,
  })
})

test('dislike exige um motivo permitido e aceita comentário opcional', () => {
  assert.throws(() => normalizeFeedback({ value: 'dislike' }), /motivo/)
  assert.deepEqual(normalizeFeedback({ value: 'dislike', reason: 'Faltou clareza', comment: '  explique melhor  ' }), {
    value: 'dislike', reason: 'Faltou clareza', comment: 'explique melhor',
  })
})

test('altera somente a resposta assistente indicada, ignorando tools', () => {
  const messages = [
    { role: 'user', content: 'oi' },
    { role: 'assistant', content: 'primeira' },
    { role: 'tool', content: 'resultado' },
    { role: 'assistant', content: 'segunda' },
  ]
  const saved = applyAssistantFeedback(messages, 1, { value: 'dislike', reason: 'Resposta incorreta' }, new Date('2026-07-30T19:00:00Z'))

  assert.equal(messages[1].feedback, undefined)
  assert.deepEqual(messages[3].feedback, saved)
  assert.equal(saved.updated_at, '2026-07-30T19:00:00.000Z')
})

test('persiste o feedback no arquivo da sessão', async () => {
  const sessionId = `feedback-test-${Date.now()}-${Math.random().toString(36).slice(2)}`
  try {
    pushMessage(sessionId, { role: 'assistant', content: 'resposta persistida' })
    await setAssistantFeedback(sessionId, 0, { value: 'dislike', reason: 'Não resolveu o pedido' })

    const stored = JSON.parse(await readFile(join(sessionsDir, `${sessionId}.json`), 'utf8'))
    assert.equal(stored.messages[0].feedback.value, 'dislike')
    assert.equal(stored.messages[0].feedback.reason, 'Não resolveu o pedido')
  } finally {
    clearSession(sessionId)
  }
})

test('monta memória útil para likes e dislikes sem copiar conteúdo ilimitado', () => {
  const messages = [
    { role: 'user', content: `pedido ${'a'.repeat(800)}` },
    { role: 'assistant', content: `resposta ${'b'.repeat(1200)}` },
  ]

  const like = buildFeedbackMemory('sessao-1', messages, 0, {
    value: 'like', reason: null, comment: null,
  })
  assert.match(like.content, /O usuário aprovou uma resposta/)
  assert.match(like.content, /Pedido relacionado:/)
  assert.ok(like.content.length < 1400)

  const dislike = buildFeedbackMemory('sessao-1', messages, 0, {
    value: 'dislike', reason: 'Faltou clareza', comment: 'Use exemplos',
  })
  assert.match(dislike.content, /O usuário desaprovou uma resposta/)
  assert.match(dislike.content, /Motivo: Faltou clareza/)
  assert.match(dislike.content, /Comentário: Use exemplos/)
  assert.equal(dislike.marker, like.marker)
})

test('atualiza a memória da mesma resposta em vez de acumular votos contraditórios', async () => {
  const calls = []
  const memory = buildFeedbackMemory('sessao-2', [
    { role: 'user', content: 'Explique X' },
    { role: 'assistant', content: 'Resposta X' },
  ], 0, { value: 'like', reason: null, comment: null })

  await persistFeedbackMemory(memory, {
    forget: async marker => calls.push(['forget', marker]),
    remember: async input => calls.push(['remember', input]),
  })

  assert.deepEqual(calls[0], ['forget', memory.marker])
  assert.equal(calls[1][0], 'remember')
  assert.equal(calls[1][1].entity, 'Preferências de resposta do usuário')
  assert.equal(calls[1][1].type, 'preference')
  assert.equal(calls[1][1].source, 'message_feedback')
})
