import test from 'node:test'
import assert from 'node:assert/strict'
import { configureOrbitGateway, isProtected, poolRef, providerForKey, publicPool, reconcileProviderKey, servesOrbit, toPool } from '../providers.js'
import { readFile } from 'node:fs/promises'

test('declares a native Providers surface exclusively as an installed System tab', async () => {
  const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.deepEqual(manifest.manifest.systemTab, {
    id: 'providers', label: 'Providers', view: 'Index', renderer: 'schema', surface: 'providers', order: 70,
  })
  assert.equal(manifest.manifest.page, undefined)
  assert.equal(manifest.manifest.menu, undefined)
})

test('exposes the complete Providers action set through the System surface', async () => {
  const source = await readFile(new URL('../index.js', import.meta.url), 'utf8')
  for (const action of ['providers.create', 'providers.update', 'providers.import-key', 'providers.toggle', 'providers.reactivate-slot', 'providers.remove']) {
    assert.match(source, new RegExp(action.replace('.', '\\.')))
  }
  assert.match(source, /@register_router system\/view/)
  assert.match(source, /@register_router system\/action/)
  assert.match(source, /requirePermission\(req, 'providers\.catalog\.read'\)/)
  assert.match(source, /requirePermission\(req, 'providers\.catalog\.write'\)/)
  assert.match(source, /requirePermission\(req, 'providers\.catalog\.manage'\)/)
})

test('loads a ThinkIac Orbit provider from only its key', () => {
  const key = `tiac.${'a'.repeat(16)}.${'b'.repeat(43)}`
  const pool = toPool(providerForKey(key), [])
  assert.equal(pool.provider, 'thinkiac')
  assert.equal(pool.id, 'thinkiac-default')
  assert.equal(pool.base_url, 'https://thinkiac.cloud/thinkiac-provider/v1')
  assert.equal(pool.model, 'orbit')
  assert.deepEqual(pool.models.map(model => model.id), ['orbit'])
  assert.equal(pool.api_keys[0].key, key)
  assert.equal(pool.enabled, true)
  assert.equal(pool.managed, true)
})

test('upgrades an auto-provisioned pool and retires the duplicate legacy alias', () => {
  const key = `tiac.${'a'.repeat(16)}.${'b'.repeat(43)}`
  const pools = [
    { id: 'thinkiac-default', name: 'ThinkIac Auto', provider: 'thinkiac', base_url: 'https://thinkiac.cloud/billing/v1', model: 'auto', models: [{ id: 'auto' }], api_keys: ['old'], enabled: true, managed: true },
    { id: 'default', name: 'ThinkIac', provider: 'thinkiac', base_url: 'https://thinkiac.cloud/billing/v1', model: 'auto', models: [{ id: 'auto' }], api_keys: ['older'], enabled: true, managed: true },
  ]

  const result = reconcileProviderKey(pools, key)

  assert.equal(result.created, false)
  assert.equal(result.pool.id, 'thinkiac-default')
  assert.equal(result.pool.base_url, 'https://thinkiac.cloud/thinkiac-provider/v1')
  assert.equal(result.pool.model, 'orbit')
  assert.deepEqual(result.pool.models.map(model => model.id), ['orbit'])
  assert.equal(result.pool.api_keys[0].key, key)
  assert.equal(pools[1].enabled, false)
  assert.equal(pools[1].model, 'orbit')
  assert.deepEqual(pools[1].models.map(model => model.id), ['orbit'])
  assert.equal(pools[1].api_keys[0].key, key)
})

test('does not guess an arbitrary provider from an unidentified key', () => {
  assert.throws(() => providerForKey('sk-unknown'), /full provider editor/i)
})

test('protects managed ThinkIac providers but not ordinary pools', () => {
  assert.equal(isProtected({ id: 'thinkiac-default', provider: 'thinkiac', managed: true }), true)
  assert.equal(isProtected({ id: 'default', provider: 'thinkiac', managed: true }), true)
  assert.equal(isProtected({ id: 'openrouter-primary', provider: 'openrouter' }), false)
})

test('creates a typed provider catalog and never exposes its API key publicly', () => {
  const pool = toPool({ name: 'OpenAI', provider: 'openai', api_key: 'sk-secret-key', model: 'gpt-4o-mini', models: [{ id: 'gpt-4o-mini', name: 'GPT-4o mini', purpose: { name: 'general', description: 'Conversas' } }], enabled: true }, [])
  assert.equal(pool.id, 'openai')
  assert.equal(pool.models[0].purpose.name, 'general')
  assert.equal(pool.enabled, true)
  assert.ok(!JSON.stringify(publicPool(pool)).includes('sk-secret-key'))
  assert.ok(!JSON.stringify(publicPool({ ...pool, api_key: 'legacy-secret' })).includes('legacy-secret'))
})

test('rejects a default model that is absent from the catalog', () => {
  assert.throws(() => toPool({ name: 'Test', provider: 'openai', model: 'missing', models: [{ id: 'present' }] }, []), /default model/i)
})

test('gives legacy pools without id a usable, non-mutating route reference', () => {
  const legacy = { name: 'Legacy provider', provider: 'openai' }
  assert.equal(poolRef(legacy), 'name:Legacy provider')
  assert.equal(publicPool(legacy).id, 'name:Legacy provider')
  assert.equal(legacy.id, undefined)
})

test('preserves model capabilities and configures retry and credential slots', () => {
  const pool = toPool({
    name: 'Resilient', provider: 'openai', model: 'model-a', enabled: true,
    retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 2000, retryableStatus: [429, 502] },
    slots: [{ key: 'secret-a', enabled: false, maxConcurrency: 4 }],
    models: [{ id: 'model-a', capabilities: { tools: { supported: true }, contextWindow: 128000 } }],
  }, [])
  assert.equal(pool.models[0].capabilities.tools.supported, true)
  assert.equal(pool.retry.maxAttempts, 3)
  assert.equal(pool.api_keys[0].enabled, false)
  assert.equal(pool.api_keys[0].maxConcurrency, 4)
  const exposed = publicPool(pool)
  assert.equal(exposed.api_keys[0].masked, 'secret-…et-a')
  assert.ok(!JSON.stringify(exposed).includes('secret-a'))
})

test('preserves provider-specific model metadata during an edit', () => {
  const pool = toPool({
    name: 'Extended', provider: 'openai', model: 'model-a',
    models: [{ id: 'model-a', customRoutingHint: { region: 'br' }, operational: { latencyMs: 450 } }],
  }, [])
  assert.deepEqual(pool.models[0].customRoutingHint, { region: 'br' })
  assert.deepEqual(pool.models[0].operational, { latencyMs: 450 })
})

test('configures the Orbit gateway without allowing a recursive ThinkIac route', () => {
  const pools = [
    { id: 'thinkiac-default', provider: 'thinkiac' },
    { id: 'http', provider: 'openai' },
    { id: 'codex', provider: 'codex-cli' },
  ]
  assert.equal(servesOrbit(pools[1]), true)
  assert.equal(servesOrbit(pools[2]), false)
  configureOrbitGateway(pools, [{ id: 'http', enabled: false, priority: 4 }, { id: 'codex', enabled: true, priority: 100 }])
  assert.equal(servesOrbit(pools[1]), false)
  assert.equal(servesOrbit(pools[2]), true)
  assert.equal(pools[2].remote_api_priority, 100)
  assert.throws(() => configureOrbitGateway(pools, [{ id: 'thinkiac-default', enabled: true, priority: 0 }]), /recursively/i)
})
