import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TurnCoordinator, ResponseInterpreter, ToolExecutor,
  GovernanceGate, RunJournal, OutcomeEvaluator,
} from './execution_kernel.js'

test('máquina rejeita transições inválidas e registra as válidas', () => {
  const events = []
  const coordinator = new TurnCoordinator({ emit: (name, payload) => events.push([name, payload]) })
  coordinator.transition('context-compiled')
  coordinator.transition('model-selected')
  assert.throws(() => coordinator.transition('tool-executing'), /Transição inválida/)
  assert.deepEqual(events.map(([, payload]) => payload.to), ['context-compiled', 'model-selected'])
})

test('replay completo distingue execução, falha e conclusão', async () => {
  const checkpoints = []
  const journal = new RunJournal({ checkpoint: (_id, value) => checkpoints.push(value) }, 'run-1')
  const interpreter = new ResponseInterpreter({ parse: value => value })
  const gate = new GovernanceGate({ evaluate: async () => ({ allowed: true }) })
  const executor = new ToolExecutor({ invoke: async call => call.name === 'bad'
    ? { success: false, error: 'falhou sem throw' }
    : { success: true, changedState: true } })
  const evaluator = new OutcomeEvaluator()
  const coordinator = new TurnCoordinator({ journal })

  const result = await coordinator.replay({
    compileContext: async () => ({ prompt: 'ctx' }),
    callModel: async () => ({ tool_calls: [{ id: 'a', name: 'ok' }, { id: 'b', name: 'bad' }] }),
    interpreter, gate, executor, evaluator,
  })

  assert.equal(result.outcomes[0].ok, true)
  assert.equal(result.outcomes[1].ok, false)
  assert.equal(result.evaluation.completed, false)
  assert.equal(result.evaluation.madeProgress, true)
  assert.equal(coordinator.state, 'finalized')
  assert.ok(checkpoints.some(item => item.phase === 'tool-completed'))
})
