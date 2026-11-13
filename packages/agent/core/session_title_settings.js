import { createConfigStore } from '../utils/config_store.js'
import { normalizeConfig } from '../utils/config.js'









import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getConfig, clearConfigCache } from '../utils/config.js'
import { listElms } from '../llm/elm.js'
import { getTitleConfig } from './session_title.js'

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent.config.json')

/**
 * Opções de modelo oferecidas ao usuário: os ELMs (pools automáticas) e o
 * modelo de cada pool configurada.
 *
 * Pools desabilitadas entram marcadas em vez de sumirem — escondê-las faria o
 * usuário procurar um modelo que ele sabe que configurou; o flag deixa a UI
 * avisar que é preciso habilitar a pool para o roteamento valer.
 *
 * @returns {{id, label, group, provider, description, poolEnabled}[]}
 */
export function buildModelOptions(config = null) {
  const cfg = config ?? safeConfig()
  const seen = new Set()
  const options = []

  for (const elm of listElms(cfg)) {
    if (seen.has(elm.id)) continue
    seen.add(elm.id)
    options.push({
      id: elm.id,
      label: elm.id,
      group: 'ELM (pool automática)',
      provider: null,
      description: elm.description ?? (elm.members?.length ? `Pool: ${elm.members.join(', ')}` : ''),
      poolEnabled: true,
    })
  }

  for (const pool of cfg?.llm?.pools ?? []) {
    
    
    
    const declared = [
      pool?.model,
      ...(Array.isArray(pool?.models) ? pool.models.map(item => typeof item === 'string' ? item : item?.id) : []),
    ]
    for (const id of declared) {
      if (!id || seen.has(id)) continue
      seen.add(id)
      options.push({
        id,
        label: id,
        group: pool.provider ?? 'outros',
        provider: pool.provider ?? null,
        description: pool.name ? `Pool "${pool.name}"` : '',
        poolEnabled: pool.enabled !== false,
      })
    }
  }

  return options
}

/** Estado atual + opções, para a tela desenhar o seletor de uma vez só. */
export function getTitleSettings(config = null) {
  const cfg = config ?? safeConfig()
  const title = getTitleConfig(cfg)
  const configured = title.model ?? null
  const model = configured

  const options = buildModelOptions(cfg)
  
  
  if (model && !options.some(o => o.id === model)) {
    options.unshift({
      id: model, label: model, group: 'atual', provider: null,
      description: 'Configurado fora das pools atuais', poolEnabled: true,
    })
  }

  return {
    enabled: title.enabled,
    every: title.every,
    model,
    source: configured ? 'config' : 'default',
    defaultModel: null,
    options,
  }
}

/**
 * Valida e grava. `model: null` volta pro default de código em vez de gravar
 * um valor fixo — assim o tenant volta a acompanhar a evolução do default.
 *
 * @param {{model?: string|null, enabled?: boolean, every?: number}} patch
 * @param {{configFile?: string, load?: Function, save?: Function}} deps - injeção pra teste
 */
export function saveTitleSettings(patch = {}, deps = {}) {
  const file = deps.configFile ?? CONFIG_FILE
  const load = deps.load ?? (() => normalizeConfig(JSON.parse(readFileSync(file, 'utf8'))))
  const save = deps.save ?? ((cfg) => {
    createConfigStore(file).save(cfg)
    clearConfigCache() 
  })

  if (!deps.load && !existsSync(file)) throw new Error('agent.config.json não encontrado')

  const config = load()

  if ('model' in patch) {
    const model = patch.model ? String(patch.model) : null
    if (model) {
      
      
      const allowed = buildModelOptions(config).some(o => o.id === model)
      if (!allowed) throw new Error(`Modelo "${model}" não está nas pools configuradas`)
    }
    config.sessions ??= {}
    config.sessions.title ??= {}
    config.sessions.title.model = model
    if (!model) delete config.sessions.title.model
  }

  if ('enabled' in patch) {
    config.sessions ??= {}
    config.sessions.title ??= {}
    config.sessions.title.enabled = Boolean(patch.enabled)
  }

  if ('every' in patch) {
    const every = Number(patch.every)
    if (!Number.isInteger(every) || every < 1) throw new Error('`every` deve ser um inteiro >= 1')
    config.sessions ??= {}
    config.sessions.title ??= {}
    config.sessions.title.every = every
  }

  save(config)
  return getTitleSettings(config)
}

function safeConfig() {
  
  
  try { return getConfig() } catch { return {} }
}
