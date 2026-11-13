import assert from 'node:assert/strict'
import test from 'node:test'

import { buildInputTrace, measureInputSegments } from './input_trace.js'
import { ContextCompiler } from './context_compiler.js'

test('compilation explains dropped context and overflow without persisting payloads', () => {
  const result = new ContextCompiler({ maxTokens: 1, now: () => 100 }).compile([
    { id: 'identity', source: 'base', content: 'required instructions', required: true },
    { id: 'expired', source: 'runtime', content: 'private old context', expiresAt: 99 },
    { id: 'optional', source: 'memory', content: 'private memory' },
  ])
  const trace = buildInputTrace(result)
  assert.deepEqual(trace.dropped, [
    { id: 'expired', source: 'runtime', reason: 'expired' },
    { id: 'optional', source: 'memory', reason: 'budget' },
  ])
  assert.equal(trace.diagnostics[0].code, 'REQUIRED_CONTEXT_EXCEEDS_BUDGET')
  assert.ok(!JSON.stringify(trace).includes('private'))
  assert.ok(!JSON.stringify(trace).includes('required instructions'))
})

test('measures system, conversation, tool results and schemas independently', () => {
  const measured = measureInputSegments({
    system: 'system',
    messages: [{ role: 'user', content: 'hello' }, { role: 'tool', content: 'result' }],
    tools: [{ name: 'lookup', input_schema: { type: 'object' } }],
  })
  assert.ok(measured.system > 0)
  assert.ok(measured.history > 0)
  assert.ok(measured.toolResults > 0)
  assert.ok(measured.toolSchemas > 0)
  assert.equal(measured.total, measured.system + measured.history + measured.toolResults + measured.toolSchemas)
})

test('records a compact, content-free provenance manifest', () => {
  const trace = buildInputTrace({
    provider: 'openrouter',
    model: 'openai/gpt-4o-mini',
    approximationLevel: 'detailed',
    sources: [{
      type: 'agent_md', name: 'Engineer', path: 'packages/engineer/AGENT.md',
      activation: 'pinned', hash: 'sha256:abc', content: 'x'.repeat(20),
    }],
  }, new Date('2026-07-31T03:00:00.000Z'))

  assert.deepEqual(trace, {
    version: 1,
    capturedAt: '2026-07-31T03:00:00.000Z',
    provider: 'openrouter', model: 'openai/gpt-4o-mini', approximationLevel: 'detailed',
    sources: [{
      type: 'agent_md', name: 'Engineer', path: 'packages/engineer/AGENT.md',
      activation: 'pinned', hash: 'sha256:abc', estimatedTokens: 5,
    }],
  })
  assert.equal(JSON.stringify(trace).includes('xxxxxxxx'), false)
})
