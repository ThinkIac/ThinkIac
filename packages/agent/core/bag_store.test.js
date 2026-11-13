import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { BagStore, sanitizeBagValue } from './bag_store.js'
import { loadBagForPrompt } from './bag_legacy.js'

const scope = { tenantId: 'a', workspaceId: 'w', taskId: 't' }
const event = { key: '1', type: 'request', payload: { message: 'Fix the parser' } }
function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'bag-test-'))
  const filename = join(dir, 'bag.sqlite')
  const store = new BagStore(filename)
  t.after(() => { if (store.db.open) store.close(); rmSync(dir, { recursive: true, force: true }) })
  return { store, filename }
}

test('commit survives reopen; replay is idempotent and conflicting replay is rejected', t => {
  const { store, filename } = fixture(t)
  assert.equal(store.append(scope, event).committed, true)
  store.close()
  const reopened = new BagStore(filename)
  try {
    assert.equal(reopened.get(scope).revision, 1)
    assert.equal(reopened.append(scope, event).reused, true)
    assert.equal(reopened.append(scope, { ...event, payload: {} }).status, 'conflict')
    assert.equal(reopened.get(scope).state.request.message, 'Fix the parser')
  } finally { reopened.close() }
})

test('revision conflicts and tenant isolation', t => {
  const { store } = fixture(t)
  store.append(scope, event)
  assert.equal(store.append(scope, { ...event, key: '2', expectedRevision: 0 }).status, 'conflict')
  assert.equal(store.get({ ...scope, tenantId: 'b' }).status, 'empty')
  assert.equal(store.retrieve({ ...scope, taskId: 'other' }).items.length, 0)
  assert.throws(() => store.get({ taskId: 't' }), /SCOPE_REQUIRED/)
})

test('provider bindings are isolated by task, account and workspace and are deleted with the bag', t => {
  const { store } = fixture(t)
  const destination = { account: 'account-a', cwd: '/workspace' }
  store.setBinding(scope, destination, { threadId: 'thread', status: 'unknown' })
  assert.equal(store.getBinding(scope, destination).status, 'unknown')
  assert.equal(store.getBinding(scope, { ...destination, account: 'account-b' }), null)
  assert.equal(store.getBinding({ ...scope, taskId: 'other' }, destination), null)
  store.remove(scope)
  assert.equal(store.getBinding(scope, destination), null)
  assert.throws(() => store.setBinding(scope, destination, {}), /BAG_DELETED/)
})

test('native binding claim excludes another writer until the turn is reconciled', t => {
  const { store, filename } = fixture(t)
  const other = new BagStore(filename)
  try {
    assert.equal(store.claimBinding(scope, { account: 'a' }), null)
    assert.throws(() => other.claimBinding(scope, { account: 'a' }), /TURN_UNKNOWN/)
    store.setBinding(scope, { account: 'a' }, { threadId: 'native', status: 'completed' })
    assert.equal(other.claimBinding(scope, { account: 'a' }).threadId, 'native')
  } finally { other.close() }
})

test('transaction rolls back event and projection when persistence fails', t => {
  const { store } = fixture(t)
  store.db.exec("CREATE TRIGGER fail_projection BEFORE INSERT ON bag_state BEGIN SELECT RAISE(ABORT, 'disk failure'); END")
  assert.throws(() => store.append(scope, event), /disk failure/)
  assert.equal(store.get(scope).revision, 0)
  assert.equal(store.retrieve(scope).items.length, 0)
})

test('interrupted tool remains unknown until a result commits', t => {
  const { store } = fixture(t)
  store.append(scope, { key: 'start', type: 'tool_started', payload: { callId: 'c', tool: 'send' } })
  assert.equal(store.get(scope).state.pending.c.status, 'unknown')
  store.append(scope, { key: 'end', type: 'tool_result', payload: { callId: 'c', ok: false } })
  assert.deepEqual(store.get(scope).state.pending, {})
  assert.equal(store.get(scope).state.lastResult.ok, false)
})

test('retrieval is bounded and includes older matching evidence; deletion blocks replay', t => {
  const { store } = fixture(t)
  store.append(scope, event)
  for (let i = 2; i < 50; i++) store.append(scope, { key: String(i), type: 'checkpoint', payload: { text: 'unrelated' } })
  const result = store.retrieve(scope, { query: 'parser', maxTokens: 150 })
  assert.equal(result.items[0].revision, 1)
  assert.ok(result.usedTokens <= 150)
  assert.equal(result.coverage, 'partial')
  assert.equal(store.retrieve(scope, { maxTokens: 0 }).items.length, 0)
  store.remove(scope)
  assert.equal(store.get(scope).status, 'empty')
  assert.throws(() => store.append(scope, event), /BAG_DELETED/)
})

test('sanitization excludes credentials and private reasoning', () => {
  const value = sanitizeBagValue({ apiKey: 'secret-value', reasoning: 'private', nested: { password: 'p' }, text: 'Bearer abc sk-example senha: sensitive' })
  assert.ok(!JSON.stringify(value).includes('secret-value'))
  assert.ok(!JSON.stringify(value).includes('private'))
  assert.ok(!JSON.stringify(value).includes('sensitive'))
})

test('legacy notes are visible without a plan and failure is explicit', async () => {
  const proxy = () => ({ plan: { findOne: () => null }, step: { query: () => [] }, note: { query: () => [{ type: 'note', content: 'Parser checked' }] } })
  assert.match(await loadBagForPrompt(proxy, 's'), /Parser checked/)
  assert.match(await loadBagForPrompt(() => { throw new Error('offline') }, 's'), /indisponível/)
})
