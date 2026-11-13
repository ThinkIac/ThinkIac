import test from 'node:test'
import assert from 'node:assert/strict'
import { FrontRegistry } from './chat_bus.js'

test('FrontRegistry preserves connection metadata and hides raw snapshots in lists', () => {
  const registry = new FrontRegistry()
  registry.upsert('agent-ui-a', { route: '/agent', capabilities: ['ui:navigate'], snapshot: { elements: [] } }, { readyState: 1 })
  const [front] = registry.list()
  assert.equal(front.id, 'agent-ui-a')
  assert.equal(front.route, '/agent')
  assert.equal(front.hasSnapshot, true)
  assert.equal('snapshot' in front, false)
})

test('FrontRegistry only removes the socket instance it registered', () => {
  const registry = new FrontRegistry()
  const current = { readyState: 1 }
  registry.upsert('agent-ui-a', {}, current)
  registry.remove('agent-ui-a', { readyState: 1 })
  assert.ok(registry.get('agent-ui-a'))
  registry.remove('agent-ui-a', current)
  assert.equal(registry.get('agent-ui-a'), null)
})
