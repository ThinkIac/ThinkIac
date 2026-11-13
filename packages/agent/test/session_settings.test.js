import test from 'node:test'
import assert from 'node:assert/strict'
import { DEFAULT_CONFIRMATION_MESSAGE, getSessionSettings, saveSessionSettings } from '../core/session_settings.js'

const config = { llm: { pools: [{ name: 'primary', provider: 'openai', model: 'gpt-test', enabled: true }] } }

function fakeIO(initial = config) {
  const state = { config: structuredClone(initial), saves: 0 }
  return { state, deps: { load: () => state.config, save: (next) => { state.config = next; state.saves++ } } }
}

test('confirmation defaults to the fixed English message', () => {
  const settings = getSessionSettings(config)
  assert.equal(settings.confirmation.fixedMessage, DEFAULT_CONFIRMATION_MESSAGE)
  assert.equal(settings.confirmation.generateWithAI, false)
})

test('AI confirmation requires and persists a configured model', () => {
  const io = fakeIO()
  const saved = saveSessionSettings({ confirmationGenerateWithAI: true, confirmationModel: 'gpt-test' }, io.deps)
  assert.equal(io.state.config.sessions.confirmation.generateWithAI, true)
  assert.equal(io.state.config.sessions.confirmation.model, 'gpt-test')
  assert.equal(saved.confirmation.model, 'gpt-test')
})

test('AI confirmation rejects an empty model', () => {
  const io = fakeIO()
  assert.throws(() => saveSessionSettings({ confirmationGenerateWithAI: true, confirmationModel: null }, io.deps), /Escolha um modelo/)
  assert.equal(io.state.saves, 0)
})
