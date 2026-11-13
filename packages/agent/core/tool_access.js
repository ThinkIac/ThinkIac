const DEFAULT_TTL_MS = 15 * 60 * 1000
const DEFAULT_MAX_USES = 32
const grants = new Map()

const NEVER_GRANT = new Set([
  'request_tool_access', 'resolveGovernanceConfirmation', 'setGovernancePolicy',
  'evaluateGovernanceAction', 'delete_tool', 'create_runtime_package',
])

const cleanNames = (names = []) => [...new Set(names.map(name => String(name || '').trim()).filter(Boolean))]

function activeGrant(sessionId, now = Date.now()) {
  const grant = grants.get(sessionId)
  if (!grant) return null
  if (grant.expiresAt <= now || grant.remainingUses <= 0) {
    grants.delete(sessionId)
    return null
  }
  return grant
}

export function grantToolAccess({ sessionId, toolNames, reason, catalogNames, ttlMs = DEFAULT_TTL_MS, maxUses = DEFAULT_MAX_USES } = {}) {
  if (!sessionId || sessionId === 'unknown') throw new Error('Sessão rastreável é obrigatória para expandir tools.')
  const catalog = new Set(catalogNames || [])
  const requested = cleanNames(toolNames)
  if (!requested.length) throw new Error('Informe ao menos uma tool específica para expandir o acesso.')
  const forbidden = requested.filter(name => NEVER_GRANT.has(name))
  if (forbidden.length) throw new Error(`Estas tools não podem ser concedidas dinamicamente: ${forbidden.join(', ')}`)
  const unknown = requested.filter(name => !catalog.has(name))
  if (unknown.length) throw new Error(`Tools inexistentes no catálogo atual: ${unknown.join(', ')}`)
  const now = Date.now()
  const previous = activeGrant(sessionId, now)
  const grant = {
    sessionId,
    toolNames: cleanNames([...(previous?.toolNames || []), ...requested]),
    reason: String(reason || '').slice(0, 500),
    grantedAt: now,
    expiresAt: now + Math.max(1_000, Math.min(Number(ttlMs) || DEFAULT_TTL_MS, DEFAULT_TTL_MS)),
    remainingUses: Math.max(1, Math.min(Number(maxUses) || DEFAULT_MAX_USES, DEFAULT_MAX_USES)),
  }
  grants.set(sessionId, grant)
  return { ...grant, ttlMs: grant.expiresAt - now }
}

export function getGrantedToolNames(sessionId, now = Date.now()) {
  return activeGrant(sessionId, now)?.toolNames.slice() || []
}

export function consumeGrantedTool(sessionId, toolName, now = Date.now()) {
  const grant = activeGrant(sessionId, now)
  if (!grant || !grant.toolNames.includes(toolName)) return false
  grant.remainingUses--
  if (grant.remainingUses <= 0) grants.delete(sessionId)
  return true
}

export function extendAllowlist(allowlist, sessionId, now = Date.now()) {
  if (!allowlist) return allowlist
  return cleanNames([...allowlist, ...getGrantedToolNames(sessionId, now), 'request_tool_access'])
}

export function clearToolAccess(sessionId) { grants.delete(sessionId) }
export const __toolAccessTest = { grants, NEVER_GRANT }
