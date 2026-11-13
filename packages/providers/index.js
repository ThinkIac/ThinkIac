import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { clearConfigCache, normalizeConfig, saveConfig as persistAgentConfig } from '../agent/utils/config.js'
import { PRESETS, configureOrbitGateway, isProtected, poolRef, publicPool, reconcileProviderKey, servesOrbit, toPool } from './providers.js'
import { buildSlots, getSlotStatus, resetSlot } from '../agent/llm/llm_keys.js'
import { assertSurface } from '../ui-schema/index.js'
import { requirePermission } from '../auth/authorization.js'

const AGENT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent')
const CONFIG_FILE = join(AGENT_DIR, 'agent.config.json')

function load() {
  if (!existsSync(CONFIG_FILE)) throw new Error('agent.config.json was not found.')
  const config = normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
  config.llm ??= {}
  config.llm.pools ??= []
  return config
}

function save(config) {
  persistAgentConfig(config)
  clearConfigCache()
}

function findPool(config, id) {
  return config.llm.pools.find(pool => pool.id === id || poolRef(pool) === id)
}

// A surface is data only.  The native System renderer owns the controls and
// this package remains the sole authority for the provider configuration.
const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'providers-catalog',
  eyebrow: 'Agent runtime',
  title: 'Providers',
  description: 'Manage connections, credentials and model catalogs used by the Agent.',
  forms: {
    provider: { fields: [
      { name: 'name', component: 'input' }, { name: 'provider', component: 'input' },
      { name: 'base_url', component: 'input' }, { name: 'description', component: 'textarea' },
      { name: 'api_key', component: 'input' }, { name: 'enabled', component: 'toggle' },
      { name: 'weight', component: 'input' }, { name: 'maxConcurrency', component: 'input' },
      { name: 'model', component: 'input' }, { name: 'retryJson', component: 'textarea' },
      { name: 'slotsJson', component: 'textarea' }, { name: 'modelsJson', component: 'textarea' },
    ] },
  },
  actions: {
    'providers.create': { intent: 'write' }, 'providers.update': { intent: 'write' },
    'providers.import-key': { intent: 'write' }, 'providers.toggle': { intent: 'write' },
    'providers.reactivate-slot': { intent: 'write' }, 'providers.update-gateway': { intent: 'write' },
    'providers.remove': { intent: 'destructive' },
  },
})

function systemState(req) {
  const result = listProviders(req)
  if (result.status >= 400) throw new Error(result.data?.error || 'Could not load providers.')
  return result.data
}

function actionResult(result, notice, req) {
  if (result?.status >= 400) return { status: result.status, mensagem: result.data?.error || 'Provider action failed.' }
  return { status: 200, state: systemState(req), notice }
}

export async function systemView(req) {
  /** @register_router system/view
   * @method GET */
  requirePermission(req, 'providers.catalog.read')
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: systemState(req) }
}

export async function systemAction(req) {
  /** @register_router system/action
   * @method POST */
  const action = String(req.body?.action || '')
  const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}
  if (action === 'providers.create') return actionResult(createProvider({ ...req, body: values }), 'Provider created.', req)
  if (action === 'providers.import-key') return actionResult(importProviderKey({ ...req, body: { key: values.key } }), 'Provider key loaded.', req)
  if (action === 'providers.update-gateway') return actionResult(updateOrbitGateway({ ...req, body: { providers: values.providers } }), 'Orbit gateway updated.', req)
  if (action === 'providers.update') return actionResult(updateProvider({ ...req, params: { ...req.params, id: values.id }, body: values.provider }), 'Provider updated.', req)
  if (action === 'providers.toggle') return actionResult(toggleProvider({ ...req, params: { ...req.params, id: values.id }, body: { enabled: values.enabled } }), 'Provider availability updated.', req)
  if (action === 'providers.reactivate-slot') return actionResult(reactivateSlot({ ...req, params: { ...req.params, id: values.id }, body: { pool: values.pool } }), 'Credential slot reactivated.', req)
  if (action === 'providers.remove') return actionResult(removeProvider({ ...req, params: { ...req.params, id: values.id } }), 'Provider removed.', req)
  return { status: 404, mensagem: 'Ação de System não permitida.' }
}

export function listProviders(req) {
  /**
   * @register_router config
   * @method GET
   * @description Lists all providers without exposing API keys.
   */
  requirePermission(req, 'providers.catalog.read')
  try {
    const config = load()
    const pools = config.llm.pools.map(pool => ({ ...publicPool(pool), serves_orbit: servesOrbit(pool) }))
    return { data: { presets: PRESETS, pools, strategy: config.llm.strategy ?? 'fallback', slots: getSlotStatus(buildSlots(config)) } }
  } catch (error) { return { status: 500, data: { error: error.message } } }
}

export function updateOrbitGateway(req) {
  /**
   * @register_router config/gateway
   * @method PUT
   * @description Selects provider pools that may serve Orbit and their routing priority. Body: { providers: [{ id, enabled, priority }] }.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    configureOrbitGateway(config.llm.pools, req?.body?.providers)
    save(config)
    return { data: { success: true, pools: config.llm.pools.map(pool => ({ ...publicPool(pool), serves_orbit: servesOrbit(pool) })) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function createProvider(req) {
  /**
   * @register_router config
   * @method POST
   * @description Creates a provider from a preset or OpenAI-compatible API. Body: { preset, name, provider, base_url, api_key, model, models, description, enabled, weight }.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    const pool = toPool(req?.body ?? {}, config.llm.pools)
    if (findPool(config, pool.id)) return { status: 409, data: { error: 'A provider with this ID already exists.' } }
    config.llm.pools.push(pool)
    save(config)
    return { data: { success: true, pool: publicPool(pool) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function importProviderKey(req) {
  /**
   * @register_router config/import-key
   * @method POST
   * @description Identifies and configures a managed provider using only its API key. Body: { key }.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    const { pool, created } = reconcileProviderKey(config.llm.pools, req?.body?.key)
    save(config)
    return { data: { success: true, created, pool: publicPool(pool) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function updateProvider(req) {
  /**
   * @register_router config/:id
   * @method PUT
   * @description Updates a provider's title, description, endpoint, key, catalog, purpose and weight.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    const id = req?.params?.id
    const current = findPool(config, id)
    if (!current) return { status: 404, data: { error: 'Provider not found.' } }
    const body = { ...current, ...(req?.body ?? {}), id: current.id, api_key: req?.body?.api_key ?? '' }
    const updated = toPool(body, config.llm.pools, current)
    Object.assign(current, updated)
    save(config)
    return { data: { success: true, pool: publicPool(current) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function toggleProvider(req) {
  /**
   * @register_router config/:id/toggle
   * @method POST
   * @description Enables or disables a provider, including the managed ThinkIac provider.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    const pool = findPool(config, req?.params?.id)
    if (!pool) return { status: 404, data: { error: 'Provider not found.' } }
    if (typeof req?.body?.enabled !== 'boolean') return { status: 400, data: { error: 'enabled must be a boolean.' } }
    pool.enabled = req.body.enabled
    save(config)
    return { data: { success: true, pool: publicPool(pool) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function removeProvider(req) {
  /**
   * @register_router config/:id
   * @method DELETE
   * @description Removes an unmanaged provider. The default ThinkIac provider can only be disabled.
   */
  requirePermission(req, 'providers.catalog.manage')
  try {
    const config = load()
    const index = config.llm.pools.findIndex(pool => poolRef(pool) === req?.params?.id)
    if (index < 0) return { status: 404, data: { error: 'Provider not found.' } }
    if (isProtected(config.llm.pools[index])) return { status: 403, data: { error: 'The default ThinkIac provider cannot be removed; it can only be disabled.' } }
    const [removed] = config.llm.pools.splice(index, 1)
    save(config)
    return { data: { success: true, removed: poolRef(removed) } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}

export function reactivateSlot(req) {
  /**
   * @register_router slots/:id/reactivate
   * @method POST
   * @description Clears failures and invalidation for one provider slot.
   */
  requirePermission(req, 'providers.catalog.write')
  try {
    const config = load()
    const result = resetSlot(buildSlots(config, { onlyPool: req?.body?.pool ?? null }), req?.params?.id)
    return result.success ? { data: result } : { status: 404, data: { error: result.error } }
  } catch (error) { return { status: 400, data: { error: error.message } } }
}
