import test from 'node:test'
import assert from 'node:assert/strict'
import { requiresRuntimeGovernance } from './runtime_bridge.js'

test('runtime bridge permits an anonymous read-only query', () => {
  assert.equal(requiresRuntimeGovernance('tasks', 'list_tasks', {}), false)
})

test('runtime bridge requires governance for stateful runtime calls', () => {
  assert.equal(requiresRuntimeGovernance('tasks', 'create_task', { title: 'x' }), true)
  assert.equal(requiresRuntimeGovernance('shell', 'execute_command', { command: 'pwd' }), true)
})
