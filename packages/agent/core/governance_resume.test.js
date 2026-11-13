import assert from 'node:assert/strict'
import { createGovernanceResumeCoordinator } from './governance_resume.js'

let passed = 0
async function test(name, fn) { await fn(); passed++; console.log(`PASS ${name}`) }

await test('waits for an active session and resumes without a user message', async () => {
  let active = true
  const calls = []
  const coordinator = createGovernanceResumeCoordinator({
    isActive: () => active,
    delay: async () => { active = false },
    resume: async sessionId => calls.push(sessionId),
  })
  await coordinator.schedule('session-1')
  assert.deepEqual(calls, ['session-1'])
})

await test('serializes approvals that arrive while a resume is running', async () => {
  const calls = []
  const coordinator = createGovernanceResumeCoordinator({
    isActive: () => false,
    delay: async () => {},
    resume: async sessionId => { calls.push(sessionId) },
  })
  await Promise.all([coordinator.schedule('session-2'), coordinator.schedule('session-2')])
  assert.deepEqual(calls, ['session-2', 'session-2'])
})

console.log(`\n${passed} tests passed`)
