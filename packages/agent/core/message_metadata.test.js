import assert from 'node:assert/strict'
import test from 'node:test'

import {
  formatMessageForModel,
  normalizeMessageMetadata,
} from './message_metadata.js'

test('normalizes temporal metadata and an approximate one-time location', () => {
  const metadata = normalizeMessageMetadata({
    timestamp: '2026-07-30T21:54:24-03:00',
    timezone: 'America/Sao_Paulo',
    location: {
      latitude: -23.55052,
      longitude: -46.633308,
      accuracyMeters: 18.8,
      precision: 'approximate',
      consent: 'one_time',
    },
  }, new Date('2026-07-31T00:54:25.000Z'))

  assert.equal(metadata.timestamp, '2026-07-31T00:54:24.000Z')
  assert.equal(metadata.timezone, 'America/Sao_Paulo')
  assert.deepEqual(metadata.location, {
    latitude: -23.55,
    longitude: -46.63,
    accuracyMeters: 19,
    precision: 'approximate',
    consent: 'one_time',
  })
  assert.equal(metadata.receivedAt, '2026-07-31T00:54:25.000Z')
})

test('rejects invalid client values and always supplies server time', () => {
  const metadata = normalizeMessageMetadata({
    timestamp: 'not-a-date',
    timezone: 'Not/A_Real_Zone',
    location: { latitude: 999, longitude: 999 },
  }, new Date('2026-07-31T01:00:00.000Z'))

  assert.deepEqual(metadata, {
    timestamp: '2026-07-31T01:00:00.000Z',
    timezone: 'UTC',
    receivedAt: '2026-07-31T01:00:00.000Z',
  })
})

test('formats metadata for the model without changing persisted content', () => {
  const message = {
    role: 'user',
    content: 'Quanto tempo passou?',
    metadata: {
      timestamp: '2026-07-31T00:54:24.000Z',
      timezone: 'America/Sao_Paulo',
      receivedAt: '2026-07-31T00:54:25.000Z',
      location: {
        latitude: -23.55,
        longitude: -46.63,
        accuracyMeters: 19,
        precision: 'approximate',
        consent: 'one_time',
      },
    },
  }

  assert.match(formatMessageForModel(message), /^\[Message metadata\]/)
  assert.match(formatMessageForModel(message), /timestamp: 2026-07-31T00:54:24.000Z/)
  assert.match(formatMessageForModel(message), /timezone: America\/Sao_Paulo/)
  assert.match(formatMessageForModel(message), /location: -23.55, -46.63 \(approximate/)
  assert.match(formatMessageForModel(message), /\n\nQuanto tempo passou\?$/)
  assert.equal(message.content, 'Quanto tempo passou?')
})
