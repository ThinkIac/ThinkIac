import { saveConfig as persistAgentConfig, normalizeConfig } from '../utils/config.js'




import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getConfig, clearConfigCache, getDefaultModel } from '../utils/config.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))

const PROVIDER_DEFAULTS = {
  openrouter: {
    chat:   () => 'https://openrouter.ai/api/v1/chat/completions',
    embed:  () => 'https://openrouter.ai/api/v1/embeddings',
    models: () => 'https://openrouter.ai/api/v1/models',
    authHeader: (key) => ({ Authorization: `Bearer ${key}`, 'HTTP-Referer': 'https://github.com/johankit/agent', 'X-Title': 'Agent' }),
    defaultModel: 'openai/gpt-4o-mini',
    defaultEmbedModel: 'openai/text-embedding-3-small',
  },
  openai: {
    chat:   (base) => `${base || 'https://api.openai.com'}/v1/chat/completions`,
    embed:  (base) => `${base || 'https://api.openai.com'}/v1/embeddings`,
    models: (base) => `${base || 'https://api.openai.com'}/v1/models`,
    authHeader: (key) => ({ Authorization: `Bearer ${key}` }),
    defaultModel: 'gpt-4o-mini',
    defaultEmbedModel: 'text-embedding-3-small',
  },
  ollama: {
    chat:   (base) => `${base || 'http://localhost:11434'}/api/chat`,
    embed:  (base) => `${base || 'http://localhost:11434'}/api/embeddings`,
    models: (base) => `${base || 'http://localhost:11434'}/api/tags`,
    authHeader: () => ({}),
    defaultModel: 'llama3',
    defaultEmbedModel: 'nomic-embed-text',
  },
  anthropic: {
    chat:   (base) => `${base || 'https://api.anthropic.com'}/v1/messages`,
    embed:  () => null, 
    models: (base) => `${base || 'https://api.anthropic.com'}/v1/models`,
    authHeader: (key) => ({ 'x-api-key': key, 'anthropic-version': '2023-06-01' }),
    defaultModel: 'claude-opus-4-8',
    defaultEmbedModel: null,
  },
}

let _override = null  

export function setProviderOverride(opts) { _override = opts ? { ..._override, ...opts } : null }
export function getProviderOverride() { return _override }
export function clearProviderOverride() { _override = null }

export function resolveProvider() {
  const cfg = getConfig()
  const llm = cfg.llm ?? {}
  const provider = _override?.provider ?? llm.provider ?? 'openrouter'
  const def = PROVIDER_DEFAULTS[provider] ?? PROVIDER_DEFAULTS.openrouter

  
  let apiKey = _override?.api_key ?? llm.api_key ?? null
  if (!apiKey && provider === 'openrouter') {
    const keys = cfg.openrouter?.api_keys ?? []
    apiKey = keys[0] ?? ''
  }

  const baseUrl = _override?.base_url ?? llm.base_url ?? null
  const model   = _override?.model ?? llm.model ?? getDefaultModel() ?? def.defaultModel
  const embedModel = llm.embed_model ?? cfg.openrouter?.embedding_model ?? def.defaultEmbedModel

  return { provider, model, embedModel, apiKey, baseUrl, def }
}

export function getChatUrl()    { const { def, baseUrl } = resolveProvider(); return def.chat(baseUrl) }
export function getEmbedUrl()   { const { def, baseUrl } = resolveProvider(); return def.embed(baseUrl) }
export function getModelsUrl()  { const { def, baseUrl } = resolveProvider(); return def.models(baseUrl) }
export function getAuthHeader() { const { def, apiKey }  = resolveProvider(); return def.authHeader(apiKey) }
export function getCurrentModel()      { return resolveProvider().model }
export function getCurrentProvider()   { return resolveProvider().provider }



export function persistProviderConfig({ provider, model, base_url, api_key }) {
  const file = join(PKG_DIR, '..', 'agent.config.json')
  if (!existsSync(file)) throw new Error('agent.config.json not found')
  const cfg = normalizeConfig(JSON.parse(readFileSync(file, 'utf8')))
  if (!cfg.llm) cfg.llm = {}
  if (provider)  cfg.llm.provider = provider
  if (model)     cfg.llm.model    = model
  if (base_url)  cfg.llm.base_url = base_url
  if (api_key)   cfg.llm.api_key  = api_key
  persistAgentConfig(cfg)
  clearConfigCache()
  return cfg.llm
}



export async function listProviderModels(provider, { base_url, api_key } = {}) {
  const def = PROVIDER_DEFAULTS[provider]
  if (!def) return { success: false, error: `Provedor desconhecido: ${provider}` }
  const url = def.models(base_url ?? null)
  const cfg = getConfig()
  let key = api_key
  if (!key && provider === 'openrouter') key = cfg.openrouter?.api_keys?.[0] ?? ''
  if (!key && provider !== 'ollama') return { success: false, error: 'api_key não informada' }
  try {
    const res = await fetch(url, { headers: { 'Content-Type': 'application/json', ...def.authHeader(key) } })
    if (!res.ok) return { success: false, error: `HTTP ${res.status}: ${await res.text()}` }
    const data = await res.json()
    
    const models = provider === 'ollama'
      ? (data.models ?? []).map(m => ({ id: m.name, name: m.name }))
      : (data.data ?? []).map(m => ({ id: m.id, name: m.id }))
    return { success: true, provider, total: models.length, models }
  } catch (e) {
    return { success: false, error: e.message }
  }
}
