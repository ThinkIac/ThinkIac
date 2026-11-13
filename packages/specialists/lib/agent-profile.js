import { listCatalog, getSpecialistById, composePrompt } from './catalog.js'

export function toAgentProfile(resolved) {
  if (!resolved) return null
  return {
    protocol: 'thinkiac.agent-profile/v1', id: resolved.id, name: resolved.name,
    description: resolved.description ?? null, system: composePrompt(resolved) || null,
    tools: resolved.toolsAllowlist ?? null, provider: resolved.provider ?? null,
    model: resolved.model ?? null, fallbackModel: resolved.fallbackModel ?? null,
    maxSteps: null, outputSchema: null,
    source: { package: 'specialists', revision: resolved.updatedAt ?? null },
  }
}

export const agentProfileProvider = {
  async listAgentProfiles() { return listCatalog().map(item => toAgentProfile(getSpecialistById(item.id))).filter(Boolean) },
  async getAgentProfile(id) { return toAgentProfile(getSpecialistById(id)) },
}
