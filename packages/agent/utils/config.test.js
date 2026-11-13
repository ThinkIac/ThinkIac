import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { normalizeConfig, createConfigStore } from './config_store.js'
import { buildSlots } from '../llm/llm_keys.js'
const cfg = enabled => ({ extra: { retained: true }, llm: { pools: [{ id: 'test', provider: 'openrouter', api_key: 'test-key', enabled }] } })
test('normalizes legacy booleans without mutating input or exposing secrets', () => {
  const warnings = []
  const input = cfg('false')
  assert.equal(normalizeConfig(input, m => warnings.push(m)).llm.pools[0].enabled, false)
  assert.equal(input.llm.pools[0].enabled, 'false')
  assert.equal(normalizeConfig(cfg('true'), () => {}).llm.pools[0].enabled, true)
  assert.equal(warnings.length, 1)
  assert.ok(!warnings[0].includes('test-key'))
  assert.deepEqual(normalizeConfig(input, () => {}).extra, input.extra)
})
test('rejects invalid enabled values with field path', () => {
  for (const value of [null, 0, 1, {}, [], 'yes', '']) {
    assert.throws(() => normalizeConfig(cfg(value)), /llm\.pools\[0\]\.enabled/)
  }
  const missing = cfg(false); delete missing.llm.pools[0].enabled
  assert.equal(normalizeConfig(missing).llm.pools[0].enabled, undefined)
})
test('direct slot selection validates booleans and preserves onlyPool', () => {
  for (const value of [false, 'false']) assert.equal(buildSlots(cfg(value)).length, 0)
  for (const value of [true, 'true']) assert.equal(buildSlots(cfg(value)).length, 1)
  assert.equal(buildSlots(cfg(false), { onlyPool: 'test' }).length, 1)
  assert.throws(() => buildSlots(cfg('bad')), /enabled/)
})
test('reload and failed writes preserve last valid config and disk', () => {
  const dir = mkdtempSync(join(tmpdir(), 'agent-config-'))
  const file = join(dir, 'config.json')
  const errors = []
  const store = createConfigStore(file, { warn: m => errors.push(m) })
  try {
    writeFileSync(file, '{broken')
    assert.throws(() => store.get())
    writeFileSync(file, JSON.stringify(cfg('false')))
    assert.equal(store.get().llm.pools[0].enabled, false)
    assert.equal(JSON.parse(readFileSync(file)).llm.pools[0].enabled, 'false')
    writeFileSync(file, '{broken')
    store.clear()
    assert.equal(store.get().llm.pools[0].enabled, false)
    assert.ok(errors.length)
    store.save(cfg(true))
    const before = readFileSync(file, 'utf8')
    assert.throws(() => store.save(cfg(null)))
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(store.get().llm.pools[0].enabled, true)
    const mutable = store.get()
    mutable.llm.pools[0].enabled = null
    assert.throws(() => store.save(mutable))
    assert.equal(store.get().llm.pools[0].enabled, true)
    const failing = createConfigStore(file, { rename: () => { throw new Error('disk failure') } })
    failing.get()
    assert.throws(() => failing.save(cfg(false)), /disk failure/)
    assert.equal(readFileSync(file, 'utf8'), before)
    assert.equal(failing.get().llm.pools[0].enabled, true)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})
test('all configuration writers use validated persistence', () => {
  const writers = [
    '../index.js', '../llm/provider.js', '../llm/provider_app.js',
    '../routes/antigravity_accounts.js', '../routes/claude_accounts.js',
    '../routes/codex_accounts.js', '../routes/gemini_accounts.js', '../routes/opencode_accounts.js',
  ]
  for (const writer of writers) {
    const source = readFileSync(new URL(writer, import.meta.url), 'utf8')
    assert.match(source, /persistAgentConfig\((cfg|config|current)\)/, writer)
    assert.doesNotMatch(source, /writeFileSync\((CONFIG_FILE|file), JSON.stringify/, writer)
  }
})
