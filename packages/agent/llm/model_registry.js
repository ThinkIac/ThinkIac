import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig } from '../utils/config.js'
import { buildSlots } from './llm_keys.js'
import { attachEvidence, buildModelCatalog, resolveModel } from './model_catalog.js'
import { applyOllamaDiscovery, refreshOllamaDiscovery } from './providers/ollama.js'
import { applyThinkIacEdgeDiscovery, refreshThinkIacEdgeDiscovery } from './providers/thinkiac_edge.js'
import { applyMobileCloudDiscovery, refreshMobileCloudDiscovery } from './providers/mobile_cloud.js'
import { discoverTerminalCodexModels } from './terminal_accounts.js'

const PACKAGE_DIR = dirname(fileURLToPath(import.meta.url))
const EVIDENCE_FILE = join(PACKAGE_DIR, '..', '..', 'benchmark', 'evidence.json')

function readEvidence() {
  if (!existsSync(EVIDENCE_FILE)) return []
  try {
    const snapshot = JSON.parse(readFileSync(EVIDENCE_FILE, 'utf8'))
    return Array.isArray(snapshot?.evidence) ? snapshot.evidence : []
  } catch {
    return []
  }
}

/**
 * Config com as fontes DINÂMICAS de modelo já resolvidas. Hoje só o ollama: os
 * modelos de um daemon local mudam por fora do processo (`ollama pull`/`rm`),
 * então a lista vem da descoberta em vez do que está escrito no
 * agent.config.json. Leitura de cache — nunca bloqueia.
 */
function dynamicConfig() {
  return applyCodexCliDiscovery(applyMobileCloudDiscovery(applyThinkIacEdgeDiscovery(applyOllamaDiscovery(getConfig()))))
}

/**
 * O pool codex-cli é executado pelo Agent, mas os modelos elegíveis pertencem
 * à sessão autenticada da CLI e podem mudar sem editar agent.config.json.
 * Mesclamos o cache da CLI aos modelos declarados no pool, preservando os
 * metadados curados do config e sem alterar o objeto cacheado da configuração.
 */
export function applyCodexCliDiscovery(config, discoveredModels = discoverTerminalCodexModels()) {
  if (!discoveredModels.length || !Array.isArray(config?.llm?.pools)) return config
  let changed = false
  const pools = config.llm.pools.map(pool => {
    if (pool.provider !== 'codex-cli') return pool
    const declared = Array.isArray(pool.models)
      ? pool.models
      : pool.model ? [{ id: pool.model }] : []
    const known = new Set(declared.map(model => typeof model === 'string' ? model : model?.id).filter(Boolean))
    const additions = discoveredModels.filter(model => !known.has(model.id))
    if (!additions.length) return pool
    changed = true
    return { ...pool, models: [...declared, ...additions] }
  })
  return changed ? { ...config, llm: { ...config.llm, pools } } : config
}

export function getGlobalModelCatalog() {
  const config = dynamicConfig()
  const catalog = buildModelCatalog(config, { slots: buildSlots(config) })
  return attachEvidence(catalog, readEvidence())
}

/**
 * Igual a getGlobalModelCatalog(), mas ESPERA a descoberta dinâmica antes de
 * montar. É o que as rotas que alimentam o seletor de modelo da InputBar usam:
 * o usuário abre o popover e a lista já reflete o que está baixado agora, sem
 * depender de um refresh anterior ter aquecido o cache.
 */
export async function getFreshModelCatalog() {
  const config = applyCodexCliDiscovery(await refreshMobileCloudDiscovery(await refreshThinkIacEdgeDiscovery(await refreshOllamaDiscovery(getConfig()))))
  const catalog = buildModelCatalog(config, { slots: buildSlots(config) })
  return attachEvidence(catalog, readEvidence())
}

export function resolveGlobalModel(contract = {}) {
  return resolveModel(getGlobalModelCatalog(), contract)
}

/**
 * Resolução contra o catálogo FRESCO. É o que os caminhos de chamada de LLM
 * usam: um override apontando pra um modelo local (`qwen2.5:3b@local`) precisa
 * ser reconhecido mesmo se este for o primeiro turno depois do boot, antes de
 * qualquer descoberta em background ter voltado — senão o turno morre com
 * `override_not_found` por uma corrida de cache. Dentro do TTL a descoberta é
 * um hit de cache, então isto não adiciona I/O por turno.
 */
export async function resolveGlobalModelFresh(contract = {}) {
  return resolveModel(await getFreshModelCatalog(), contract)
}
