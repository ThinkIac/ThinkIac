import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { getCodexCliProfile, getCodexModelCatalog } from '../lib/model-catalog.js'

test('expõe o cache de modelos do Codex no contrato do seletor do Shell', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-profiles-'))
  const cache = join(root, 'default', '.codex')
  mkdirSync(cache, { recursive: true })
  writeFileSync(join(cache, 'models_cache.json'), JSON.stringify({
    models: [{ slug: 'gpt-5.6-sol', display_name: 'GPT-5.6 Sol', description: 'Código' }],
  }))

  assert.deepEqual(getCodexModelCatalog(root).accesses, [{
    id: 'gpt-5.6-sol', model: 'gpt-5.6-sol', name: 'GPT-5.6 Sol', provider: 'codex-cli',
    enabled: true, authenticated: true, available: true,
    metadata: { poolName: 'codex-cli', poolLabel: 'Codex CLI' },
    purpose: { name: 'Codex CLI', description: 'Código' },
  }])
})

test('escolhe o perfil autenticado que anunciou o modelo selecionado', () => {
  const root = mkdtempSync(join(tmpdir(), 'codex-profiles-'))
  for (const [name, model] of [['primeiro', 'gpt-5.6-terra'], ['segundo', 'gpt-5.6-sol']]) {
    const config = join(root, name, '.codex')
    mkdirSync(config, { recursive: true })
    writeFileSync(join(config, 'auth.json'), '{}')
    writeFileSync(join(config, 'models_cache.json'), JSON.stringify({ models: [{ slug: model }] }))
  }

  const profile = getCodexCliProfile(root, 'gpt-5.6-sol')
  assert.equal(profile.home, join(root, 'segundo'))
  assert.equal(profile.configDir, join(root, 'segundo', '.codex'))
})
