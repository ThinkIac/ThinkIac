import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createConfigStore } from '../utils/config_store.js'
import { normalizeConfig, clearConfigCache, getConfig } from '../utils/config.js'
import { buildModelOptions, getTitleSettings, saveTitleSettings } from './session_title_settings.js'

const CONFIG_FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'agent.config.json')
const PREFIX_RE = /^[a-z][a-z0-9_-]{0,24}$/
export const DEFAULT_CONFIRMATION_MESSAGE = 'I need your confirmation to proceed with this action.'

function safeConfig() {
  try { return getConfig() } catch { return {} }
}

export function getSessionSettings(config = null) {
  const cfg = config ?? safeConfig()
  const preferences = cfg.sessions?.preferences ?? {}
  const title = getTitleSettings(cfg)
  const confirmation = cfg.sessions?.confirmation ?? {}
  return {
    idPrefix: typeof preferences.idPrefix === 'string' ? preferences.idPrefix : '',
    defaultModel: typeof preferences.defaultModel === 'string' ? preferences.defaultModel : null,
    options: buildModelOptions(cfg),
    title,
    confirmation: {
      generateWithAI: confirmation.generateWithAI === true,
      model: typeof confirmation.model === 'string' ? confirmation.model : null,
      fixedMessage: DEFAULT_CONFIRMATION_MESSAGE,
    },
  }
}



export function getConfirmationSettings(config = null) {
  const settings = getSessionSettings(config)
  return { ...settings.confirmation, options: settings.options }
}

export function saveSessionSettings(patch = {}, deps = {}) {
  const file = deps.configFile ?? CONFIG_FILE
  const load = deps.load ?? (() => normalizeConfig(JSON.parse(readFileSync(file, 'utf8'))))
  const save = deps.save ?? ((cfg) => {
    createConfigStore(file).save(cfg)
    clearConfigCache()
  })
  if (!deps.load && !existsSync(file)) throw new Error('agent.config.json não encontrado')

  let config = load()
  if ('idPrefix' in patch) {
    const idPrefix = String(patch.idPrefix ?? '').trim().toLowerCase()
    if (idPrefix && !PREFIX_RE.test(idPrefix)) {
      throw new Error('O alias deve começar com letra e conter apenas letras minúsculas, números, hífen ou sublinhado.')
    }
    config.sessions ??= {}
    config.sessions.preferences ??= {}
    config.sessions.preferences.idPrefix = idPrefix
    if (!idPrefix) delete config.sessions.preferences.idPrefix
  }

  if ('defaultModel' in patch) {
    const defaultModel = patch.defaultModel ? String(patch.defaultModel) : null
    if (defaultModel && !buildModelOptions(config).some((option) => option.id === defaultModel)) {
      throw new Error(`Modelo "${defaultModel}" não está nas pools configuradas`)
    }
    config.sessions ??= {}
    config.sessions.preferences ??= {}
    config.sessions.preferences.defaultModel = defaultModel
    if (!defaultModel) delete config.sessions.preferences.defaultModel
  }

  if ('confirmationGenerateWithAI' in patch || 'confirmationModel' in patch) {
    const generateWithAI = 'confirmationGenerateWithAI' in patch
      ? patch.confirmationGenerateWithAI === true
      : config.sessions?.confirmation?.generateWithAI === true
    const model = 'confirmationModel' in patch
      ? (patch.confirmationModel ? String(patch.confirmationModel) : null)
      : (typeof config.sessions?.confirmation?.model === 'string' ? config.sessions.confirmation.model : null)
    if (generateWithAI && !model) throw new Error('Escolha um modelo para gerar a mensagem de confirmação.')
    if (model && !buildModelOptions(config).some((option) => option.id === model)) {
      throw new Error(`Modelo "${model}" não está nas pools configuradas`)
    }
    config.sessions ??= {}
    config.sessions.confirmation ??= {}
    config.sessions.confirmation.generateWithAI = generateWithAI
    if (model) config.sessions.confirmation.model = model
    else delete config.sessions.confirmation.model
  }

  const titlePatch = {}
  for (const key of ['enabled', 'every', 'model']) if (key in patch) titlePatch[key] = patch[key]
  if (Object.keys(titlePatch).length) {
    
    return saveTitleSettings(titlePatch, { load: () => config, save: (next) => { config = next } }) && (() => {
      save(config)
      return getSessionSettings(config)
    })()
  }

  save(config)
  return getSessionSettings(config)
}

export function saveConfirmationSettings(values = {}, deps = {}) {
  const settings = saveSessionSettings({
    confirmationGenerateWithAI: values.generateWithAI === true,
    confirmationModel: values.model || null,
  }, deps)
  return { ...settings.confirmation, options: settings.options }
}
