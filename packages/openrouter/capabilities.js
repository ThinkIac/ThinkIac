export function capabilitiesFromModel(metadata = {}) {
  const supported = Array.isArray(metadata.supported_parameters)
    ? metadata.supported_parameters
    : []
  return { tools: { supported: supported.includes('tools') } }
}

export function replaceModelCapabilities(pool, model, capabilities) {
  const models = Array.isArray(pool.models) ? pool.models : []
  const entries = new Map(models.map(entry => {
    const id = typeof entry === 'string' ? entry : entry?.id
    return [id, typeof entry === 'string' ? { id } : { ...entry }]
  }))
  const entry = entries.get(model) ?? { id: model }
  pool.models = [...entries.values()].filter(item => item.id !== model).concat(entry)
  pool.model = model
  delete pool.capabilities
  delete pool.capabilities_model
  if (capabilities) {
    entry.capabilities = capabilities
  } else {
    delete entry.capabilities
  }
  return pool
}

export async function discoverOpenRouterCapabilities({ model, key, baseUrl, fetchImpl = fetch }) {
  const base = String(baseUrl).replace(/\/$/, '')
  const headers = key ? { Authorization: `Bearer ${key}` } : {}
  const response = await fetchImpl(`${base}/models`, { headers })
  if (!response.ok) throw new Error(`catálogo OpenRouter respondeu HTTP ${response.status}`)
  const body = await response.json()
  const metadata = (body?.data ?? []).find(item => item?.id === model)
  if (!metadata) throw new Error(`modelo "${model}" não encontrado no catálogo OpenRouter`)
  return capabilitiesFromModel(metadata)
}
