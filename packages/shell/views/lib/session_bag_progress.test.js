import assert from 'node:assert/strict'
import test from 'node:test'

import {
  bagProgress,
  bagStatus,
  hasBagSteps,
} from './session_bag_progress.js'

test('uses an explicit progress value, including zero, and clamps it', () => {
  assert.equal(bagProgress({ progress: 0, doneSteps: 2, totalSteps: 4 }), 0)
  assert.equal(bagProgress({ progress: 42, doneSteps: 0, totalSteps: 4 }), 42)
  assert.equal(bagProgress({ progress: 140 }), 100)
  assert.equal(bagProgress({ progress: -20 }), 0)
})

test('derives progress from completed and total steps when needed', () => {
  assert.equal(bagProgress({ doneSteps: 1, totalSteps: 3 }), 33)
  assert.equal(bagProgress({ doneSteps: 9, totalSteps: 4 }), 100)
  assert.equal(bagProgress({ doneSteps: -1, totalSteps: 4 }), 0)
})

test('keeps missing and malformed bag data safe', () => {
  assert.equal(bagProgress(null), 0)
  assert.equal(bagProgress({ progress: Number.NaN, doneSteps: 'nope', totalSteps: 5 }), 0)
  assert.equal(hasBagSteps({ totalSteps: 1 }), true)
  assert.equal(hasBagSteps({ totalSteps: 0 }), false)
  assert.equal(hasBagSteps(null), false)
})

test('normalizes bag states for consistent presentation', () => {
  assert.deepEqual(bagStatus('in_progress'), { key: 'active', label: 'active' })
  assert.deepEqual(bagStatus('done'), { key: 'complete', label: 'complete' })
  assert.deepEqual(bagStatus('paused'), { key: 'paused', label: 'paused' })
  assert.deepEqual(bagStatus('failed'), { key: 'failed', label: 'failed' })
  assert.deepEqual(bagStatus('unknown'), { key: 'idle', label: 'idle' })
})
