import test from 'node:test'
import assert from 'node:assert/strict'
import { createTurnContext, createIterationContext, createToolContext } from './execution_context.js'

test('propaga correlação forte do turno até a operação', () => {
  const turn = createTurnContext({ runId: 'run-1', sessionId: 'session-1', turnId: 'turn-1' })
  const iteration = createIterationContext(turn, 4, { iterationId: 'iter-4' })
  const tool = createToolContext(iteration, { id: 'call-9', name: 'run_shell', input: {} }, { operationId: 'op-9' })

  assert.deepEqual(tool.correlation, {
    runId: 'run-1', turnId: 'turn-1', iterationId: 'iter-4', toolCallId: 'call-9', operationId: 'op-9',
  })
  assert.equal(tool.sessionId, 'session-1')
  assert.equal(tool.iteration, 4)
})

test('gera IDs ausentes uma única vez e preserva os fornecidos', () => {
  const turn = createTurnContext({ runId: 'run-2', sessionId: 's' })
  const iteration = createIterationContext(turn, 1)
  const tool = createToolContext(iteration, { name: 'x', input: {} })

  assert.ok(turn.turnId)
  assert.ok(iteration.iterationId)
  assert.ok(tool.toolCallId)
  assert.ok(tool.operationId)
  assert.equal(tool.runId, 'run-2')
})
