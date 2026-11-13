import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const PROFILE_ROOT = new URL('../../terminal/profiles/', import.meta.url).pathname

function accessFor(model) {
  const id = String(model?.slug || '').trim()
  if (!id) return null
  return {
    id,
    model: id,
    name: String(model.display_name || id),
    provider: 'codex-cli',
    enabled: true,
    authenticated: true,
    available: true,
    metadata: { poolName: 'codex-cli', poolLabel: 'Codex CLI' },
    purpose: { name: 'Codex CLI', description: String(model.description || '') },
  }
}

function cachedModels(source) {
  try {
    const cached = JSON.parse(readFileSync(source, 'utf8'))
    return Array.isArray(cached?.models) ? cached.models : []
  } catch {
    return []
  }
}

/**
 * O Codex CLI mantém o catálogo entregue para cada perfil em
 * ~/.codex/models_cache.json. A UI do Shell usa o contrato `catalog.accesses`
 * de Agent; adaptamos o cache para esse contrato sem inventar modelos.
 */
export function getCodexModelCatalog(profilesDir = PROFILE_ROOT) {
  if (!existsSync(profilesDir)) return { accesses: [] }
  const byId = new Map()
  for (const profile of readdirSync(profilesDir, { withFileTypes: true })) {
    if (!profile.isDirectory() || profile.name.startsWith('.')) continue
    try {
      const source = join(profilesDir, profile.name, '.codex', 'models_cache.json')
      for (const model of cachedModels(source)) {
        const access = accessFor(model)
        if (access && !byId.has(access.id)) byId.set(access.id, access)
      }
    } catch {
      // Um perfil sem login/cache não deve impedir que os demais apareçam.
    }
  }
  return { accesses: [...byId.values()] }
}

/**
 * Localiza uma sessão autenticada do CLI sem abrir nem expor auth.json.
 * Quando há modelo fixado, dá preferência ao perfil cujo cache o anunciou:
 * isso mantém catálogo, modelo e credencial no mesmo contexto do Terminal.
 */
export function getCodexCliProfile(profilesDir = PROFILE_ROOT, model = null) {
  if (!existsSync(profilesDir)) return null
  let profiles
  try { profiles = readdirSync(profilesDir, { withFileTypes: true }) } catch { return null }

  const candidates = profiles
    .filter(profile => profile.isDirectory() && !profile.name.startsWith('.'))
    .map(profile => {
      const home = join(profilesDir, profile.name)
      const configDir = join(home, '.codex')
      return { home, configDir, models: cachedModels(join(configDir, 'models_cache.json')) }
    })
    .filter(profile => existsSync(join(profile.configDir, 'auth.json')))

  if (!candidates.length) return null
  const requested = String(model || '').trim()
  return candidates.find(profile => profile.models.some(item => item?.slug === requested)) ?? candidates[0]
}
