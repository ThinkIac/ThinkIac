import test from 'node:test'
import assert from 'node:assert/strict'
import { installEventTap, listRecentEvents, getEventObserverStatus } from '../lib/triggers.js'

test('o tap registra o nome real e o payload do evento do bus', async () => {
  const bus = {
    async pipeline(event, payload) { return { event, payload } },
  }

  assert.equal(installEventTap(bus), true)
  await bus.pipeline('tasks:completed', { taskId: 't-1', title: 'Revisar Specialist' })
  await new Promise(resolve => setImmediate(resolve))

  const event = listRecentEvents().find(item => item.event === 'tasks:completed')
  assert.ok(event)
  assert.equal(event.payload.taskId, 't-1')
})

test('o tap descarta namespaces internos de alto volume', async () => {
  const eventsBefore = listRecentEvents().length
  const bus = globalThis.__specialistsEventTap.bus
  await bus.pipeline('http:request', { path: '/health' })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(listRecentEvents().length, eventsBefore)
})

test('o observador informa instalação e origem da captura', () => {
  const status = getEventObserverStatus()
  assert.equal(status.installed, true)
  assert.ok(status.source)
  assert.ok(status.installedAt)
})
