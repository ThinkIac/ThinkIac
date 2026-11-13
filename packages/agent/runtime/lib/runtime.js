/** Núcleo portátil: agentes recebem um adapter do host, nunca o importam. */
export const AGENT_EVENT_TYPES = Object.freeze([
  'agent.session.updated', 'agent.run.started', 'agent.run.delta', 'agent.run.step',
  'agent.run.permission_requested', 'agent.run.completed', 'agent.run.failed',
])

/**
 * Portas que um agente pode pedir ao ambiente onde roda. O contrato não sabe
 * se o host é Logos, um servidor HTTP próprio ou um runner de testes.
 */
const NOOP = () => undefined
const REJECT = (name) => () => Promise.reject(new Error(`AgentHost não fornece a porta ${name}`))

export function createAgentHost(ports = {}) {
  return Object.freeze({
    events: Object.freeze({ call: ports.events?.call ?? REJECT('events.call') }),
    sockets: Object.freeze({
      broadcast: ports.sockets?.broadcast ?? NOOP,
      onMessage: ports.sockets?.onMessage ?? NOOP,
      pushToSession: ports.sockets?.pushToSession ?? NOOP,
    }),
    storage: Object.freeze({ getProxy: ports.storage?.getProxy ?? REJECT('storage.getProxy') }),
  })
}

let defaultHost = createAgentHost()
export function setDefaultAgentHost(host) { defaultHost = createAgentHost(host); return defaultHost }
export function getDefaultAgentHost() { return defaultHost }

function ensureDefinition(definition) {
  if (!definition || typeof definition.id !== 'string' || !definition.id.trim()) throw new TypeError('AgentDefinition exige um id não vazio')
  if (!definition.adapter || typeof definition.adapter.request !== 'function') throw new TypeError(`AgentDefinition ${definition.id} exige um adapter.request()`)
  return Object.freeze({ ...definition, id: definition.id.trim(), capabilities: Object.freeze([...(definition.capabilities ?? definition.adapter.capabilities ?? [])]) })
}

export function normalizeAgentEvent(agentId, message) {
  const event = message?.event
  const type = event === 'start' ? 'agent.run.started'
    : event === 'token' || event === 'reasoning' ? 'agent.run.delta'
      : event === 'step' ? 'agent.run.step'
        : event === 'done' ? 'agent.run.completed'
          : event === 'error' ? 'agent.run.failed'
            : message?.type === 'sessions:updated' ? 'agent.session.updated' : null
  return { agentId, type, message }
}

export class AgentRegistry {
  #definitions = new Map()
  #defaultAgentId = null
  constructor({ definitions = [], defaultAgentId } = {}) {
    for (const definition of definitions) this.register(definition)
    this.#defaultAgentId = this.#definitions.has(defaultAgentId) ? defaultAgentId : this.#definitions.keys().next().value ?? null
  }
  register(definition) {
    const next = ensureDefinition(definition)
    if (this.#definitions.has(next.id)) throw new Error(`Agente duplicado: ${next.id}`)
    this.#definitions.set(next.id, next)
    if (!this.#defaultAgentId) this.#defaultAgentId = next.id
    return next
  }
  get defaultAgentId() { return this.#defaultAgentId }
  get(id) { return this.#definitions.get(id) ?? null }
  resolve(id) { return this.get(id) ?? this.get(this.#defaultAgentId) }
  list() { return [...this.#definitions.values()].map(({ adapter, ...definition }) => ({ ...definition, capabilities: [...definition.capabilities] })) }
}

export function createAgentRuntime({ definitions = [], defaultAgentId } = {}) {
  const registry = new AgentRegistry({ definitions, defaultAgentId })
  let activeAgentId = registry.defaultAgentId
  let subscriptions = []
  const handlers = new Set(); const reopenHandlers = new Set(); const commandHandlers = new Set()
  for (const definition of definitions) {
    const adapter = registry.get(definition.id)?.adapter
    adapter.on?.((message) => { for (const handler of handlers) handler(normalizeAgentEvent(definition.id, message)) })
    adapter.onReopen?.(() => { for (const handler of reopenHandlers) handler(definition.id) })
    adapter.onCommand?.((command) => { for (const handler of commandHandlers) handler({ agentId: definition.id, command }) })
  }
  const selected = () => registry.resolve(activeAgentId)
  const adapterFor = (id) => registry.resolve(id)?.adapter
  return Object.freeze({
    registry,
    activateAgent(id) { const resolved = registry.resolve(id); if (!resolved) return null; activeAgentId = resolved.id; resolved.adapter.subscribe?.(subscriptions); resolved.adapter.connect?.(); return activeAgentId },
    currentAgentId: () => activeAgentId,
    capabilities: () => [...(selected()?.capabilities ?? [])],
    hasCapability: (capability) => (selected()?.capabilities ?? []).includes(capability),
    request: (path, options) => selected()?.adapter.request(path, options),
    requestForAgent: (id, path, options) => adapterFor(id)?.request(path, options),
    resourceUrl: (path) => selected()?.adapter.resourceUrl(path),
    connect: (...args) => selected()?.adapter.connect?.(...args),
    connectAll: (...args) => {
      for (const definition of definitions) registry.get(definition.id)?.adapter.connect?.(...args)
    },
    send: (...args) => selected()?.adapter.send?.(...args) ?? false,
    subscribe(sessionIds) { subscriptions = [...new Set((sessionIds ?? []).filter(Boolean))]; return selected()?.adapter.subscribe?.(subscriptions) },
    subscribeAll(sessionIds) {
      subscriptions = [...new Set((sessionIds ?? []).filter(Boolean))]
      for (const definition of definitions) registry.get(definition.id)?.adapter.subscribe?.(subscriptions)
    },
    on: (handler) => { handlers.add(handler); return () => handlers.delete(handler) },
    onReopen: (handler) => { reopenHandlers.add(handler); return () => reopenHandlers.delete(handler) },
    onCommand: (handler) => { commandHandlers.add(handler); return () => commandHandlers.delete(handler) },
    setUiState: (...args) => selected()?.adapter.setUiState?.(...args),
    sendSnapshot: (...args) => selected()?.adapter.sendSnapshot?.(...args),
    isReady: () => selected()?.adapter.isReady?.() ?? false,
  })
}
