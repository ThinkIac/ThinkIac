export const AGENT_PROFILE_PROTOCOL = 'thinkiac.agent-profile/v1'
const providers = new Map()

export function normalizeAgentProfile(profile, source = null) {
  if (!profile || typeof profile !== 'object' || !profile.id || !profile.name) return null
  return Object.freeze({
    protocol: AGENT_PROFILE_PROTOCOL, id: String(profile.id), name: String(profile.name),
    description: profile.description ?? null, system: profile.system ?? null,
    tools: profile.tools === null ? null : Array.isArray(profile.tools) ? [...new Set(profile.tools.filter(Boolean))] : null,
    provider: profile.provider ?? null, model: profile.model ?? null,
    fallbackModel: profile.fallbackModel ?? null,
    maxSteps: Number.isFinite(profile.maxSteps) ? profile.maxSteps : null,
    outputSchema: profile.outputSchema && typeof profile.outputSchema === 'object' ? profile.outputSchema : null,
    source: profile.source ?? source ?? null,
  })
}

export function registerAgentProfileProvider(name, provider) {
  if (!name || typeof provider?.listAgentProfiles !== 'function' || typeof provider?.getAgentProfile !== 'function') throw new TypeError('AgentProfileProviderV1 inválido')
  providers.set(String(name), provider)
  return () => providers.delete(String(name))
}

export async function listAgentProfiles() {
  const result = []
  for (const [name, provider] of providers) {
    try {
      for (const profile of await provider.listAgentProfiles()) {
        const normalized = normalizeAgentProfile(profile, { package: name })
        if (normalized) result.push(normalized)
      }
    } catch { /* provider opcional isolado */ }
  }
  return result
}

export async function getAgentProfile(packageName, id) {
  const provider = providers.get(String(packageName))
  return provider ? normalizeAgentProfile(await provider.getAgentProfile(id), { package: String(packageName) }) : null
}
