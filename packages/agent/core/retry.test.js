import test from 'node:test'
import assert from 'node:assert/strict'
import { withRetry } from './retry.js'

test('repete uma operação transitória até concluir', async () => {
  let attempts = 0
  const result = await withRetry(async () => {
    attempts++
    if (attempts < 3) throw Object.assign(new Error('temporário'), { retryable: true })
    return 'ok'
  }, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 })
  assert.equal(result, 'ok')
  assert.equal(attempts, 3)
})

test('não repete falha permanente nem ultrapassa o limite', async () => {
  let attempts = 0
  await assert.rejects(() => withRetry(async () => {
    attempts++
    throw Object.assign(new Error('credencial inválida'), { status: 401 })
  }, { maxAttempts: 5, baseDelayMs: 0 }), /credencial inválida/)
  assert.equal(attempts, 1)

  attempts = 0
  await assert.rejects(() => withRetry(async () => {
    attempts++
    throw Object.assign(new Error('indisponível'), { retryable: true })
  }, { maxAttempts: 2, baseDelayMs: 0 }), /indisponível/)
  assert.equal(attempts, 2)
})

