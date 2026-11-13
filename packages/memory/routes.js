// memory/routes.js
// Rotas somente-leitura para inspeção do grafo (debug/dashboard futuro).
// Reaproveita tools.js — não duplica lógica de query.

import { memoryRecall, memoryStatus } from './tools.js'
import { db } from './lib/db.js'

export async function routerEntities(req, res) {
  /**
   * @register_router api/entities
   * @method GET
   */
  const entities = db.entity.query({}, { sort: 'updatedAt DESC', limit: 200 })
  return {
    data: entities.map(e => ({
      id: e.id,
      name: e.name,
      type: e.type,
      summary: e.summary,
      accessCount: e.accessCount,
      updatedAt: e.updatedAt,
    })),
  }
}

export async function routerSearch(req, res) {
  /**
   * @register_router api/search
   * @method GET
   */
  const { q, limit, entity } = req.query
  if (!q) return { status: 400, data: { error: 'q é obrigatório' } }
  return await memoryRecall({ query: q, limit: limit ? Number(limit) : undefined, entity })
}

export async function routerStatus(req, res) {
  /**
   * @register_router api/status
   * @method GET
   */
  return await memoryStatus()
}
