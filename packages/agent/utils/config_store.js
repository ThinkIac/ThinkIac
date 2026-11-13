import { readFileSync, writeFileSync, renameSync, unlinkSync, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'

export function normalizeConfig(config, warn = console.warn) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('[Agent] configuração deve ser um objeto')
  const result = structuredClone(config)
  const pools = result.llm?.pools
  if (pools === undefined) return result
  if (!Array.isArray(pools)) throw new Error('[Agent] llm.pools deve ser um array')
  pools.forEach((pool, index) => {
    const path = `llm.pools[${index}].enabled`
    if (!pool || typeof pool !== 'object' || Array.isArray(pool)) throw new Error(`[Agent] llm.pools[${index}] deve ser um objeto`)
    if (!Object.hasOwn(pool, 'enabled')) return
    if (typeof pool.enabled === 'boolean') return
    if (pool.enabled === 'true' || pool.enabled === 'false') {
      pool.enabled = pool.enabled === 'true'
      warn(`[Agent] ${path}: string legada convertida para booleano`)
      return
    }
    throw new Error(`[Agent] ${path} deve ser booleano`)
  })
  return result
}

export function createConfigStore(file, { warn = console.warn, rename = renameSync } = {}) {
  let cached = null
  let dirty = true
  return {
    clear() { dirty = true },
    get() {
      if (!dirty && cached) return structuredClone(cached)
      try {
        cached = normalizeConfig(JSON.parse(readFileSync(file, 'utf8')), warn)
        dirty = false
      } catch (error) {
        if (!cached) throw error
        
        warn('[Agent] recarga recusada; última configuração válida preservada')
      }
      return structuredClone(cached)
    },
    save(config) {
      const normalized = normalizeConfig(config, warn)
      const temporary = `${file}.${randomUUID()}.tmp`
      try {
        let mode = 0o600
        try { mode = statSync(file).mode & 0o777 } catch (error) { if (error.code !== 'ENOENT') throw error }
        writeFileSync(temporary, JSON.stringify(normalized, null, 2), { encoding: 'utf8', mode, flag: 'wx' })
        rename(temporary, file)
      } finally {
        try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
      }
      cached = normalized
      dirty = false
      return structuredClone(normalized)
    },
  }
}
