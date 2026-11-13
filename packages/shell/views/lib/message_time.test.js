import assert from 'node:assert/strict'
import test from 'node:test'

import {
  copyMessageTiming,
  formatMessageTime,
  messageTimestamp,
} from './message_time.js'

test('formats a message timestamp as local HH:mm', () => {
  assert.equal(formatMessageTime('2026-08-04T20:35:04.244Z', 'UTC'), '20:35')
  assert.equal(formatMessageTime('2026-08-04T20:35:04.244Z', 'America/Sao_Paulo'), '17:35')
})

test('returns no time for missing or invalid timestamps', () => {
  assert.equal(formatMessageTime(undefined), '')
  assert.equal(formatMessageTime('not-a-date'), '')
})

test('selects user metadata and assistant creation timestamps', () => {
  assert.equal(messageTimestamp({ role: 'user', metadata: { timestamp: '2026-08-04T20:30:00.000Z' } }), '2026-08-04T20:30:00.000Z')
  assert.equal(messageTimestamp({ role: 'assistant', createdAt: '2026-08-04T20:31:00.000Z' }), '2026-08-04T20:31:00.000Z')
})

test('copies persisted timing fields while sanitizing history', () => {
  const metadata = { timestamp: '2026-08-04T20:30:00.000Z', timezone: 'America/Sao_Paulo' }
  assert.deepEqual(copyMessageTiming({ metadata, createdAt: '2026-08-04T20:31:00.000Z' }), {
    metadata,
    createdAt: '2026-08-04T20:31:00.000Z',
  })
})
