export const PRESETS = {
  thinkiac: { label: 'ThinkIac', provider: 'thinkiac', base_url: 'https://thinkiac.cloud/thinkiac-provider/v1', model: 'orbit' },
  openrouter: { label: 'OpenRouter', provider: 'openrouter', base_url: 'https://openrouter.ai/api/v1', model: 'openrouter/auto' },
  openai: { label: 'OpenAI', provider: 'openai', base_url: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  compatible: { label: 'OpenAI-compatible API', provider: 'openai', base_url: '', model: '' },
}

const THINKIAC_KEY = /^tiac\.[A-Za-z0-9_-]{12,}\.[A-Za-z0-9_-]{32,}$/

export function providerForKey(value) {
  const key = cleanText(value, 'API key')
  if (!THINKIAC_KEY.test(key)) throw new Error('This key cannot be identified automatically. Use the full provider editor.')
  return {
    preset: 'thinkiac',
    // Keep the canonical id used by the zero-click/mobile provisioner. This
    // lets loading a new key repair an existing installation instead of
    // creating a second managed ThinkIac pool beside it.
    id: 'thinkiac-default',
    name: 'ThinkIac Orbit',
    description: 'Managed ThinkIac provider, configured from its API key.',
    provider: 'thinkiac',
    base_url: PRESETS.thinkiac.base_url,
    api_key: key,
    model: 'orbit',
    models: [{
      id: 'orbit', name: 'Orbit',
      purpose: { name: 'automatic', description: 'Automatic routing by required capability, health, latency and cost.' },
      capabilities: { tools: { supported: true }, reasoning: { supported: true }, structuredOutput: true, streaming: true,
        modalities: { text: { input: true, output: true }, vision: { input: true }, audio: { input: false, output: false }, image: { output: false } } },
    }],
    enabled: true,
    managed: true,
  }
}

export function reconcileProviderKey(pools, value) {
  const inferred = providerForKey(value)
  const managed = pools.filter(pool => poolIsManaged(pool) || (pool?.id === 'default' && pool?.provider === 'thinkiac'))
  const current = pools.find(pool => pool?.id === inferred.id) || managed[0] || null
  const pool = toPool({ ...inferred, id: current?.id || inferred.id }, pools, current)

  if (current) Object.assign(current, pool)
  else pools.push(pool)

  // Older images could contain a second managed pool named `default`, using
  // /billing/v1 and model `auto`. Preserve the record for compatibility, but
  // make it inert and remove the obsolete public model from its catalog.
  for (const legacy of managed) {
    if (legacy === current) continue
    legacy.name = 'ThinkIac Orbit (legacy)'
    legacy.provider = 'thinkiac'
    legacy.base_url = PRESETS.thinkiac.base_url
    legacy.model = 'orbit'
    legacy.models = inferred.models
    legacy.api_keys = pool.api_keys
    legacy.enabled = false
    legacy.managed = true
  }

  return { pool, created: !current }
}

export function cleanText(value, field, { required = false } = {}) {
  const text = String(value ?? '').trim()
  if (required && !text) throw new Error(`${field} is required.`)
  return text
}

export function poolIsManaged(pool) {
  return pool?.managed === true && pool?.provider === 'thinkiac'
}

export function isProtected(pool) {
  // O pool provisionado pode estar em instalações antigas com id "default".
  return poolIsManaged(pool) || pool?.id === 'thinkiac-default'
}

/** Referência de rota estável também para pools legados que ainda não têm id. */
export function poolRef(pool) {
  return pool?.id || `name:${String(pool?.name || pool?.provider || '')}`
}

export function publicPool(pool) {
  const models = Array.isArray(pool?.models) ? pool.models : []
  // Alguns arquivos legados ainda usam api_key singular. Nunca o replique no
  // estado da UI: a tela só precisa saber se existe uma chave e sua máscara.
  const { api_key, api_keys, ...safePool } = pool ?? {}
  return {
    ...safePool,
    id: poolRef(pool),
    api_keys: Array.isArray(api_keys) ? api_keys.map((entry, index) => {
      const key = typeof entry === 'string' ? entry : entry?.key
      if (!key) return null
      return {
        index,
        masked: `${String(key).slice(0, 7)}…${String(key).slice(-4)}`,
        enabled: typeof entry === 'object' ? entry.enabled !== false : true,
        maxConcurrency: typeof entry === 'object' ? entry.maxConcurrency ?? null : null,
        model: typeof entry === 'object' ? entry.model ?? null : null,
        base_url: typeof entry === 'object' ? entry.base_url ?? null : null,
      }
    }).filter(Boolean) : [],
    models: models.map((model) => typeof model === 'string' ? { id: model } : model),
    protected: isProtected(pool),
  }
}

export function servesOrbit(pool) {
  if (!pool || pool.provider === 'thinkiac') return false
  if (String(pool.provider || '').endsWith('-cli')) return pool.remote_api === true
  return pool.remote_api !== false
}

export function configureOrbitGateway(pools, entries) {
  if (!Array.isArray(entries)) throw new Error('providers must be an array.')
  const requested = new Map(entries.map(entry => [cleanText(entry?.id, 'Provider ID', { required: true }), entry]))
  for (const id of requested.keys()) {
    if (!pools.some(pool => poolRef(pool) === id)) throw new Error(`Provider not found: ${id}.`)
  }
  for (const pool of pools) {
    const entry = requested.get(poolRef(pool))
    if (!entry) continue
    if (pool.provider === 'thinkiac' && entry.enabled === true) throw new Error('The ThinkIac provider cannot serve Orbit recursively.')
    if (typeof entry.enabled !== 'boolean') throw new Error(`enabled must be a boolean for ${poolRef(pool)}.`)
    pool.remote_api = entry.enabled
    pool.remote_api_priority = integer(entry.priority, pool.remote_api_priority ?? 0, { min: -1000, max: 1000 })
  }
  return pools
}

function uniqueId(value, pools, excluded = null) {
  const base = String(value || 'provider').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'provider'
  let id = base
  let index = 2
  while (pools.some(pool => pool !== excluded && pool.id === id)) id = `${base}-${index++}`
  return id
}

export function toModel(input) {
  // Preserve provider/model-specific metadata that this generic editor does not
  // interpret. This keeps a normal edit from silently deleting future fields.
  const { id: _id, name: _name, purpose: _purpose, capabilities: _capabilities,
    economics: _economics, operational: _operational, limits: _limits,
    evidence: _evidence, ...extensionFields } = input ?? {}
  const id = cleanText(input?.id, 'Model ID', { required: true })
  const name = cleanText(input?.name, 'Model title')
  const purposeName = cleanText(input?.purpose?.name, 'Purpose')
  const purposeDescription = cleanText(input?.purpose?.description, 'Purpose description')
  return {
    ...extensionFields,
    id,
    ...(name ? { name } : {}),
    ...(purposeName || purposeDescription ? { purpose: { ...(purposeName ? { name: purposeName } : {}), ...(purposeDescription ? { description: purposeDescription } : {}) } } : {}),
    ...(input?.capabilities && typeof input.capabilities === 'object' ? { capabilities: input.capabilities } : {}),
    ...(input?.economics && typeof input.economics === 'object' ? { economics: input.economics } : {}),
    ...(input?.operational && typeof input.operational === 'object' ? { operational: input.operational } : {}),
    ...(input?.limits && typeof input.limits === 'object' ? { limits: input.limits } : {}),
    ...(Array.isArray(input?.evidence) ? { evidence: input.evidence } : {}),
  }
}

function integer(value, fallback, { min = 0, max = 100 } = {}) {
  const number = Number(value ?? fallback)
  if (!Number.isInteger(number) || number < min || number > max) throw new Error(`Expected an integer between ${min} and ${max}.`)
  return number
}

export function toRetry(input = {}, current = {}) {
  const statuses = Array.isArray(input.retryableStatus) ? input.retryableStatus.map(Number) : (current.retryableStatus ?? [408, 425, 429, 500, 502, 503, 504])
  if (statuses.some(status => !Number.isInteger(status) || status < 400 || status > 599)) throw new Error('Retry status codes must be valid HTTP error statuses.')
  return {
    maxAttempts: integer(input.maxAttempts, current.maxAttempts ?? 2, { min: 1, max: 10 }),
    baseDelayMs: integer(input.baseDelayMs, current.baseDelayMs ?? 400, { min: 0, max: 60000 }),
    maxDelayMs: integer(input.maxDelayMs, current.maxDelayMs ?? 8000, { min: 0, max: 300000 }),
    retryableStatus: [...new Set(statuses)],
  }
}

function toKeys(input, current) {
  if (!Array.isArray(input?.slots)) return current?.api_keys ?? []
  return input.slots.map((slot, index) => {
    const existing = current?.api_keys?.[slot.index ?? index]
    const existingKey = typeof existing === 'string' ? existing : existing?.key
    const key = cleanText(slot.key, 'API key') || existingKey
    if (!key) throw new Error(`API key is required for slot ${index + 1}.`)
    return {
      ...(typeof existing === 'object' ? existing : {}),
      key,
      enabled: slot.enabled !== false,
      maxConcurrency: integer(slot.maxConcurrency, 1, { min: 1, max: 100 }),
      ...(cleanText(slot.model, 'Slot model') ? { model: cleanText(slot.model, 'Slot model') } : {}),
      ...(cleanText(slot.base_url, 'Slot base URL') ? { base_url: cleanText(slot.base_url, 'Slot base URL') } : {}),
    }
  })
}

export function toPool(input, pools, current = null) {
  const preset = PRESETS[input?.preset] ?? PRESETS.compatible
  const name = cleanText(input?.name, 'Provider title', { required: true })
  const provider = cleanText(input?.provider || preset.provider, 'Provider type', { required: true })
  const models = Array.isArray(input?.models) ? input.models.map(toModel) : []
  const ids = new Set()
  for (const model of models) {
    if (ids.has(model.id)) throw new Error(`Duplicate model ID: ${model.id}.`)
    ids.add(model.id)
  }
  const defaultModel = cleanText(input?.model, 'Default model') || models[0]?.id || ''
  if (defaultModel && !ids.has(defaultModel)) throw new Error('The default model must exist in the catalog.')
  const apiKey = cleanText(input?.api_key, 'API key')
  const baseUrl = cleanText(input?.base_url ?? preset.base_url, 'Base URL')
  const description = cleanText(input?.description, 'Description')
  const weight = Number(input?.weight ?? current?.weight ?? 1)
  if (!Number.isFinite(weight) || weight < 0) throw new Error('Weight must be a number greater than or equal to zero.')
  return {
    ...(current ?? {}),
    id: cleanText(input?.id, 'ID') || current?.id || uniqueId(name, pools, current),
    name,
    provider,
    ...(input?.managed === true ? { managed: true } : {}),
    model: defaultModel || null,
    models,
    enabled: input?.enabled === true,
    remote_api: provider === 'thinkiac' ? false : (typeof input?.remote_api === 'boolean' ? input.remote_api : (current?.remote_api ?? !provider.endsWith('-cli'))),
    remote_api_priority: integer(input?.remote_api_priority, current?.remote_api_priority ?? 0, { min: -1000, max: 1000 }),
    weight,
    retry: toRetry(input?.retry, current?.retry),
    maxConcurrency: integer(input?.maxConcurrency, current?.maxConcurrency ?? 2, { min: 1, max: 100 }),
    ...(description ? { description } : {}),
    ...(baseUrl ? { base_url: baseUrl } : {}),
    ...(Array.isArray(input?.slots) ? { api_keys: toKeys(input, current) }
      : apiKey ? { api_keys: [{ key: apiKey, enabled: true, maxConcurrency: 1 }] }
        : (current?.api_keys ? { api_keys: current.api_keys } : {})),
  }
}
