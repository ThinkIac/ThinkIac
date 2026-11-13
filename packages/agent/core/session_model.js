import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const FILE = join(dirname(fileURLToPath(import.meta.url)), '..', 'memory', 'session_models.json')
let cache = null

function load() {
  if (cache) return cache
  try { cache = existsSync(FILE) ? JSON.parse(readFileSync(FILE, 'utf8')) : {} } catch { cache = {} }
  return cache
}

function save() {
  try { mkdirSync(dirname(FILE), { recursive: true }); writeFileSync(FILE, JSON.stringify(cache, null, 2), 'utf8') } catch {}
}

export function getModelOverride(sessionId) { return load()[sessionId] ?? null }
export function setModelOverride(sessionId, model) {
  if (!sessionId) throw new Error('sessionId é obrigatório')
  if (model && model !== 'auto') load()[sessionId] = String(model)
  else delete load()[sessionId]
  save()
  return getModelOverride(sessionId)
}
