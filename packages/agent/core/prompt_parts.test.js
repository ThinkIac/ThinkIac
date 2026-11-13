import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { loadPromptParts } from './prompt_parts.js'
import { buildInputTrace } from './input_trace.js'

const root = fileURLToPath(new URL('../', import.meta.url))
const base = ['core/identity', 'core/communication']
const protocols = ['protocols/structured-input', 'protocols/react']
for (const [level, paths] of Object.entries({
  compact: base,
  detailed: [...base, ...protocols, 'heuristics/best-practices'],
  full: [...base, ...protocols, 'protocols/multi-step', 'capabilities/runtime', 'heuristics/best-practices'],
})) {
  test(`${level} preserves real prompt contents and order with individual provenance`, () => {
    const result = loadPromptParts({ root, level, name: 'Agent', fallback: () => assert.fail('unexpected fallback') })
    assert.equal(result.content, paths.map(path => readFileSync(`${root}/prompts/${path}.inflect`, 'utf8').replace(/\{\{name\}\}/g, 'Agent')).join('\n\n'))
    const trace = buildInputTrace({ sources: result.sources })
    assert.equal(trace.sources.length, paths.length)
    for (const source of trace.sources) {
      assert.match(source.hash, /^[a-f0-9]{64}$/)
      assert.equal(source.activation, level)
      assert.equal(source.validity, 'composition')
      assert.ok(source.purpose)
      assert.equal(source.content, undefined)
    }
  })
}

test('missing part uses only complete legacy fallback, and a new composition rereads parts', () => {
  const warnings = []
  const options = { root, level: 'compact', name: 'Agent', fallback: () => 'Hello {{name}}', logger: { warn: message => warnings.push(message) } }
  const failed = loadPromptParts({ ...options, read: () => { throw new Error('missing') } })
  assert.equal(failed.content, 'Hello Agent')
  assert.deepEqual(failed.sources.map(s => s.path), ['AGENT.md'])
  assert.equal(failed.sources[0].activation, 'fallback')
  assert.equal(warnings.length, 1)
  const first = loadPromptParts({ ...options, read: () => 'first' })
  const next = loadPromptParts({ ...options, read: () => 'next' })
  assert.notEqual(first.sources[0].hash, next.sources[0].hash)
  assert.equal(next.content, 'next\n\nnext')
})

test('unknown approximation retains full-level behavior', () => {
  const options = { root, name: 'Agent', fallback: () => '' }
  assert.deepEqual(loadPromptParts({ ...options, level: 'unknown' }), loadPromptParts({ ...options, level: 'full' }))
})

test('compact prompt requires evidence after every tool call', () => {
  const { content } = loadPromptParts({ root, level: 'compact', name: 'Agent', fallback: () => '' })
  assert.match(content, /Uma chamada de ferramenta não é conclusão/)
  assert.match(content, /leia seu retorno antes de responder/)
  assert.match(content, /não trate a\s+ação como concluída/)
})
