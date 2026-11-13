export const DEFAULT_AGENT_ID = 'agent'

const AGENTS = Object.freeze([
  Object.freeze({
    id: 'agent',
    name: 'Agent',
    description: 'ThinkIac operational agent',
    available: true,
    capabilities: ['sessions', 'streaming', 'attachments', 'voice', 'workspace'],
  }),
  Object.freeze({
    id: 'scriba',
    name: 'Scriba',
    description: 'Composable, auditable agent runtime',
    available: true,
    capabilities: ['sessions', 'streaming', 'tools', 'approvals'],
  }),
])

export function getAgentCatalog() {
  return AGENTS.map((agent) => ({ ...agent, capabilities: [...agent.capabilities] }))
}

export function getAgent(id) {
  return AGENTS.find((agent) => agent.id === id) ?? null
}

export function resolveAgent(id) {
  const requested = getAgent(id)
  if (requested?.available) return requested
  return getAgent(DEFAULT_AGENT_ID)
}

function sessionKey(sessionId) {
  return `thinkiac:shell:agent:${String(sessionId || 'default')}`
}

// O chat usa sempre Agent. Preferências legadas não mudam o fluxo.
export function readSessionAgent(storage, sessionId) {
  return DEFAULT_AGENT_ID
}

export function writeSessionAgent(storage, sessionId, agentId) {
  try {
    storage?.setItem?.(sessionKey(sessionId), DEFAULT_AGENT_ID)
  } catch {
    // Storage indisponível não impede a conversa.
  }
  return DEFAULT_AGENT_ID
}
