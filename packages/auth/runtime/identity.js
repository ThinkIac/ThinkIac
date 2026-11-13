/**
 * Contrato pequeno e portável: identidade não conhece Logos, Express, cookies
 * nem o schema de um produto. Providers traduzem suas sessões em Principal.
 */
export function createPrincipal(input = {}) {
  const subject = String(input.subject ?? input.id ?? '').trim()
  if (!subject) throw new TypeError('Principal exige subject')
  return Object.freeze({
    subject,
    type: input.type ?? 'user',
    roles: Object.freeze([...(input.roles ?? (input.role ? [input.role] : []))]),
    capabilities: Object.freeze([...(input.capabilities ?? [])]),
    claims: Object.freeze({ ...(input.claims ?? {}) }),
    sessionId: input.sessionId ?? null,
  })
}

export function attachPrincipal(req, principal, legacyUser = null) {
  if (!req) return principal
  req.principal = principal
  // Compatibilidade transitória para pacotes que ainda leem req.user.
  if (legacyUser) req.user = legacyUser
  return principal
}

/** Provider.resolve(request) retorna { principal, user? } ou null. */
export function createIdentityMiddleware({ provider, isPublic = () => false, onUnauthenticated } = {}) {
  if (!provider || typeof provider.resolve !== 'function') throw new TypeError('IdentityProvider exige resolve(req)')
  return async function identityMiddleware(req, res, next) {
    if (isPublic(req)) return next()
    const resolved = await provider.resolve(req)
    if (!resolved?.principal) return onUnauthenticated
      ? onUnauthenticated(req, res, next)
      : res.status(401).json({ error: 'Credencial ausente ou inválida.' })
    attachPrincipal(req, resolved.principal, resolved.user)
    return next()
  }
}

export function hasCapability(principal, capability) {
  return Boolean(principal?.capabilities?.includes('*') || principal?.capabilities?.includes(capability))
}
