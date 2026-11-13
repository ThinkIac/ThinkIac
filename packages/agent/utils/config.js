import { createConfigStore } from './config_store.js'
import { join, dirname }            from 'path'
import { fileURLToPath }            from 'url'

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const store = createConfigStore(join(PKG_DIR, 'agent.config.json'))
export { normalizeConfig } from './config_store.js'
export function clearConfigCache() { store.clear() }
export function saveConfig(config) { return store.save(config) }
export function getConfig() {
  /**
   * @register_hook getConfig
   */
  return store.get()
}

/**
 * Retorna o pool ativo para resolver defaults de model/embed_model/api_key
 * (usado como último fallback quando um slot não tem model/embed_model
 * próprio). Exclui pools locais sem endpoint HTTP: ollama (endpoint HTTP
 * direto, sem api_key aplicável) e qualquer provider "modo cli" (claude-cli,
 * ollama-cli — identificado por carregar `cli:` no pool, não por nome fixo,
 * para não precisar listar cada provider cli aqui).
 */
function getRemotePool() {
  const cfg = getConfig()
  const pools = cfg.llm?.pools ?? []
  return pools.find(p => p.enabled && p.provider !== 'ollama' && !p.cli) ?? null
}

export function getApiKey() {
  const cfg = getConfig()
  const pool = getRemotePool()
  if (pool?.api_keys?.length) return pool.api_keys[0]
  if (pool?.api_key) return pool.api_key
  return cfg.openrouter?.api_key ?? ''
}

export function getDefaultModel() {
  const cfg = getConfig()
  const pool = getRemotePool()
  if (pool?.model) return pool.model
  return cfg.llm?.model ?? cfg.openrouter?.default_model ?? 'openai/gpt-4o-mini'
}

export function getEmbedModel() {
  const cfg = getConfig()
  const pool = getRemotePool()
  if (pool?.embed_model) return pool.embed_model
  return cfg.llm?.embed_model ?? cfg.openrouter?.embedding_model ?? 'openai/text-embedding-3-small'
}

export const getMaxIterations   = () => getConfig().agent?.max_iterations ?? 15
export const getSchedulerConfig = () => getConfig().scheduler ?? {}