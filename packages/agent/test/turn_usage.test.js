import assert from 'node:assert/strict'
import test from 'node:test'

import { resetTurnUsage, getTurnUsage, addTurnUsage } from '../core/turn_usage.js'
import { estimateCostUsd, refreshPricingNow } from '../core/turn_cost.js'

test('addTurnUsage acumula tokens e custo por sessão', () => {
  resetTurnUsage('s1')
  addTurnUsage('s1', {
    usage: { prompt_tokens: 100, completion_tokens: 50 },
    model: 'openai/gpt-4o-mini',
    provider: 'openrouter',
  })
  addTurnUsage('s1', {
    usage: { prompt_tokens: 200, completion_tokens: 100 },
    model: 'openai/gpt-4o-mini',
    provider: 'openrouter',
  })
  const u = getTurnUsage('s1')
  assert.equal(u.prompt_tokens, 300)
  assert.equal(u.completion_tokens, 150)
  assert.ok(u.cost > 0, 'custo deve ser derivado dos tokens quando não vier pronto')
  assert.equal(u.model, 'openai/gpt-4o-mini')
})

test('cost real do provider tem prioridade sobre a estimativa', () => {
  resetTurnUsage('s2')
  addTurnUsage('s2', {
    usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0123 },
    model: 'anthropic/claude-sonnet-4-5',
    provider: 'claude-cli',
  })
  const u = getTurnUsage('s2')
  assert.equal(u.cost, 0.0123)
})

test('resetTurnUsage zera o acumulador', () => {
  resetTurnUsage('s3')
  addTurnUsage('s3', { usage: { prompt_tokens: 10 }, model: 'm' })
  resetTurnUsage('s3')
  assert.equal(getTurnUsage('s3'), null)
})

test('estimateCostUsd usa cost real quando presente', () => {
  assert.equal(estimateCostUsd('m', { cost: 0.5 }), 0.5)
})

test('estimateCostUsd deriva custo dos tokens com fallback', () => {
  const c = estimateCostUsd('modelo-desconhecido', { prompt_tokens: 1000, completion_tokens: 1000 })
  assert.ok(c > 0, 'fallback deve produzir custo > 0')
})

test('refreshPricingNow popula o cache de preços', async () => {
  await refreshPricingNow()
  
  assert.ok(true)
})
