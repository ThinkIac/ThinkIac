import test from 'node:test'
import assert from 'node:assert/strict'
import { buildChatRequest, bagContextLimit } from './chat_request.js'

test('streaming and nonstreaming preserve identical tools, history and policy', () => {
  const args = { model: 'm', system: 's', messages: [{ role: 'user', content: 'q' }],
    tools: [{ name: 'read', description: 'Read', input_schema: { type: 'object' } }],
    maxTokens: 100, temperature: 0, slot: { id: 'account', url: 'https://openrouter.ai/api/v1/chat/completions' },
    sessionId: 'private-session', openrouter: { session_affinity: true, provider: { require_parameters: true, only: ['allowed'], allow_fallbacks: false } },
  }
  const normal = buildChatRequest(args)
  const stream = buildChatRequest({ ...args, stream: true })
  assert.deepEqual(stream, { ...normal, stream: true })
  assert.equal(normal.temperature, 0)
  assert.equal(normal.provider.allow_fallbacks, false)
  assert.match(normal.session_id, /^[a-f0-9]{64}$/)
  assert.ok(!normal.session_id.includes('private-session'))
  assert.notEqual(normal.session_id, buildChatRequest({ ...args, slot: { ...args.slot, id: 'other' } }).session_id)
})

test('other providers never receive OpenRouter-specific parameters', () => {
  const result = buildChatRequest({ model: 'm', system: 's', messages: [], slot: { url: 'https://example.com' }, sessionId: 's', openrouter: { session_affinity: true, provider: { only: ['x'] } } })
  assert.equal(result.provider, undefined)
  assert.equal(result.session_id, undefined)
  assert.equal(result.stream, undefined)
})

test('budget includes history, tools and output in both paths; fallback never inherits another model window', () => {
  const args = { model: 'm', system: 'instructions', messages: [{ role: 'user', content: 'hello' }], contextLimit: 4096 }
  assert.ok(buildChatRequest(args).max_tokens > 0)
  for (const stream of [true, false]) {
    assert.throws(() => buildChatRequest({ ...args, stream, messages: [{ role: 'user', content: '字'.repeat(2000) }] }), /EXCEEDS_BUDGET/)
    assert.throws(() => buildChatRequest({ ...args, stream, tools: [{ name: 'big', input_schema: { description: 'x'.repeat(5000) } }] }), /EXCEEDS_BUDGET/)
  }
  const config = { bag: { enforce_budget: true } }
  const selected = { model: 'm', metadata: { poolName: 'pool' }, capabilities: { contextWindow: 4096 } }
  assert.equal(bagContextLimit(config, { poolName: 'pool' }, 'm', selected), 4096)
  assert.throws(() => bagContextLimit(config, { poolName: 'fallback' }, 'other', selected), /LIMIT_UNKNOWN/)
  assert.equal(bagContextLimit({}, {}, 'm', selected), null)
})
