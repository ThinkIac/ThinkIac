/**
 * ContextRefiner — Módulo de refinamento de contexto para o Agent.
 * 
 * Responsável por:
 * 1. Ranquear facts por relevância ao tópico atual (embeddings + fallback bag-of-words)
 * 2. Remover contextos stale (não acessados há N horas)
 * 3. Construir contexto tailored: apenas o que é relevante para a mensagem do usuário
 * 
 * Zero dependências externas — usa apenas o que já existe em llm.js (getEmbedding)
 * e session.js (getSession, getSummaryContext).
 */

import { readFileSync, existsSync } from 'fs'
import { join, resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { getEmbedding } from '../llm/llm.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(PKG_DIR, '..')
const FACTS_FILE = join(AGENT_DIR, 'memory', 'facts.md')


const DEFAULTS = {
  FACTS_TOP_N: 10,           
  CONTEXTS_TOP_N: 5,         
  RELEVANCE_THRESHOLD: 0.15, 
  STALE_TTL_HOURS: 168,      
  MAX_SNAPSHOT_PACKAGES: 8,  
  RECENT_ITERATIONS: 5,      
}



function tokenize(text) {
  return text.toLowerCase()
    .replace(/[^a-z0-9áàâãéêíóôõúçñ\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2)
}

function bowSimilarity(textA, textB) {
  const tokensA = new Set(tokenize(textA))
  const tokensB = new Set(tokenize(textB))
  if (tokensA.size === 0 || tokensB.size === 0) return 0
  let intersection = 0
  for (const t of tokensA) {
    if (tokensB.has(t)) intersection++
  }
  return intersection / Math.sqrt(tokensA.size * tokensB.size)
}



function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0
  let dot = 0, na = 0, nb = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb)
  return denom === 0 ? 0 : dot / denom
}



export class ContextRefiner {
  constructor(options = {}) {
    const { embedder = getEmbedding, ...config } = options
    this.config = { ...DEFAULTS, ...config }
    this.embedder = embedder
    this.embeddingCache = new Map()
  }

  async getCachedEmbedding(text) {
    const key = String(text)
    if (this.embeddingCache.has(key)) return this.embeddingCache.get(key)
    try {
      const embedding = await this.embedder(text)
      this.embeddingCache.set(key, embedding)
      if (this.embeddingCache.size > 200) {
        this.embeddingCache.delete(this.embeddingCache.keys().next().value)
      }
      return embedding
    } catch {
      return null
    }
  }

  /**
   * Score de relevância entre um texto e uma query.
   * Tenta embeddings primeiro, fallback para bag-of-words.
   * 
   * @param {string} text  - Texto do contexto/fact
   * @param {string} query - Query do usuário (tópico atual)
   * @returns {Promise<number>} Score 0..1
   */
  async scoreRelevance(text, query) {
    if (!text || !query) return 0

    
    const [embText, embQuery] = await Promise.all([
      this.getCachedEmbedding(text),
      this.getCachedEmbedding(query),
    ])

    if (embText && embQuery) {
      return cosineSimilarity(embText, embQuery)
    }

    
    return bowSimilarity(text, query)
  }

  /**
   * Remove contextos não acessados há N horas.
   * 
   * @param {Array} contexts - Array de { name, value, lastAccessed, ... }
   * @param {number} ttlHours - TTL em horas (padrão: config.STALE_TTL_HOURS)
   * @returns {{ kept: Array, pruned: Array }}
   */
  pruneStale(contexts, ttlHours = this.config.STALE_TTL_HOURS) {
    if (!Array.isArray(contexts)) return { kept: [], pruned: [] }
    const now = Date.now()
    const ttlMs = ttlHours * 3600 * 1000
    const kept = []
    const pruned = []
    for (const ctx of contexts) {
      const lastAccess = ctx.lastAccessed || ctx.expiresAt || 0
      if (now - lastAccess < ttlMs) {
        kept.push(ctx)
      } else {
        pruned.push(ctx)
      }
    }
    return { kept, pruned }
  }

  /**
   * Remove facts antigas baseado em TTL (dias).
   * Facts com [pin] ou SCHEDULE são sempre preservadas.
   * 
   * @param {string} factsText - Conteúdo completo de facts.md
   * @param {number} ttlDays - Idade máxima em dias (padrão: 7)
   * @returns {{ kept: string, pruned: string[], header: string }}
   */
  pruneStaleFacts(
  factsText,
  ttlDays = Math.floor(
    this.config.STALE_TTL_HOURS / 24
  )
) {
    if (!factsText) return { kept: '', pruned: [], header: '' }

    const lines = factsText.split('\n')
    const header = lines.filter(l => l.startsWith('#') || l.trim() === '').join('\n')
    const bodyLines = lines.filter(l => !l.startsWith('#') && l.trim() !== '')

    const now = Date.now()
    const ttlMs = ttlDays * 24 * 3600 * 1000
    const kept = []
    const pruned = []

    for (const line of bodyLines) {
      
      if (line.includes('[pin]') || line.includes('SCHEDULE |') || line.includes('METACOGNITION')) {
        kept.push(line)
        continue
      }

      
      const tsMatch = line.match(/\[(\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z?)?)\]/)
      if (!tsMatch) {
        
        kept.push(line)
        continue
      }

      const factDate = new Date(tsMatch[1]).getTime()
      if (isNaN(factDate)) {
        kept.push(line)
        continue
      }

      if (now - factDate < ttlMs) {
        kept.push(line)
      } else {
        pruned.push(line)
      }
    }

    const keptText = header + (kept.length ? '\n' + kept.join('\n') : '')
    return { kept: keptText, pruned, header }
  }

  /**
   * Orquestrador principal: constrói contexto tailored para o tópico atual.
   * 
   * @param {Object} sources - { facts: string, summary: string, runtimeContexts: Array }
   * @param {string} activeTopic - Última mensagem do usuário (tópico ativo)
   * @returns {Promise<{ facts: string, summary: string, runtimeContexts: string, pruned: number }>}
   */
  async buildTailoredContext(sources, activeTopic) {
    const { facts = '', summary = '', runtimeContexts = [] } = sources || {}
  
    
    if (!activeTopic || activeTopic.trim().length < 3) {
      return {
        facts,
        summary,
        runtimeContexts: this._formatRuntimeContexts(runtimeContexts),
        pruned: 0,
      }
    }
  
    let totalPruned = 0
  
    
    const { kept: freshFacts, pruned: prunedFacts } =
      this.pruneStaleFacts(facts)
  
    totalPruned += prunedFacts.length
  
    
    const factsLines = freshFacts
      .split('\n')
      .filter(line => line.trim().startsWith('-'))
  
    let selectedFacts = freshFacts
  
    if (factsLines.length > this.config.FACTS_TOP_N) {
      const scored = []
  
      for (const line of factsLines) {
        const text = line.replace(/^- \[.*?\]\s*/, '').trim()
  
        if (!text) continue
  
        
        if (
          text.includes('SCHEDULE |') ||
          text.includes('METACOGNITION')
        ) {
          scored.push({
            line,
            score: 1,
            pinned: true,
          })
          continue
        }
  
        const score = await this.scoreRelevance(
          text,
          activeTopic
        )
  
        scored.push({
          line,
          score,
          pinned: false,
        })
      }
  
      const pinned = scored.filter(s => s.pinned)
  
      const ranked = scored
        .filter(
          s =>
            !s.pinned &&
            s.score >= this.config.RELEVANCE_THRESHOLD
        )
        .sort((a, b) => b.score - a.score)
        .slice(0, this.config.FACTS_TOP_N)
  
      totalPruned +=
        factsLines.length -
        pinned.length -
        ranked.length
  
      selectedFacts = [...pinned, ...ranked]
        .map(s => s.line)
        .join('\n')
    }
  
    
    const {
      kept: freshContexts,
      pruned: staleContexts,
    } = this.pruneStale(runtimeContexts)
  
    totalPruned += staleContexts.length
  
    
    let selectedContexts = freshContexts
  
    if (
      freshContexts.length >
      this.config.CONTEXTS_TOP_N
    ) {
      const scored = []
  
      for (const ctx of freshContexts) {
        const text =
          typeof ctx === 'string'
            ? ctx
            : (ctx.value || ctx.name || '')
  
        const score = await this.scoreRelevance(
          text,
          activeTopic
        )
  
        scored.push({ ctx, score })
      }
  
      scored.sort((a, b) => b.score - a.score)
  
      const top = scored.slice(
        0,
        this.config.CONTEXTS_TOP_N
      )
  
      totalPruned +=
        freshContexts.length - top.length
  
      selectedContexts = top.map(s => s.ctx)
    }
  
    
    let selectedSummary = summary
  
    if (summary && summary.length > 200) {
      const summaryScore =
        await this.scoreRelevance(
          summary.slice(0, 500),
          activeTopic
        )
  
      const factsCoverage = selectedFacts
        .split('\n')
        .filter(line => line.trim().startsWith('-'))
        .length
  
      if (
        summaryScore < 0.1 &&
        factsCoverage > 5
      ) {
        selectedSummary =
          summary.slice(0, 300) +
          '\n[...truncado pelo refiner...]'
  
        totalPruned++
      }
    }
  
    return {
      facts: selectedFacts,
      summary: selectedSummary,
      runtimeContexts:
        this._formatRuntimeContexts(
          selectedContexts
        ),
      pruned: totalPruned,
    }
  }

  _formatRuntimeContexts(contexts) {
    if (!contexts || !contexts.length) return ''
    return contexts.map(ctx => {
      if (typeof ctx === 'string') return ctx
      if (ctx.name && ctx.value) return `[Context: ${ctx.name}] ${ctx.value}`
      return String(ctx)
    }).join('\n')
  }
}



export const contextRefiner = new ContextRefiner()
