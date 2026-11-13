import assert from 'node:assert/strict'
import test from 'node:test'
import { listActivities, openActivity, updateActivity, TERMINAL_TTL_MS } from './activity_registry.js'

test('activity registry preserves the owner and exposes only its activities', () => {
  const owner = `test-owner-${Date.now()}`
  const other = `${owner}-other`
  const activity = openActivity({ ownerSessionId: owner, title: 'Pesquisa', targetSessionId: 'sub:test' })
  assert.equal(listActivities(owner).some((item) => item.id === activity.id), true)
  assert.equal(listActivities(other).some((item) => item.id === activity.id), false)
})

test('activity registry keeps a recent terminal result actionable', () => {
  const owner = `test-terminal-${Date.now()}`
  const activity = openActivity({ ownerSessionId: owner, title: 'Build' })
  const done = updateActivity(activity.id, { state: 'success', result: 'ok' })
  assert.equal(done.state, 'success')
  assert.equal(listActivities(owner).find((item) => item.id === activity.id)?.resultPreview, 'ok')
})

test('activity registry removes a terminal result after its short handoff window', async () => {
  const owner = `test-expiry-${Date.now()}`
  const activity = openActivity({ ownerSessionId: owner, title: 'Pesquisa' })
  updateActivity(activity.id, { state: 'success', result: 'ok' })
  await new Promise((resolve) => setTimeout(resolve, TERMINAL_TTL_MS + 25))
  assert.equal(listActivities(owner).some((item) => item.id === activity.id), false)
})
