import test from 'node:test'
import assert from 'node:assert/strict'
import { capabilitiesFromModel, replaceModelCapabilities } from './capabilities.js'

test('metadata do OpenRouter declara suporte a tools por modelo', () => {
  assert.deepEqual(capabilitiesFromModel({ supported_parameters: ['tools', 'temperature'] }), {
    tools: { supported: true },
  })
  assert.deepEqual(capabilitiesFromModel({ supported_parameters: ['temperature'] }), {
    tools: { supported: false },
  })
})

test('troca de modelo invalida capacidades antigas antes de nova descoberta', () => {
  const pool = {
    model: 'vendor/old',
    capabilities: { tools: { supported: true }, contextWindow: 128000 },
    capabilities_model: 'vendor/old',
  }
  replaceModelCapabilities(pool, 'vendor/new', null)
  assert.equal(pool.model, 'vendor/new')
  assert.deepEqual(pool.models, [{ id: 'vendor/new' }])
  assert.equal(pool.capabilities, undefined)
  assert.equal(pool.capabilities_model, undefined)
})

test('capacidade descoberta fica vinculada ao modelo correspondente', () => {
  const pool = { model: 'vendor/old', capabilities: { tools: { supported: false } } }
  replaceModelCapabilities(pool, 'vendor/tool-model', { tools: { supported: true } })
  assert.deepEqual(pool.models, [{ id: 'vendor/tool-model', capabilities: { tools: { supported: true } } }])
  assert.equal(pool.capabilities, undefined)
  assert.equal(pool.capabilities_model, undefined)
})
