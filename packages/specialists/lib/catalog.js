// specialists/lib/catalog.js — catálogo unificado: especialistas GENÉRICOS
// (um AGENT.md por pacote, descoberto ao vivo) + especialistas PERSONALIZADOS
// (CRUD, guardados no banco do próprio pacote).
//
// Um especialista resolvido tem sempre o mesmo formato, generico ou custom —
// quem consome (agent.js, as views) não precisa saber a origem.

import { getProxy } from 'logos'
import { discoverAgentFiles } from './discovery.js'

const TENANT = 'specialists'

function db() { return getProxy(TENANT) }

// ── (de)serialização dos campos JSON do registro ────────────────────────────

function parseJsonArray(raw) {
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter(v => typeof v === 'string' && v) : []
  } catch { return [] }
}

function serializeJsonArray(value) {
  if (value === null || value === undefined) return null
  const arr = Array.isArray(value) ? value.filter(v => typeof v === 'string' && v.trim()) : []
  return JSON.stringify(arr)
}

// ── Genéricos (um por pacote com AGENT.md) ──────────────────────────────────

export function listGenericSpecialists() {
  return discoverAgentFiles({ includeRoot: false }).map(toGenericSummary)
}

function toGenericSummary(file) {
  return {
    id: `pkg:${file.pkg}`,
    kind: 'generic',
    pkg: file.pkg,
    name: file.name,
    description: file.description || null,
    source: file.path,
  }
}

function resolveGeneric(pkg) {
  const file = discoverAgentFiles({ includeRoot: false }).find(f => f.pkg === pkg)
  if (!file) return null
  return {
    id: `pkg:${pkg}`,
    kind: 'generic',
    name: file.name,
    description: file.description || null,
    ownPrompt: null,
    composedAgents: [{ pkg: file.pkg, name: file.name, body: file.body }],
    // Sem `tools:` no AGENT.md, preserva o comportamento genérico legado.
    toolsAllowlist: file.tools,
    provider: null,
    model: null,
    fallbackModel: null,
    source: file.path,
  }
}

// ── Personalizados (CRUD) ────────────────────────────────────────────────

function normalizeRecord(row) {
  if (!row) return null
  return {
    id: row.id,
    kind: 'custom',
    name: row.name,
    description: row.description || null,
    prompt: row.prompt || null,
    agents: parseJsonArray(row.agents),
    tools: row.tools === null || row.tools === undefined ? null : parseJsonArray(row.tools),
    provider: row.provider || null,
    model: row.model || null,
    fallbackModel: row.fallbackModel || null,
    trigger: parseJsonObject(row.trigger),
    createdAt: row.createdAt ?? null,
    updatedAt: row.updatedAt ?? null,
  }
}

function parseJsonObject(raw) {
  if (!raw) return null
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null
  } catch { return null }
}

function serializeJsonObject(value) {
  return value && typeof value === 'object' ? JSON.stringify(value) : null
}

export function listCustomSpecialists() {
  const rows = db().specialist.query({})
  return rows.map(normalizeRecord).filter(Boolean)
}

export function getCustomSpecialistRow(id) {
  return db().specialist[id] ?? null
}

export function createCustomSpecialist(data = {}) {
  const name = (data.name || '').trim()
  if (!name) throw new Error('name é obrigatório')
  const row = db().specialist.push({
    name,
    description: data.description ?? null,
    prompt: data.prompt ?? null,
    agents: serializeJsonArray(data.agents ?? []) ?? '[]',
    tools: data.tools === undefined ? null : serializeJsonArray(data.tools),
    provider: data.provider ?? null,
    model: data.model ?? null,
    fallbackModel: data.fallbackModel ?? null,
    trigger: serializeJsonObject(data.trigger),
  })
  return normalizeRecord(row)
}

export function updateCustomSpecialist(id, changes = {}) {
  const row = db().specialist[id]
  if (!row) throw new Error(`Especialista ${id} não encontrado`)
  if (changes.name !== undefined) {
    const name = String(changes.name || '').trim()
    if (!name) throw new Error('name não pode ficar vazio')
    row.name = name
  }
  if (changes.description !== undefined) row.description = changes.description
  if (changes.prompt !== undefined) row.prompt = changes.prompt
  if (changes.agents !== undefined) row.agents = serializeJsonArray(changes.agents) ?? '[]'
  if (changes.tools !== undefined) row.tools = changes.tools === null ? null : serializeJsonArray(changes.tools)
  if (changes.provider !== undefined) row.provider = changes.provider
  if (changes.model !== undefined) row.model = changes.model
  if (changes.fallbackModel !== undefined) row.fallbackModel = changes.fallbackModel
  if (changes.trigger !== undefined) row.trigger = serializeJsonObject(changes.trigger)
  return normalizeRecord(row)
}

export function deleteCustomSpecialist(id) {
  const row = db().specialist[id]
  if (!row) throw new Error(`Especialista ${id} não encontrado`)
  db().specialist.delete(id)
  return { deleted: true, id }
}

function resolveCustom(id) {
  const row = getCustomSpecialistRow(id)
  if (!row) return null
  const rec = normalizeRecord(row)
  const agentFiles = discoverAgentFiles({ includeRoot: false })
  const composedAgents = rec.agents
    .map(pkg => agentFiles.find(f => f.pkg === pkg))
    .filter(Boolean)
    .map(f => ({ pkg: f.pkg, name: f.name, body: f.body }))
  return {
    id: rec.id,
    kind: 'custom',
    name: rec.name,
    description: rec.description,
    ownPrompt: rec.prompt,
    composedAgents,
    toolsAllowlist: rec.tools,
    provider: rec.provider,
    model: rec.model,
    fallbackModel: rec.fallbackModel,
    trigger: rec.trigger,
    updatedAt: rec.updatedAt,
  }
}

// ── Catálogo unificado ───────────────────────────────────────────────────

export function listCatalog() {
  return [
    ...listGenericSpecialists().map(summary => ({
      ...summary,
      tools: getSpecialistById(summary.id)?.toolsAllowlist ?? null,
    })),
    ...listCustomSpecialists().map(rec => ({
      id: rec.id,
      kind: 'custom',
      name: rec.name,
      description: rec.description,
      tools: rec.tools,
    })),
  ]
}

/**
 * Canais autônomos só podem usar especialistas que declaram uma allowlist
 * literal. A ausência de declaração preserva o modo irrestrito do catálogo
 * geral e, por isso, não é segura para atendimento público.
 */
export function hasRestrictedTools(specialist) {
  const tools = specialist?.toolsAllowlist ?? specialist?.tools
  return Array.isArray(tools) && tools.every(tool => {
    const name = String(tool).trim().toLowerCase()
    return Boolean(name) && name !== '*' && name !== 'unrestricted'
  })
}

/** Resolve um especialista (genérico ou custom) pelo id do catálogo. */
export function getSpecialistById(id) {
  if (!id) return null
  if (id.startsWith('pkg:')) return resolveGeneric(id.slice(4))
  return resolveCustom(id)
}

/**
 * Monta o prompt final: instruções próprias primeiro (definem a persona),
 * seguidas de cada AGENT.md composto, na ordem escolhida, cada um sob seu
 * próprio subtítulo — mesmo formato usado em "## Skills ativas" (skills.js),
 * pra manter os dois pontos de injeção consistentes visualmente.
 */
export function composePrompt(resolved) {
  if (!resolved) return ''
  const parts = []
  if (resolved.ownPrompt && resolved.ownPrompt.trim()) parts.push(resolved.ownPrompt.trim())
  for (const agent of resolved.composedAgents || []) {
    parts.push(`### ${agent.name}\n${agent.body}`)
  }
  return parts.join('\n\n---\n\n')
}

/** Preview do prompt composto sem persistir nada — usado pelo editor. */
export function previewPrompt({ prompt = null, agents = [] } = {}) {
  const agentFiles = discoverAgentFiles({ includeRoot: false })
  const composedAgents = (agents || [])
    .map(pkg => agentFiles.find(f => f.pkg === pkg))
    .filter(Boolean)
    .map(f => ({ pkg: f.pkg, name: f.name, body: f.body }))
  return composePrompt({ ownPrompt: prompt, composedAgents })
}

/**
 * Especificação de roteamento pro LLM router (aurora/llm/llm.js): modelo
 * primário, fallback explícito e o(s) provider(s) a que restringir os slots.
 * `null` quando o especialista não fixa modelo — a sessão segue o roteamento
 * normal (purpose/classificação).
 */
export function resolveModelSpec(resolved) {
  if (!resolved || !resolved.model) return null
  return {
    model: resolved.model,
    fallbackModel: resolved.fallbackModel || null,
    providers: resolved.provider ? [resolved.provider] : null,
  }
}
