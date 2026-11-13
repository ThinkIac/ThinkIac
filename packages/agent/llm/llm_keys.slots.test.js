import test from 'node:test'
import assert from 'node:assert/strict'
import { acquireSlotLease, buildSlots } from './llm_keys.js'

test('disabled credential entries do not become runtime slots and limits are inherited', () => {
  const slots = buildSlots({ llm: { pools: [{
    id: 'pool', provider: 'openai', enabled: true, model: 'model', maxConcurrency: 3,
    retry: { maxAttempts: 4 },
    api_keys: [{ key: 'disabled', enabled: false }, { key: 'active', enabled: true, maxConcurrency: 2 }],
  }] } })
  assert.equal(slots.length, 1)
  assert.equal(slots[0].key, 'active')
  assert.equal(slots[0].maxConcurrency, 2)
  assert.equal(slots[0].retry.maxAttempts, 4)
})

test('slot lease queues work above the configured concurrency', async () => {
  const slot = { id: `lease-${Date.now()}`, maxConcurrency: 1 }
  const releaseFirst = await acquireSlotLease(slot)
  let acquired = false
  const second = acquireSlotLease(slot).then(release => { acquired = true; return release })
  await Promise.resolve()
  assert.equal(acquired, false)
  releaseFirst()
  const releaseSecond = await second
  assert.equal(acquired, true)
  releaseSecond()
})
