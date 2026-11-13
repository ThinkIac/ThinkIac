import test from 'node:test'
import assert from 'node:assert/strict'
import { ensureOperationId, resolveRecoveryPolicy, recoveryInstruction } from './recovery_policy.js'

test('política declarativa vence inferência', () => {
  assert.equal(resolveRecoveryPolicy({ name: 'fetch', input: {} }, { recoveryPolicy: 'idempotent' }), 'idempotent')
  assert.equal(resolveRecoveryPolicy({ name: 'delete', input: { idempotencyKey: 'x' } }, { recoveryPolicy: 'reconcile' }), 'reconcile')
})

test('gera operationId estável antes da mutação', () => {
  const call = { name: 'send', input: {} }
  const first = ensureOperationId(call, { recoveryPolicy: 'idempotent' })
  const second = ensureOperationId(call, { recoveryPolicy: 'idempotent' })
  assert.equal(first, second)
  assert.equal(call.operationId, first)
})

test('reconciliação declarativa aponta para a tool correspondente', () => {
  const instruction = recoveryInstruction({ name: 'charge', operationId: 'op', recoveryPolicy: 'reconcile', reconcileTool: 'getCharge' })
  assert.match(instruction, /getCharge/)
  assert.match(instruction, /op/)
})
