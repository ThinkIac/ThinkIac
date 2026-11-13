import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// A policy é configuração de UI, não auditoria: mora num JSON simples ao lado
// do pacote em vez de uma tabela nova, para não exigir migração do store.
const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')
const FILE = join(PKG_DIR, 'data', 'policies.json')

export const MODES = ['auto', 'semi', 'manual']
export const PRESETS = {
  read_only: 'Read only. Only proven read-only queries are allowed. Creating, writing, editing, deleting, executing commands, using paid models, sending, publishing, or connecting requires explicit approval.',
  workspace_edits: 'May create and edit files in the current workspace and run no commands. Never delete, move, rename, overwrite, publish, send, deploy, connect, access secrets, or use the network without explicit approval.',
  custom: ''
}
export const PRESET_IDS = Object.keys(PRESETS)
export const DEFAULT_MODE = 'semi'
export const DEFAULT_PRESET = 'read_only'
const DEFAULT_POLICY_KEY = '__default__'

let cache = null
let ephemeral = false // testes: mantém tudo em memória, sem tocar o disco

function load() {
  if (cache) return cache
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {} } catch { cache = {} }
  return cache
}

function persist() {
  if (ephemeral) return
  try {
    mkdirSync(dirname(FILE), { recursive: true })
    writeFileSync(FILE, JSON.stringify(cache ?? {}, null, 2), 'utf8')
  } catch { /* config de UI nunca derruba a avaliação da ação */ }
}

/** Apenas para testes: troca o arquivo por um mapa em memória. */
export function setPoliciesForTest(next) {
  cache = next || {}
  ephemeral = true
}

export function getPolicy(sessionId) {
  const stored = load()[sessionId] || getDefaultPolicy()
  // Sessões criadas antes dos presets tinham apenas um prompt. Preserve sua
  // intenção como Custom em vez de convertê-las silenciosamente para Read only.
  const legacyCustom = !stored.preset && stored.mode === 'semi' && typeof stored.prompt === 'string' && stored.prompt.trim()
  return {
    sessionId,
    mode: MODES.includes(stored.mode) ? stored.mode : DEFAULT_MODE,
    preset: PRESET_IDS.includes(stored.preset) ? stored.preset : legacyCustom ? 'custom' : DEFAULT_PRESET,
    prompt: typeof stored.prompt === 'string' ? stored.prompt : PRESETS[DEFAULT_PRESET],
    updatedAt: stored.updatedAt || null
  }
}

/** Política aplicada a sessões novas, que ainda não receberam escolha própria. */
export function getDefaultPolicy() {
  const stored = load()[DEFAULT_POLICY_KEY] || {}
  const legacyCustom = !stored.preset && stored.mode === 'semi' && typeof stored.prompt === 'string' && stored.prompt.trim()
  return {
    mode: MODES.includes(stored.mode) ? stored.mode : DEFAULT_MODE,
    preset: PRESET_IDS.includes(stored.preset) ? stored.preset : legacyCustom ? 'custom' : DEFAULT_PRESET,
    prompt: typeof stored.prompt === 'string' ? stored.prompt : PRESETS[DEFAULT_PRESET],
    updatedAt: stored.updatedAt || null,
  }
}

export function setDefaultPolicy({ mode, preset, prompt } = {}) {
  const current = getDefaultPolicy()
  const nextMode = mode === undefined ? current.mode : mode
  if (!MODES.includes(nextMode)) throw new Error(`mode inválido: use ${MODES.join(', ')}`)
  const nextPreset = preset === undefined ? current.preset : preset
  if (!PRESET_IDS.includes(nextPreset)) throw new Error(`preset inválido: use ${PRESET_IDS.join(', ')}`)
  const nextPrompt = prompt === undefined
    ? (nextPreset === 'custom' ? current.prompt : PRESETS[nextPreset])
    : String(prompt || '')
  const policy = { mode: nextMode, preset: nextPreset, prompt: nextPreset === 'custom' ? nextPrompt : PRESETS[nextPreset], updatedAt: new Date().toISOString() }
  load()[DEFAULT_POLICY_KEY] = policy
  persist()
  return policy
}

export function setPolicy({ sessionId, mode, preset, prompt } = {}) {
  if (!sessionId) throw new Error('sessionId é obrigatório')
  const current = getPolicy(sessionId)
  const nextMode = mode === undefined ? current.mode : mode
  if (!MODES.includes(nextMode)) throw new Error(`mode inválido: use ${MODES.join(', ')}`)
  // Compatibilidade com a API anterior: enviar um prompt sem preset equivale
  // a escolher Custom. A UI nova sempre envia o preset explicitamente.
  const nextPreset = preset === undefined
    ? (prompt !== undefined && current.preset === DEFAULT_PRESET ? 'custom' : current.preset)
    : preset
  if (!PRESET_IDS.includes(nextPreset)) throw new Error(`preset inválido: use ${PRESET_IDS.join(', ')}`)
  const nextPrompt = prompt === undefined
    ? (preset !== undefined && nextPreset !== 'custom' ? PRESETS[nextPreset] : current.prompt)
    : String(prompt || '')
  // Custom vazio continua válido, mas o classificador falha fechado e pede
  // confirmação. Isso mantém a edição incremental do campo na UI segura.
  const policy = { mode: nextMode, preset: nextPreset, prompt: nextPreset === 'custom' ? nextPrompt : PRESETS[nextPreset], updatedAt: new Date().toISOString() }
  load()[sessionId] = policy
  persist()
  return { sessionId, ...policy }
}

/**
 * Copia a politica efetiva entre sessoes sem ampliar autorizacoes.
 * Subprocessos e subagentes usam uma sessao propria, mas devem herdar a escolha
 * explicita feita pelo usuario na sessao que os criou.
 */
export function inheritPolicy(parentSessionId, childSessionId) {
  if (!parentSessionId || !childSessionId) throw new Error('parentSessionId e childSessionId sao obrigatorios')
  const parent = getPolicy(parentSessionId)
  return setPolicy({
    sessionId: childSessionId,
    mode: parent.mode,
    preset: parent.preset,
    prompt: parent.prompt,
  })
}

export function listPolicies() {
  return Object.entries(load())
    .filter(([sessionId]) => sessionId !== DEFAULT_POLICY_KEY)
    .map(([sessionId, policy]) => ({ sessionId, ...policy }))
}
