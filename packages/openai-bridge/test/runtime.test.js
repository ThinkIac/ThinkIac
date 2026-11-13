import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SessionStore } from '../lib/session-store.js'
import { CodexRuntime } from '../lib/runtime.js'

test('persiste histórico da sessão de forma isolada', () => {
  const store = new SessionStore(mkdtempSync(join(tmpdir(), 'codex-store-')))
  store.save({ id: 'safe/id', messages: [{ role: 'user', content: 'oi' }], workspace: null, model: 'auto' })
  assert.deepEqual(store.load('safe/id').messages, [{ role: 'user', content: 'oi' }])
  assert.equal(store.list().length, 1)
})

test('rejeita workspace fora da raiz configurada', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-root-'))
  const runtime = new CodexRuntime({ store: new SessionStore(mkdtempSync(join(tmpdir(), 'codex-store-'))), root, emit() {}, sessionsUpdated() {} })
  assert.equal(runtime.validateWorkspace(root), root)
  assert.throws(() => runtime.validateWorkspace('/tmp'), /fora do projeto/)
})

test('normaliza deltas JSONL em eventos token', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-root-'))
  const events = []
  const runtime = new CodexRuntime({ store: new SessionStore(mkdtempSync(join(tmpdir(), 'codex-store-'))), root, emit: (_, event) => events.push(event), sessionsUpdated() {} })
  runtime.active.set('s', { text: '', runId: 'run' })
  runtime.handleJson('s', { type: 'item.updated', item: { type: 'agent_message', text: 'Olá' } })
  runtime.handleJson('s', { type: 'item.updated', item: { type: 'agent_message', text: 'Olá mundo' } })
  assert.deepEqual(events.map(event => event.data.text), ['Olá', ' mundo'])
})
