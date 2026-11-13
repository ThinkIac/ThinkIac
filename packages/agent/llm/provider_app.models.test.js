import test from 'node:test'
import assert from 'node:assert/strict'
import { makeProviderApp, synchronizePoolModels } from './provider_app.js'

test('migra capacidades legadas para a entrada do modelo padrão', () => {
  const pool = { model: 'vendor/old', capabilities: { tools: { supported: true } }, capabilities_model: 'vendor/old' }
  synchronizePoolModels(pool, ['vendor/old', 'vendor/new'], 'vendor/new')
  assert.equal(pool.model, 'vendor/new')
  assert.deepEqual(pool.models, [
    { id: 'vendor/old', capabilities: { tools: { supported: true } } },
    { id: 'vendor/new' },
  ])
  assert.equal(pool.capabilities, undefined)
})

test('preserva capacidades por modelo e nunca aceita metadados enviados pelo cliente', () => {
  const pool = { model: 'vendor/a', models: [{ id: 'vendor/a', capabilities: { tools: { supported: true } } }] }
  synchronizePoolModels(pool, [{ id: 'vendor/a', capabilities: { tools: { supported: false } } }, 'vendor/b'], 'vendor/b')
  assert.deepEqual(pool.models, [
    { id: 'vendor/a', capabilities: { tools: { supported: true } } },
    { id: 'vendor/b' },
  ])
})

test('mantém o padrão dentro do catálogo após remover o modelo anterior', () => {
  const pool = { model: 'vendor/a', models: [{ id: 'vendor/a' }, { id: 'vendor/b' }] }
  synchronizePoolModels(pool, ['vendor/b'])
  assert.equal(pool.model, 'vendor/b')
  assert.deepEqual(pool.models, [{ id: 'vendor/b' }])
})

test('poolId seleciona somente o slot canônico, mesmo com outro pool do mesmo provider', () => {
  const app = makeProviderApp({
    poolName: 'openrouter',
    poolId: 'openrouter-primary',
    provider: 'openrouter',
    defaultModel: 'vendor/default',
    apiRoot: 'https://example.test/v1',
  })
  const canonical = { id: 'openrouter-primary', provider: 'openrouter', models: [{ id: 'vendor/catalog' }] }
  const other = { name: 'opencode-api', provider: 'openrouter', models: [{ id: 'vendor/other' }] }
  assert.equal(app.findPool({ llm: { pools: [other, canonical] } }), canonical)
})
