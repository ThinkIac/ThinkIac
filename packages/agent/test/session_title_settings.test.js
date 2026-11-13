import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildModelOptions,
  getTitleSettings,
  saveTitleSettings,
} from '../core/session_title_settings.js'

const CFG = {
  llm: {
    pools: [
      { name: 'openrouter', provider: 'openrouter', model: 'vendor/fast', enabled: true },
      { name: 'openai', provider: 'openai', model: 'gpt-4o', enabled: true },
    ],
  },
}

function fakeIO(initial) {
  const state = { config: structuredClone(initial), saves: 0 }
  return {
    state,
    deps: {
      load: () => state.config,
      save: config => { state.config = config; state.saves++ },
    },
  }
}

test('opções vêm dos modelos e ELMs configurados', () => {
  const ids = buildModelOptions(CFG).map(option => option.id)
  assert.ok(ids.includes('vendor/fast'))
  assert.ok(ids.includes('ada-thin'))
})

test('opções incluem todo o catálogo declarado pela pool', () => {
  const config = {
    llm: { pools: [{
      name: 'codex-engineer', provider: 'codex-cli', model: 'gpt-5.6-terra', enabled: true,
      models: [{ id: 'gpt-5.6-terra' }, { id: 'gpt-5.6-sol' }, 'gpt-6-astra'],
    }] },
  }
  assert.deepEqual(buildModelOptions(config).filter(option => option.provider === 'codex-cli').map(option => option.id), [
    'gpt-5.6-terra', 'gpt-5.6-sol', 'gpt-6-astra',
  ])
})

test('modelo de título vive em sessions.title.model', () => {
  const io = fakeIO(CFG)
  const saved = saveTitleSettings({ model: 'gpt-4o', enabled: false, every: 12 }, io.deps)
  assert.equal(io.state.config.sessions.title.model, 'gpt-4o')
  assert.equal(io.state.config.sessions.title.enabled, false)
  assert.equal(saved.model, 'gpt-4o')
})

test('auto remove override sem criar mapa legado', () => {
  const io = fakeIO({ ...CFG, sessions: { title: { model: 'gpt-4o' } } })
  saveTitleSettings({ model: null }, io.deps)
  assert.equal(getTitleSettings(io.state.config).model, null)
  assert.equal('model' in io.state.config.sessions.title, false)
})

test('modelo desconhecido é recusado', () => {
  const io = fakeIO(CFG)
  assert.throws(() => saveTitleSettings({ model: 'inexistente' }, io.deps), /não está nas pools/)
  assert.equal(io.state.saves, 0)
})
