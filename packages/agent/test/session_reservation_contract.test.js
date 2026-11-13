import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

const agent = readFileSync(join(import.meta.dirname, '..', 'core', 'agent.js'), 'utf8')

test('initial persistence failure releases the active session reservation', () => {
  const reservation = agent.indexOf('activeSessions.add(sessionId)')
  const durableStart = agent.indexOf('durableRuns.start(', reservation)
  const rollback = agent.indexOf('activeSessions.delete(sessionId)', durableStart)
  const mainTry = agent.indexOf("const modified = await $('agent:start'", durableStart)

  assert.ok(reservation >= 0 && durableStart > reservation)
  assert.ok(rollback > durableStart && rollback < mainTry)
})
