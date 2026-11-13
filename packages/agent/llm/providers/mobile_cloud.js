

import { listMobileLlmModels, requestMobileLlm } from '../../../hermes/index.js'

const cache = { at: 0, models: [] }
const TTL_MS = 10_000
const SEP = '@device:'

function toModel(appId, item) {
  if (!item?.id?.startsWith('local:')) return null
  const tools = item.capabilities?.nativeTools === true || (
    item.capabilities?.nativeTools == null && item.capabilities?.tools === true
  )
  return {
    id: `${item.id}${SEP}${appId}`,
    name: `${item.name ?? item.id.slice(6)} · Android`,
    purpose: {
      name: 'Android Local',
      description: `${tools ? 'tools nativas verificadas' : 'tools emuladas por texto'} · ${item.name ?? item.id.slice(6)} · execução no Android pareado`,
    },
    
    
    capabilities: {
      modalities: { text: { input: true, output: true } },
      tools: { supported: true, native: tools, emulated: !tools, parallel: false },
      streaming: false,
    },
    economics: { inputCost: 0, outputCost: 0, costScore: 1 },
    recommended: item.recommended === true,
  }
}

export async function refreshMobileCloudDiscovery(config) {
  if (!config?.llm?.pools?.some(pool => pool.provider === 'thinkiac-mobile-cloud' && pool.enabled)) return config
  if (Date.now() - cache.at >= TTL_MS) {
    const devices = await listMobileLlmModels()
    cache.models = devices.flatMap(({ appId, models }) => models.map(item => toModel(appId, item)).filter(Boolean))
    cache.at = Date.now()
  }
  return applyMobileCloudDiscovery(config)
}

export function applyMobileCloudDiscovery(config) {
  if (!config?.llm?.pools) return config
  return { ...config, llm: { ...config.llm, pools: config.llm.pools.map(pool => pool.provider === 'thinkiac-mobile-cloud' && pool.enabled
    ? { ...pool, available: cache.models.length > 0, models: cache.models, model: cache.models[0]?.id ?? pool.model }
    : pool) } }
}

export async function runMobileCloudTurn(model, body) {
  const at = String(model).lastIndexOf(SEP)
  if (at < 1) throw new Error('Modelo Android sem aparelho vinculado')
  const localModel = String(model).slice(0, at)
  const appId = String(model).slice(at + SEP.length)
  return requestMobileLlm({ appId, action: 'chat', payload: { ...body, model: localModel }, timeoutMs: 120_000 })
}
