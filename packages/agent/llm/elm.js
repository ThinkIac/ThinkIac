













import { getConfig } from '../utils/config.js'




export const DEFAULT_ELMS = {
  'ada-thin': {
    tier: 'thin',
    members: [
      'google/gemma-3-12b-it',
      'deepseek/deepseek-v4-flash',
    ],
    description: 'ELM pequeno/barato: classificação, roteamento e tarefas triviais.',
  },
  'ada-flash': {
    tier: 'flash',
    members: [
      'google/gemini-2.5-flash',
      'deepseek/deepseek-v4-flash',
    ],
    description: 'ELM médio: orquestração geral, multimodal leve e respostas rápidas.',
  },
  'ada-think': {
    tier: 'think',
    members: [
      'z-ai/glm-5.2',
      'deepseek/deepseek-v4-flash',
    ],
    description: 'ELM grande (reasoning): raciocínio, coding e planejamento.',
  },
  'ada-expanded': {
    tier: 'expanded',
    members: [
      'anthropic/claude-sonnet-4.5',
      'claude-opus-4-8',
    ],
    description: 'ELM top de linha: tarefas críticas / máxima qualidade.',
  },
}

/**
 * Mapa efetivo de ELMs. Precedência (menor → maior):
 *   DEFAULT_ELMS (código)  <  config.llm.elm (por-tenant)
 */
export function getElmMap(config = null) {
  const cfg = config ?? getConfig()
  const merged = {}
  for (const layer of [DEFAULT_ELMS, cfg?.llm?.elm ?? {}]) {
    for (const [id, entry] of Object.entries(layer)) {
      const raw = entry?.members ?? entry?.models 
      if (!entry || !Array.isArray(raw) || !raw.length) continue
      merged[id] = { ...(merged[id] || {}), ...entry }
    }
  }
  return merged
}

/** Normaliza os membros de um ELM em `[{ id }]` (na ordem declarada). */
export function getElmMembers(id, config = null) {
  const entry = getElmMap(config)[id]
  if (!entry) return []
  const raw = entry.members ?? entry.models ?? []
  return raw.map(m =>
    typeof m === 'string'
      ? { id: m }
      : { id: m.id })
}

/** true se `id` é um ELM registrado (id de model "de fachada"). */
export function isElm(id, config = null) {
  return typeof id === 'string' && Object.prototype.hasOwnProperty.call(getElmMap(config), id)
}

/**
 * Resolve um ELM para sua especificação.
 * @returns {{id, tier, members:{id:string}[], models:string[], modalities:string[]|null, description?:string}|null}
 */
export function resolveElm(id, config = null) {
  const entry = getElmMap(config)[id]
  if (!entry) return null
  const members = getElmMembers(id, config)
  return {
    id,
    tier: entry.tier ?? null,
    members,
    models: members.map(m => m.id),
    modalities: entry.modalities ?? null,
    description: entry.description ?? null,
  }
}

/**
 * Expande uma cadeia de modelos trocando cada id de ELM pelos membros reais da
 * pool (ordenados por `orderPurpose`, se dado), preservando ids não-ELM e
 * removendo duplicatas. Idempotente para cadeias sem ELM.
 * @param {string[]} chain
 * @param {object?} config
 * @returns {string[]}
 */
export function expandModelChain(chain, config = null) {
  const out = []
  for (const id of chain ?? []) {
    const members = isElm(id, config)
      ? getElmMembers(id, config).map(member => member.id)
      : [id]
    for (const m of members) if (m && !out.includes(m)) out.push(m)
  }
  return out
}

/** Algum id da cadeia é um ELM? (usado pra reaplicar o filtro de formato por slot) */
export function chainHasElm(chain, config = null) {
  return (chain ?? []).some(id => isElm(id, config))
}

/** Extrai o texto da última mensagem do usuário (pra classificar a intenção). */
export function lastUserText(messages) {
  const m = [...(messages ?? [])].reverse().find(x => x?.role === 'user')
  const c = m?.content
  if (typeof c === 'string') return c
  if (Array.isArray(c)) return c.map(p => (typeof p === 'string' ? p : p?.text ?? '')).join(' ').trim()
  return ''
}

/**
 * Lista os ELMs num shape amigável pra /v1/models e list_models.
 * @returns {{id, tier, members:string[], modalities:string[]|null, description?:string}[]}
 */
export function listElms(config = null) {
  return Object.keys(getElmMap(config)).map(id => {
    const r = resolveElm(id, config)
    return { id, tier: r.tier, members: r.models, modalities: r.modalities, description: r.description }
  })
}
