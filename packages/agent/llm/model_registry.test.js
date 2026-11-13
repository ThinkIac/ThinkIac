import test from 'node:test'
import assert from 'node:assert/strict'
import { applyCodexCliDiscovery } from './model_registry.js'

test('incorpora modelos anunciados pela CLI ao pool Codex do Agent', () => {
  const config = {
    llm: { pools: [{
      name: 'codex-engineer', provider: 'codex-cli', model: 'gpt-5.6-terra',
      models: [{ id: 'gpt-5.6-terra', name: 'Terra curado' }],
    }] },
  }
  const result = applyCodexCliDiscovery(config, [
    { id: 'gpt-5.6-terra', name: 'Terra do cache' },
    { id: 'gpt-5.6-sol', name: 'Sol do cache', purpose: { name: 'Codex CLI', description: 'Código' } },
  ])

  assert.deepEqual(result.llm.pools[0].models.map(model => model.id), ['gpt-5.6-terra', 'gpt-5.6-sol'])
  assert.equal(result.llm.pools[0].models[0].name, 'Terra curado')
  assert.equal(config.llm.pools[0].models.length, 1)
})
