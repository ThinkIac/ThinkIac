import assert from 'node:assert/strict'
import test from 'node:test'
import { getPolicy, inheritPolicy, setPoliciesForTest, setPolicy } from '../lib/policy.js'

test('subagent policy inherits the complete effective policy from its parent', () => {
  setPoliciesForTest({})
  setPolicy({ sessionId: 'parent', mode: 'semi', preset: 'custom', prompt: 'Allow local inspection only.' })

  inheritPolicy('parent', 'child')

  const parent = getPolicy('parent')
  const child = getPolicy('child')
  assert.deepEqual(
    { mode: child.mode, preset: child.preset, prompt: child.prompt },
    { mode: parent.mode, preset: parent.preset, prompt: parent.prompt },
  )
})

test('default parent policy remains restrictive when inherited', () => {
  setPoliciesForTest({})
  inheritPolicy('new-parent', 'new-child')
  assert.equal(getPolicy('new-child').preset, 'read_only')
  assert.equal(getPolicy('new-child').mode, 'semi')
})
