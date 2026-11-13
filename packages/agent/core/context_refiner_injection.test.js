import test from 'node:test'
import assert from 'node:assert/strict'
import { ContextRefiner } from './context_refiner.js'

test('usa embedder injetado e cacheia por texto completo', async () => {
  const calls = []
  const vectors = new Map([['alpha', [1, 0]], ['beta', [0, 1]]])
  const refiner = new ContextRefiner({ embedder: async text => { calls.push(text); return vectors.get(text) } })

  assert.equal(await refiner.scoreRelevance('alpha', 'beta'), 0)
  assert.equal(await refiner.scoreRelevance('alpha', 'alpha'), 1)
  assert.deepEqual(calls, ['alpha', 'beta'])
})
