import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeToolOutcome, toolOutcomeError, legacyToolResult, publicToolOutcome } from './tool_outcome.js'

test('normaliza retornos legados de sucesso sem perder o valor', () => {
  const value = { success: true, rows: [1, 2] }
  const outcome = normalizeToolOutcome(value, { operationId: 'op-1', durationMs: 12 })

  assert.equal(outcome.ok, true)
  assert.equal(outcome.value, value)
  assert.equal(outcome.operationId, 'op-1')
  assert.equal(outcome.metrics.durationMs, 12)
})

test('success:false e ok:false são falhas mesmo sem throw', () => {
  for (const value of [
    { success: false, error: 'runtime indisponível' },
    { ok: false, error: { code: 'DENIED', message: 'negado', retryable: false } },
  ]) {
    const outcome = normalizeToolOutcome(value)
    assert.equal(outcome.ok, false)
    assert.equal(outcome.error.message, typeof value.error === 'string' ? value.error : value.error.message)
  }
})

test('exceção vira erro estruturado e sanitizado', () => {
  const outcome = toolOutcomeError(Object.assign(new Error('boom'), { code: 'E_BROKEN', retryable: true }), {
    operationId: 'op-2',
  })

  assert.deepEqual(outcome.error, {
    code: 'E_BROKEN', message: 'boom', retryable: true, category: 'unexpected',
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.operationId, 'op-2')
})

test('preserva ToolOutcome canônico sem aninhá-lo novamente', () => {
  const canonical = {
    ok: false,
    value: null,
    error: { code: 'TIMEOUT', message: 'demorou', retryable: true, category: 'provider' },
    changedState: false,
    operationId: 'op-3',
    metrics: { durationMs: 30 },
  }
  assert.deepEqual(normalizeToolOutcome(canonical), canonical)
})

test('sanitiza ciclos e a referência interna do Runtime antes de publicar resultado', () => {
  const scriba = { _tenants: {} }
  const artifact = { id: 'artifact-1', _scriba: scriba }
  scriba._tenants.artifacts = { artifact }
  const outcome = normalizeToolOutcome(artifact)

  assert.deepEqual(legacyToolResult(outcome), { id: 'artifact-1', _scriba: '[Runtime]' })
  assert.doesNotThrow(() => JSON.stringify(publicToolOutcome(outcome)))
})
