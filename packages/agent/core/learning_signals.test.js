import test from 'node:test'
import assert from 'node:assert/strict'
import { classifyUserFeedback, normalizeDistillation } from './learning_signals.js'

test('classifica apenas feedback explícito do usuário', () => {
  assert.equal(classifyUserFeedback('Aprovado, funcionou perfeitamente.'), 'accepted')
  assert.equal(classifyUserFeedback('Não funcionou, corrija isso.'), 'rejected')
  assert.equal(classifyUserFeedback('Qual é a previsão do tempo?'), null)
})

test('persiste apenas o golden nugget, não o reasoning bruto', () => {
  const note = normalizeDistillation({ has_gold: true, category: 'fact', golden_nugget: 'O provider X exige JSON.' }, {
    iteration: 2, tools: ['call'], reasoning: 'raciocínio enorme e privado',
  })
  assert.equal(note.content, 'O provider X exige JSON.')
  assert.equal('reasoning' in note, false)
  assert.equal(note.category, 'fact')
})

test('destilação inválida não cria memória', () => {
  assert.equal(normalizeDistillation({ has_gold: false, golden_nugget: 'não salvar' }), null)
  assert.equal(normalizeDistillation({ has_gold: true, golden_nugget: '' }), null)
})
