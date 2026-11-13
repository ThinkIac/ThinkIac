// memory/lib/graph.js
// Motor do grafo de memória: entidades, observações (fatos atômicos) e
// relações entre entidades. Ver README.md para a visão geral e o motivo de
// cada decisão de design.

import { readFileSync, existsSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'
import { db } from './db.js'
import { embed, cosine } from './embedder.js'

const LIB_DIR = dirname(fileURLToPath(import.meta.url))
const AURORA_MEM_DIR = join(LIB_DIR, '..', '..', 'aurora', 'memory')
const LEGACY_FACTS = join(AURORA_MEM_DIR, 'facts.md')
const LEGACY_EMBS = join(AURORA_MEM_DIR, 'embeddings.json')

export const DEFAULT_ENTITY = 'general'

function normalizeName(name) {
  const s = String(name ?? '').trim()
  return s || DEFAULT_ENTITY
}

function touch(entity) {
  if (!entity) return
  try {
    entity.accessCount = (entity.accessCount || 0) + 1
    entity.lastAccessedAt = new Date().toISOString()
  } catch { /* best-effort */ }
}

// ── Entidades ─────────────────────────────────────────────────────────────────

/**
 * Encontra a entidade (name, type) ou cria uma nova. Faz o papel do
 * @@unique([name, type]) que o parser Prisma deste runtime não suporta bem.
 */
export async function findOrCreateEntity({ name, type = 'fact', summary } = {}) {
  const entName = normalizeName(name)
  const existing = db.entity.findOne({ name: entName, type })
  if (existing) return existing
  return db.entity.push({ name: entName, type, summary: summary ?? null })
}

// ── Observações (remember / forget) ──────────────────────────────────────────

export async function remember({ content, entity, type = 'fact', sessionId = null, source = 'manual', relations = [] } = {}) {
  const text = String(content ?? '').trim()
  if (!text) return { success: false, error: 'content é obrigatório' }

  const ent = await findOrCreateEntity({ name: entity, type })
  const embedding = await embed(text)

  const obs = await db.observation.push({
    entityId: ent.id,
    content: text,
    embedding: embedding ?? null,
    sessionId: sessionId ?? null,
    source,
  })

  touch(ent)

  for (const rel of relations || []) {
    if (rel?.to) await relate(ent.name, rel.type || 'related_to', rel.to)
  }

  return { success: true, id: obs.id, entity: ent.name, type: ent.type }
}

export async function forget(query) {
  const q = String(query ?? '').trim()
  if (!q) return { success: true, removed: 0, query: q }

  const matches = db.observation.query({ content: { $like: `%${q}%` } })
  const touchedEntities = new Set(matches.map(o => o.entityId))

  let removed = 0
  for (const obs of matches) {
    if (await db.observation.delete(obs.id)) removed++
  }

  // Remove entidades órfãs (sem observações nem relações restantes).
  for (const entityId of touchedEntities) {
    const remaining = db.observation.query({ entityId })
    const outRels = db.relation.query({ fromEntityId: entityId })
    const inRels = db.relation.query({ toEntityId: entityId })
    if (!remaining.length && !outRels.length && !inRels.length) {
      await db.entity.delete(entityId)
    }
  }

  return { success: true, removed, query: q }
}

// ── Relações (grafo) ──────────────────────────────────────────────────────────

export async function relate(fromName, type, toName, { fromType = 'fact', toType = 'fact' } = {}) {
  const relType = String(type || 'related_to').trim() || 'related_to'
  const from = await findOrCreateEntity({ name: fromName, type: fromType })
  const to = await findOrCreateEntity({ name: toName, type: toType })

  if (from.id === to.id) {
    return { success: false, error: 'não é possível relacionar uma entidade a si mesma' }
  }

  const existing = db.relation.findOne({ fromEntityId: from.id, toEntityId: to.id, type: relType })
  if (existing) return { success: true, id: existing.id, from: from.name, to: to.name, type: relType, existing: true }

  const rel = await db.relation.push({ fromEntityId: from.id, toEntityId: to.id, type: relType })
  touch(from)
  touch(to)
  return { success: true, id: rel.id, from: from.name, to: to.name, type: relType }
}

// ── Busca (recall) ────────────────────────────────────────────────────────────

export async function recall(query, { limit = 5, entity = null, pool = 500 } = {}) {
  const q = String(query ?? '').trim()
  if (!q) return []

  let entityFilter = {}
  if (entity) {
    const ent = db.entity.findOne({ name: normalizeName(entity) })
    if (!ent) return []
    entityFilter = { entityId: ent.id }
  }

  const qEmbedding = await embed(q)

  // Sem índice vetorial nativo: trazemos um lote e ranqueamos em JS por cosine
  // similarity (mesma abordagem de aurora/memory/session.js antes desta
  // refatoração, só que agora escopável por entidade/grafo). Quando a busca é
  // escopada a uma entidade, não aplicamos o cap: o grafo de uma entidade é,
  // por design, pequeno (memória pessoal de um agente) — cap-ar aqui só
  // esconderia observações antigas relevantes sem ganho real de desempenho.
  // Sem escopo (busca global), o cap é necessário e `pool` deixa o chamador
  // ajustar a profundidade de recall vs. custo — não substitui um índice ANN
  // real (ver README § Fora de escopo).
  const candidates = qEmbedding
    ? db.observation.query(entityFilter, { sort: 'createdAt DESC', ...(entity ? {} : { limit: pool }) })
    : db.observation.query({ ...entityFilter, content: { $like: `%${q}%` } }, { sort: 'createdAt DESC', limit })

  const entityCache = new Map()
  const getEntity = (id) => {
    if (!entityCache.has(id)) entityCache.set(id, db.entity.findById(id))
    return entityCache.get(id)
  }

  const scored = qEmbedding
    ? candidates
      .map(o => ({
        obs: o,
        score: o.embedding ? cosine(qEmbedding, o.embedding)
          : (o.content.toLowerCase().includes(q.toLowerCase()) ? 0.35 : -1),
      }))
      .filter(x => x.score > -1)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
    : candidates.map(o => ({ obs: o, score: 0 }))

  const results = []
  for (const { obs, score } of scored) {
    const ent = getEntity(obs.entityId)
    touch(ent)
    const related = ent ? db.relation.query({ fromEntityId: ent.id }, { limit: 5 }) : []
    results.push({
      entity: ent?.name ?? 'unknown',
      type: ent?.type ?? 'fact',
      content: obs.content,
      score: Number(score.toFixed(4)),
      createdAt: obs.createdAt,
      relatedTo: related
        .map(r => ({ type: r.type, to: getEntity(r.toEntityId)?.name }))
        .filter(r => r.to),
    })
  }
  return results
}

// ── Compatibilidade: texto plano para consumidores antigos ───────────────────
// (contextRefiner do aurora, que tailored-comprime um blob de texto cru — ver
// aurora/core/agent.js loadFactsRaw()/getSummaryContext()).

export function getFactsText({ limit = 500 } = {}) {
  const observations = db.observation.query({}, { sort: 'createdAt ASC', limit })
  if (!observations.length) return ''

  const entityCache = new Map()
  const nameOf = (id) => {
    if (!entityCache.has(id)) entityCache.set(id, db.entity.findById(id)?.name ?? null)
    return entityCache.get(id)
  }

  return observations
    .map(o => {
      const ts = o.createdAt ? new Date(o.createdAt).toISOString() : ''
      const name = nameOf(o.entityId)
      const label = name && name !== DEFAULT_ENTITY ? `[${name}] ` : ''
      return `- [${ts}] ${label}${o.content}`
    })
    .join('\n')
}

export function getScheduledTasks() {
  const rows = db.observation.query({ content: { $like: '%SCHEDULE |%' } })
  return rows.map(o => {
    const parts = {}
    o.content.replace(/SCHEDULE\s*\|/, '').split('|').forEach(seg => {
      const [k, ...v] = seg.split(':')
      if (k) parts[k.trim()] = v.join(':').trim().replace(/^"|"$/g, '')
    })
    return parts
  })
}

// ── Bloco compacto para injeção em system prompt (hooks.js) ─────────────────

export function getContextBlock({ limit = 5 } = {}) {
  const entities = db.entity.query({}, { sort: 'updatedAt DESC', limit })
  if (!entities.length) return ''

  const lines = ['', '## Memória de longo prazo (memory)']
  for (const ent of entities) {
    const last = db.observation.query({ entityId: ent.id }, { sort: 'createdAt DESC', limit: 1 })[0]
    if (!last) continue
    const snippet = last.content.length > 160 ? last.content.slice(0, 159) + '…' : last.content
    lines.push(`- [${ent.name}] ${snippet}`)
  }
  return lines.length > 1 ? lines.join('\n') : ''
}

// ── Consolidação via LLM (opcional — chamador injeta o callLLM) ─────────────

export async function consolidate({ callLLM, entityName, threshold = 30, keepRecent = 10 } = {}) {
  if (!callLLM) return { success: false, error: 'callLLM é obrigatório' }

  const ent = entityName ? db.entity.findOne({ name: normalizeName(entityName) }) : null
  const filter = ent ? { entityId: ent.id } : {}
  const all = db.observation.query(filter, { sort: 'createdAt ASC' })
  if (all.length <= threshold) return { success: true, skipped: true, count: all.length }

  const toCompress = all.slice(0, all.length - keepRecent)
  const recent = all.slice(-keepRecent)

  const res = await callLLM({
    system: 'Summarize concisely these memory observations in bullet points. Preserve names, preferences, technical decisions and specific values (IDs, tokens, dates). Be terse.',
    messages: [{ role: 'user', content: toCompress.map(o => o.content).join('\n') }],
    tools: [],
  })
  const summary = res?.choices?.[0]?.message?.content?.trim()
  if (!summary) return { success: false, error: 'LLM não retornou resumo' }

  for (const o of toCompress) await db.observation.delete(o.id)

  const targetEntity = ent ?? await findOrCreateEntity({ name: 'legacy', type: 'legacy' })
  await db.observation.push({
    entityId: targetEntity.id,
    content: `[consolidated:${new Date().toISOString()}] ${summary.replace(/\n/g, ' | ')}`,
    source: 'consolidated',
  })

  return { success: true, compressed: toCompress.length, kept: recent.length }
}

// ── Estatísticas ──────────────────────────────────────────────────────────────

export function stats() {
  return {
    entities: db.entity.count({}),
    observations: db.observation.count({}),
    relations: db.relation.count({}),
  }
}

// ── Migração única do facts.md + embeddings.json antigos do aurora ──────────

export async function migrateLegacyFacts() {
  const already = db.observation.findOne({ source: 'migrated' })
  if (already) return { success: true, skipped: true, reason: 'já migrado anteriormente' }

  if (!existsSync(LEGACY_FACTS)) return { success: true, skipped: true, reason: 'facts.md legado não encontrado' }

  const raw = readFileSync(LEGACY_FACTS, 'utf8')
  const lines = raw.split('\n').filter(l => l.trim() && !l.trim().startsWith('#'))

  const embeddingsByText = new Map()
  if (existsSync(LEGACY_EMBS)) {
    try {
      const arr = JSON.parse(readFileSync(LEGACY_EMBS, 'utf8'))
      for (const e of arr) if (e?.text) embeddingsByText.set(e.text, e.embedding)
    } catch { /* embeddings antigos corrompidos: migra só o texto */ }
  }

  const legacy = await findOrCreateEntity({ name: 'legacy', type: 'legacy' })
  let migrated = 0

  for (const line of lines) {
    const content = line.replace(/^-\s*/, '').trim()
    if (!content) continue

    const bareMatch = content.match(/^\[[^\]]+\]\s*(.*)$/)
    const bareText = bareMatch ? bareMatch[1] : content
    const embedding = embeddingsByText.get(bareText) ?? embeddingsByText.get(content) ?? null

    await db.observation.push({
      entityId: legacy.id,
      content,
      embedding,
      source: 'migrated',
    })
    migrated++
  }

  return { success: true, migrated, entity: legacy.name }
}
