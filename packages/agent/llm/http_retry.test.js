import test from 'node:test'
import assert from 'node:assert/strict'
import { fetchWithRetry } from './http_retry.js'
import { normalizeRetryPolicy } from './http_retry.js'

test('uses the default retry policy when a slot carries null', () => {
  assert.equal(normalizeRetryPolicy(null).maxAttempts, 2)
})

test('retries configured transient responses and returns the successful response', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => new Response(++calls < 3 ? 'temporary' : 'ok', { status: calls < 3 ? 502 : 200 })
  try {
    const response = await fetchWithRetry('https://example.test', {}, { maxAttempts: 3, baseDelayMs: 0, maxDelayMs: 0 }, { random: () => 0 })
    assert.equal(response.status, 200)
    assert.equal(calls, 3)
  } finally { globalThis.fetch = original }
})

test('does not retry permanent authentication failures', async () => {
  const original = globalThis.fetch
  let calls = 0
  globalThis.fetch = async () => { calls++; return new Response('invalid', { status: 401 }) }
  try {
    const response = await fetchWithRetry('https://example.test', {}, { maxAttempts: 4, baseDelayMs: 0 })
    assert.equal(response.status, 401)
    assert.equal(calls, 1)
  } finally { globalThis.fetch = original }
})
