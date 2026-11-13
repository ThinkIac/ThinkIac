import test from 'node:test'
import assert from 'node:assert/strict'
import { readEvidence, captureToolResult } from './bag_evidence.js'
import { BagStore } from './bag_store.js'

const scope = { tenantId: 't', workspaceId: 'w', taskId: 'task' }
const outcome = content => ({ ok: true, value: { success: true, absolute: '/workspace/a.js', content } })

test('structured outputs preserve evidence and explicitly report truncation', () => {
  assert.equal(JSON.parse(captureToolResult({ content: 'ação' }).result).content, 'ação')
  assert.equal(captureToolResult('abcdef', 3).coverage, 'partial')
  assert.equal(captureToolResult(undefined).coverage, 'unknown')
  const cyclic = {}; cyclic.self = cyclic
  assert.equal(captureToolResult(cyclic).coverage, 'unknown')
})

test('read hashes represent returned text and reject ambiguous or failed reads', () => {
  const first = readEvidence('read_file', outcome('ação'))
  assert.equal(first.bytes, 6)
  assert.equal(first.freshness, 'historical')
  assert.notEqual(first.hash, readEvidence('read_file', outcome('novo')).hash)
  assert.equal(readEvidence('run_shell', outcome('ação')), null)
  assert.equal(readEvidence('read_file', { ...outcome('ação'), ok: false }), null)
  assert.equal(readEvidence('read_file', { ok: true, value: { success: true, content: 'a', path: 'a.js' } }), null)
})

test('resource projection updates atomically, isolates tasks and is deleted with evidence', () => {
  const store = new BagStore(':memory:')
  try {
    const append = (key, text, extra = {}) => store.append(scope, {
      key, type: 'tool_result', payload: { callId: key, resource: readEvidence('read_file', outcome(text)) }, ...extra,
    })
    append('one', 'old')
    assert.equal(store.resources(scope)[0].revision, 1)
    assert.equal(append('two', 'new', { expectedRevision: 0 }).status, 'conflict')
    assert.equal(store.resources(scope)[0].revision, 1)
    append('two', 'new')
    assert.equal(store.resources(scope).length, 1)
    assert.equal(store.resources(scope)[0].hash, readEvidence('read_file', outcome('new')).hash)
    assert.deepEqual(store.resources({ ...scope, taskId: 'other' }), [])
    store.remove(scope)
    assert.deepEqual(store.resources(scope), [])
    assert.throws(() => append('three', 'deleted'), /BAG_DELETED/)
  } finally { store.close() }
})
