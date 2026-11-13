import assert from 'node:assert/strict'
import test from 'node:test'

import * as queue from './message_queue.js'

test('message queue preserves metadata with queued messages', () => {
  const sessionId = `queue-meta-${Date.now()}`
  const metadata = { timestamp: '2026-07-31T00:54:24.000Z', timezone: 'UTC' }

  queue.enqueue(sessionId, { message: 'depois', metadata })

  assert.deepEqual(queue.drain(sessionId), [{ message: 'depois', metadata }])
  assert.equal(queue.size(sessionId), 0)
})
