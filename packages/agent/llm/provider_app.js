import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'
















import { readFileSync, existsSync } from 'fs'
import { join, dirname }                           from 'path'
import { fileURLToPath }                            from 'url'


const __dirname   = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR  = join(__dirname, '..')
const CONFIG_FILE = join(AGENT_DIR, 'agent.config.json')

function loadConfig() {
  if (!existsSync(CONFIG_FILE)) throw new Error('agent.config.json não encontrado')
  return normalizeConfig(JSON.parse(readFileSync(CONFIG_FILE, 'utf8')))
}

function saveConfig(cfg) {
  if (cfg.llm) cfg.llm.keys_updated_at = new Date().toISOString()
  persistAgentConfig(cfg)
}

async function clearAgentCache() {
  try {
    const mod = await import('../utils/config.js')
    mod.clearConfigCache?.()
  } catch (err) {
    console.warn(`[provider_app] não consegui invalidar o cache do agent: ${err.message}`)
  }
}

/** Chave "crua" do slot — normaliza string vs { key } em api_keys[0]. */
function poolKey(pool) {
  const entry = pool?.api_keys?.[0]
  if (!entry) return null
  if (typeof entry === 'string') return entry
  if (entry && typeof entry === 'object' && typeof entry.key === 'string') return entry.key
  return null
}

function maskKey(key) {
  if (!key) return null
  if (key.length <= 12) return `${key.slice(0, 3)}…`
  return `${key.slice(0, 8)}…${key.slice(-4)}`
}

function modelId(value) {
  const id = typeof value === 'string' ? value : value?.id
  return String(id ?? '').trim()
}

/**
 * Normaliza o catálogo de modelos de um pool sem aceitar metadados do cliente.
 * Entradas existentes (e portanto suas capacidades por modelo) são preservadas.
 */
export function synchronizePoolModels(pool, requestedModels, requestedDefault = null) {
  const current = Array.isArray(pool?.models) ? pool.models : []
  const legacyId = modelId(pool?.model)
  const existing = new Map()

  for (const item of current) {
    const id = modelId(item)
    if (id && !existing.has(id)) existing.set(id, typeof item === 'object' ? { ...item, id } : { id })
  }

  
  
  if (legacyId && (pool?.capabilities || pool?.capabilities_model)) {
    const legacyEntry = existing.get(legacyId) ?? { id: legacyId }
    if (!legacyEntry.capabilities && pool.capabilities) legacyEntry.capabilities = pool.capabilities
    existing.set(legacyId, legacyEntry)
  }

  const source = Array.isArray(requestedModels) ? requestedModels : [...existing.keys()]
  const ids = []
  for (const item of source) {
    const id = modelId(item)
    if (id && !ids.includes(id)) ids.push(id)
  }
  if (!ids.length && legacyId) ids.push(legacyId)

  pool.models = ids.map(id => existing.get(id) ?? { id })
  const desiredDefault = modelId(requestedDefault)
  pool.model = ids.includes(desiredDefault) ? desiredDefault
    : ids.includes(legacyId) ? legacyId
      : ids[0] ?? null
  delete pool.capabilities
  delete pool.capabilities_model
  return pool
}

/**
 * @param {object}   opts
 * @param {string}   opts.poolName      nome do pool no config
 * @param {string}   [opts.poolId]      id canônico do pool; quando definido, evita adotar outro pool do mesmo provider
 * @param {string}   opts.provider      provider da engine (openrouter|openai|anthropic|ollama…)
 * @param {string}   opts.defaultModel  modelo default do slot
 * @param {string}   opts.apiRoot       raiz da API (default; pode ser sobrescrita por base_url)
 * @param {RegExp}   [opts.keyRegex]    validação do formato da chave (ignorado se keyless)
 * @param {boolean}  [opts.keyless]     provider sem chave (ollama) — save exige só base_url/model
 * @param {'openai'|'anthropic'} [opts.testStyle]  formato do turno de teste
 * @param {object}   [opts.testHeaders] headers extras no teste (ex.: OpenRouter Referer/Title)
 * @param {Function} [opts.resolveCapabilities] descobre capacidades específicas do modelo
 * @param {string}   [opts.comment]     _comment do slot semeado no boot
 */
export function makeProviderApp(opts) {
  const {
    poolName, poolId = null, provider, defaultModel, apiRoot,
    keyRegex   = null,
    keyless    = false,
    testStyle  = 'openai',
    testHeaders = {},
    resolveCapabilities = null,
    
    
    chatPath   = '/chat/completions',
    comment    = '',
  } = opts

  function findPool(cfg) {
    const pools = cfg.llm?.pools ?? []
    
    
    if (poolId) return pools.find(p => p.id === poolId) ?? null
    
    return pools.find(p => p.name === poolName || p.provider === provider) ?? null
  }

  function emptyPool() {
    const pool = {
      ...(poolId ? { id: poolId } : {}),
      name:     poolName,
      provider,
      model:    defaultModel,
      models:   [{ id: defaultModel }],
      weight:   1,
      enabled:  false,
      _comment: comment,
    }
    if (!keyless) pool.api_keys = []
    return pool
  }

  function buildStatus(pool) {
    const key = poolKey(pool)
    return {
      present:    !!pool,
      enabled:    !!pool?.enabled,
      keyless,
      configured: keyless ? !!pool : !!key,
      keyPreview: maskKey(key),
      model:      pool?.model || defaultModel,
      models:     Array.isArray(pool?.models) && pool.models.length
        ? pool.models.map(item => typeof item === 'string' ? { id: item } : item).filter(item => item?.id)
        : [{ id: pool?.model || defaultModel }],
      base_url:   pool?.base_url || apiRoot,
      weight:     pool?.weight ?? 1,
      capabilities: pool?.capabilities ?? null,
      capabilities_model: pool?.capabilities_model ?? null,
    }
  }

  async function refreshCapabilities(pool, model, key = poolKey(pool)) {
    synchronizePoolModels(pool, pool.models, pool.model)
    const entry = pool.models.find(item => item.id === model)
    if (!entry) return
    delete entry.capabilities
    if (!resolveCapabilities) return
    try {
      const capabilities = await resolveCapabilities({
        model,
        key,
        baseUrl: pool.base_url || apiRoot,
      })
      if (capabilities) {
        entry.capabilities = capabilities
      }
    } catch (err) {
      console.warn(`[${poolName}] não consegui descobrir capacidades de ${model}: ${err.message}`)
    }
  }

  async function ensurePool() {
    const cfg = loadConfig()
    if (!cfg.llm) cfg.llm = {}
    if (!Array.isArray(cfg.llm.pools)) cfg.llm.pools = []
    if (!findPool(cfg)) {
      cfg.llm.pools.push(emptyPool())
      saveConfig(cfg)
      await clearAgentCache()
      console.log(`[${poolName}] slot vazio inserido em agent.config.json (desligado).`)
    } else {
      console.log(`[${poolName}] slot já presente em agent.config.json.`)
    }
  }

  

  async function onBoot() {
    try { await ensurePool() }
    catch (err) { console.error(`[${poolName}] boot falhou ao garantir o slot: ${err.message}`) }
  }

  async function getStatus() {
    try {
      return { data: buildStatus(findPool(loadConfig())) }
    } catch (err) {
      return { status: 500, data: { error: err.message } }
    }
  }

  /** Body: { api_key?, base_url?, model? }. Grava e (se válido) ativa o slot. */
  async function save(req) {
    try {
      const body    = req?.body ?? {}
      const key     = String(body.api_key ?? '').trim()
      const baseUrl = String(body.base_url ?? '').trim()
      const model   = String(body.model ?? '').trim()

      if (!keyless) {
        if (!key) return { status: 400, data: { error: 'api_key vazia.' } }
        if (keyRegex && !keyRegex.test(key)) {
          return { status: 400, data: { error: 'Chave com formato inesperado — confira o que foi colado.' } }
        }
      }

      const cfg = loadConfig()
      if (!cfg.llm) cfg.llm = {}
      if (!Array.isArray(cfg.llm.pools)) cfg.llm.pools = []
      let pool = findPool(cfg)
      if (!pool) { pool = emptyPool(); cfg.llm.pools.push(pool) }
      if (!pool.name) pool.name = poolName

      if (!keyless && key) pool.api_keys = [key]
      if (baseUrl) pool.base_url = baseUrl
      if (model && model !== pool.model) {
        synchronizePoolModels(pool, [...(pool.models ?? []), model], model)
        await refreshCapabilities(pool, model, key || poolKey(pool))
      } else if (model && pool.capabilities_model !== model) {
        synchronizePoolModels(pool, pool.models, model)
        await refreshCapabilities(pool, model, key || poolKey(pool))
      }
      pool.enabled = true
      saveConfig(cfg)
      await clearAgentCache()

      return { data: { success: true, status: buildStatus(pool) } }
    } catch (err) {
      return { status: 500, data: { error: err.message } }
    }
  }

  async function saveModel(req) {
    try {
      const model = String(req?.body?.model ?? '').trim()
      if (!model) return { status: 400, data: { error: 'model vazio.' } }
      const cfg  = loadConfig()
      const pool = findPool(cfg)
      if (!pool) return { status: 404, data: { error: `Slot ${poolName} ainda não existe.` } }
      synchronizePoolModels(pool, [...(pool.models ?? []), model], model)
      await refreshCapabilities(pool, model)
      saveConfig(cfg)
      await clearAgentCache()
      return { data: { success: true, status: buildStatus(pool) } }
    } catch (err) {
      return { status: 500, data: { error: err.message } }
    }
  }

  /** Body: { models: Array<{id:string}|string>, model?: string }. */
  async function saveModels(req) {
    try {
      const models = req?.body?.models
      if (!Array.isArray(models)) return { status: 400, data: { error: 'models deve ser uma lista.' } }
      const ids = models.map(modelId).filter(Boolean)
      if (!ids.length) return { status: 400, data: { error: 'Informe ao menos um modelo.' } }
      const cfg = loadConfig()
      const pool = findPool(cfg)
      if (!pool) return { status: 404, data: { error: `Slot ${poolName} ainda não existe.` } }
      const before = new Set((pool.models ?? []).map(modelId).filter(Boolean))
      synchronizePoolModels(pool, ids, req?.body?.model)
      for (const id of ids) {
        if (!before.has(id)) await refreshCapabilities(pool, id)
      }
      saveConfig(cfg)
      await clearAgentCache()
      return { data: { success: true, status: buildStatus(pool) } }
    } catch (err) {
      return { status: 500, data: { error: err.message } }
    }
  }

  /** Lista os modelos diretamente na API do provider com a chave já salva.
   * A chave nunca sai do servidor: a view recebe apenas id e nome do modelo.
   */
  async function listModels() {
    try {
      const pool = findPool(loadConfig())
      const key = poolKey(pool)
      if (!pool || (!keyless && !key)) {
        return { status: 400, data: { error: 'Save an API key before loading models.' } }
      }
      const base = (pool.base_url || apiRoot).replace(/\/$/, '')
      const res = await fetch(`${base}/models`, {
        headers: key ? { Authorization: `Bearer ${key}` } : {},
      })
      const text = await res.text()
      let payload = null
      try { payload = text ? JSON.parse(text) : null } catch { /* resposta inválida do provider */ }
      if (!res.ok) {
        const message = payload?.error?.message || payload?.error || text.slice(0, 300) || `HTTP ${res.status}`
        return { data: { success: false, error: String(message) } }
      }
      const models = (payload?.data ?? payload?.models ?? [])
        .map(item => ({ id: String(item?.id ?? item?.name ?? '').trim(), name: String(item?.name ?? item?.id ?? '').trim() }))
        .filter(item => item.id)
        .sort((a, b) => a.name.localeCompare(b.name))
      return { data: { success: true, models } }
    } catch (err) {
      return { data: { success: false, error: err.message } }
    }
  }

  async function toggleEnabled(req) {
    try {
      const body = { ...(req?.body ?? {}) }
      if (Object.hasOwn(body, 'enabled')) {
        body.enabled = normalizeConfig({ llm: { pools: [{ enabled: body.enabled }] } }).llm.pools[0].enabled
      }
      const cfg  = loadConfig()
      const pool = findPool(cfg)
      if (!pool) return { status: 404, data: { error: `Slot ${poolName} ainda não existe.` } }
      if (!keyless && !poolKey(pool) &&
          (body.enabled === true || (typeof body.enabled !== 'boolean' && !pool.enabled))) {
        return { status: 400, data: { error: 'Salve uma chave antes de ligar o provider.' } }
      }
      pool.enabled = typeof body.enabled === 'boolean' ? body.enabled : !pool.enabled
      saveConfig(cfg)
      await clearAgentCache()
      return { data: { success: true, status: buildStatus(pool) } }
    } catch (err) {
      return { status: 500, data: { error: err.message } }
    }
  }

  async function testConnection() {
    try {
      const pool = findPool(loadConfig())
      if (!pool) return { status: 404, data: { error: `Slot ${poolName} não configurado.` } }
      const key = poolKey(pool)
      if (!keyless && !key) {
        return { data: { success: false, error: 'Nenhuma chave configurada — salve uma antes de testar.' } }
      }
      const base  = (pool.base_url || apiRoot).replace(/\/$/, '')
      const model  = pool.model || defaultModel
      const started = Date.now()

      let url, headers, payload
      if (testStyle === 'anthropic') {
        url     = `${base}/messages`
        headers = { 'Content-Type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01', ...testHeaders }
        
        
        payload = { model, max_tokens: 50, messages: [{ role: 'user', content: 'Responda apenas com a palavra "ok".' }] }
      } else {
        url     = `${base}${chatPath}`
        headers = { 'Content-Type': 'application/json', ...testHeaders }
        if (key) headers.Authorization = `Bearer ${key}`
        payload = { model, max_tokens: 50, messages: [{ role: 'user', content: 'Responda apenas com a palavra "ok".' }] }
      }

      const res  = await fetch(url, { method: 'POST', headers, body: JSON.stringify(payload) })
      const text = await res.text()
      let json = null
      try { json = text ? JSON.parse(text) : null } catch { /* corpo não-JSON */ }

      if (!res.ok) {
        const apiErr = json?.error?.message || (typeof json?.error === 'string' ? json.error : null) || text.slice(0, 300) || `HTTP ${res.status}`
        const hint = res.status === 401 ? ' (chave inválida/revogada)'
          : res.status === 402 ? ' (créditos/quota insuficientes)'
          : res.status === 404 ? ` (modelo "${model}" indisponível)`
          : ''
        
        
        return { data: { success: false, error: `${apiErr}${hint}` } }
      }

      const configuredModel = pool.models?.find(item => modelId(item) === model)
      if (!configuredModel?.capabilities) {
        await refreshCapabilities(pool, model, key)
        const cfg = loadConfig()
        const currentPool = findPool(cfg)
        if (currentPool) {
          synchronizePoolModels(currentPool, pool.models, pool.model)
          const discovered = pool.models.find(item => item.id === model)
          const target = currentPool.models.find(item => item.id === model)
          if (target?.capabilities && !discovered?.capabilities) delete target.capabilities
          if (target && discovered?.capabilities) target.capabilities = discovered.capabilities
          saveConfig(cfg)
          await clearAgentCache()
        }
      }

      let reply = ''
      if (testStyle === 'anthropic') {
        reply = (json?.content ?? []).filter(b => b?.type === 'text').map(b => b.text).join('')
      } else {
        reply = json?.choices?.[0]?.message?.content ?? ''
      }
      return {
        data: {
          success: true,
          ms:      Date.now() - started,
          model:   json?.model || model,
          reply:   String(reply).slice(0, 500),
        },
      }
    } catch (err) {
      return { data: { success: false, error: err.message } }
    }
  }

  return { onBoot, getStatus, save, saveModel, saveModels, listModels, toggleEnabled, testConnection, buildStatus, findPool }
}
