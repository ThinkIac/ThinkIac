export const THINKIAC_EDGE_BASE = 'http://127.0.0.1:5040'
const cache = new Map()
const TTL_MS = 10_000

const baseOf = pool => String(pool?.base_url ?? pool?.baseUrl ?? THINKIAC_EDGE_BASE).replace(/\/+$/, '')

function toModel(entry) {
  if (!entry?.id?.startsWith('local:')) return null
  const tools = entry.capabilities?.nativeTools === true || (
    entry.capabilities?.nativeTools == null && entry.capabilities?.tools === true
  )
  return {
    id: entry.id,
    name: entry.name ?? entry.id.slice(6),
    purpose: {
      name: 'Android Local',
      description: `${tools ? 'tools nativas verificadas' : 'tools emuladas por texto'} · ${entry.name ?? entry.id.slice(6)} · execução local no aparelho`,
    },
    capabilities: {
      modalities: { text: { input: true, output: true } },
      
      
      
      tools: { supported: true, native: tools, emulated: !tools, parallel: false },
      streaming: entry.capabilities?.streaming === true,
    },
    economics: { inputCost: 0, outputCost: 0, costScore: 1 },
    recommended: entry.recommended === true,
  }
}

async function discover(base) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 1500)
  try {
    const response = await fetch(`${base}/v1/models`, { signal: controller.signal })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    const body = await response.json()
    return { at: Date.now(), available: true, models: (body.data ?? []).map(toModel).filter(Boolean) }
  } catch (error) {
    return { at: Date.now(), available: false, models: [], error: error.message }
  } finally {
    clearTimeout(timer)
  }
}

export async function refreshThinkIacEdgeDiscovery(config) {
  const pools = config?.llm?.pools
  if (!Array.isArray(pools) || !pools.some(pool => pool.provider === 'thinkiac-edge' && pool.enabled)) return config
  const next = await Promise.all(pools.map(async pool => {
    if (pool.provider !== 'thinkiac-edge' || !pool.enabled) return pool
    const base = baseOf(pool)
    let snapshot = cache.get(base)
    if (!snapshot || Date.now() - snapshot.at >= TTL_MS) {
      snapshot = await discover(base)
      cache.set(base, snapshot)
    }
    return {
      ...pool,
      available: snapshot.available,
      models: snapshot.models,
      model: snapshot.models.some(model => model.id === pool.model) ? pool.model : snapshot.models[0]?.id ?? pool.model,
    }
  }))
  return { ...config, llm: { ...config.llm, pools: next } }
}

export function applyThinkIacEdgeDiscovery(config) {
  const pools = config?.llm?.pools
  if (!Array.isArray(pools)) return config
  let changed = false
  const next = pools.map(pool => {
    if (pool.provider !== 'thinkiac-edge' || !pool.enabled) return pool
    const snapshot = cache.get(baseOf(pool))
    if (!snapshot) {
      changed = true
      return { ...pool, available: false, models: [] }
    }
    changed = true
    return { ...pool, available: snapshot.available, models: snapshot.models, model: snapshot.models.some(model => model.id === pool.model) ? pool.model : snapshot.models[0]?.id ?? pool.model }
  })
  return changed ? { ...config, llm: { ...config.llm, pools: next } } : config
}

export function __setThinkIacEdgeSnapshot(base, snapshot) {
  if (snapshot) cache.set(base, { at: Date.now(), available: true, models: [], ...snapshot })
  else cache.delete(base)
}
