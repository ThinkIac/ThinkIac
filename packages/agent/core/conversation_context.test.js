import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRecentUserContext } from './conversation_context.js'

test('preserva o pedido atual junto ao contexto recente sem classificar verbos', () => {
  const messages = [
    { role: 'user', content: 'Crie um plano para corrigir a autenticação.' },
    { role: 'assistant', content: 'Plano proposto.' },
    { role: 'user', content: 'Inclua testes de regressão.' },
  ]

  assert.equal(
    buildRecentUserContext(messages, 'Agora coloque em prática.'),
    'Agora coloque em prática.\n\nInclua testes de regressão.\n\nCrie um plano para corrigir a autenticação.'
  )
})

test('não duplica a mensagem atual quando ela já foi persistida', () => {
  const messages = [
    { role: 'user', content: 'Faça a próxima etapa.' },
    { role: 'assistant', content: 'Certo.' },
  ]

  assert.equal(buildRecentUserContext(messages, 'Faça a próxima etapa.'), 'Faça a próxima etapa.')
})
