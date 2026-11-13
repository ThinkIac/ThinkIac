import { getSpecialistById, listCatalog, updateCustomSpecialist } from './catalog.js'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
// O pacote npm chamado "inflect" foi removido do registry que construía a
// imagem. Mantemos o pequeno renderizador que já era usado pelos gatilhos
// junto do consumidor, em vez de depender de uma resolução não reproduzível.
const { renderTemplate } = require('./template.cjs')
const recentEvents = []
const running = new Set()

// O hook `@register_hook *` recebe o padrão registrado em `matchedEvent`, e não
// o nome real que passou pelo bus. Por isso ele não serve para descobrir eventos
// em tempo de execução. Assim como o Flows, observamos a instância do bus antes
// do dispatch, sem alterar payloads nem atrasar a operação original.
const TAP = (globalThis.__specialistsEventTap = globalThis.__specialistsEventTap || {
  installed: false,
  bus: null,
  capture: null,
  source: null,
  installedAt: null,
  lastEventAt: null,
})

const IGNORED_EVENT_PREFIXES = [
  'llm:', 'http:', 'runtime:', 'package:', 'reload:', 'db:', 'views:',
  'proc:', 'route:', 'auth:', 'bag:', 'save:',
]
const MAX_RECENT_EVENTS = 120

function matches(pattern, event) {
  if (!pattern || !event) return false
  if (pattern === '*' || pattern === event) return true
  if (pattern.endsWith(':*')) return event.startsWith(pattern.slice(0, -2) + ':')
  if (pattern.startsWith('*:')) return event.endsWith(':' + pattern.slice(2))
  return false
}

function compactPayload(payload) {
  try { return JSON.parse(JSON.stringify(payload ?? null)) } catch { return String(payload ?? '') }
}

export function listRecentEvents() {
  return recentEvents.slice().reverse()
}

export function getEventObserverStatus() {
  return {
    installed: TAP.installed,
    source: TAP.source,
    installedAt: TAP.installedAt,
    lastEventAt: TAP.lastEventAt,
    captured: recentEvents.length,
  }
}

function shouldCapture(eventName) {
  return typeof eventName === 'string'
    && eventName.length > 0
    && eventName !== '*'
    && !IGNORED_EVENT_PREFIXES.some(prefix => eventName.startsWith(prefix))
}

/** Instala uma única observação passiva do bus para toda a vida do Runtime. */
export function installEventTap(bus) {
  if (!bus || TAP.bus === bus && TAP.installed) return TAP.installed
  if (!bus || TAP.installed) return false

  // EventBus entrega o nome concreto em context.event ao wildcard. É a via
  // preferida pois não altera o bus e acompanha emit e pipeline.
  if (typeof bus.on === 'function') {
    bus.on('*', (payload, context = {}) => {
      try { TAP.capture?.(context.event, payload) } catch { /* observação passiva */ }
    }, { owner: 'specialists', operation: 'subscribe', priority: Number.MAX_SAFE_INTEGER })
    TAP.bus = bus
    TAP.installed = true
    TAP.source = 'assinatura do bus'
    TAP.installedAt = new Date().toISOString()
    return true
  }

  // Compatibilidade com adapters antigos sem subscribe.
  for (const method of ['emit', 'pipeline', 'veto']) {
    if (typeof bus[method] !== 'function') continue
    const original = bus[method].bind(bus)
    bus[method] = function specialistEventTap(eventName, payload, context) {
      try { TAP.capture?.(eventName, payload) } catch { /* observar jamais afeta o bus */ }
      return original(eventName, payload, context)
    }
  }
  TAP.bus = bus
  TAP.installed = true
  TAP.source = 'wrapper do bus (compatibilidade)'
  TAP.installedAt = new Date().toISOString()
  return true
}

export function getSpecialistTrigger(id) {
  return getSpecialistById(id)?.trigger ?? null
}

export function setSpecialistTrigger(id, trigger) {
  const normalized = trigger && typeof trigger === 'object' && trigger.event
    ? {
        event: String(trigger.event).trim(),
        prompt: String(trigger.prompt ?? '').trim(),
        messageTemplate: String(trigger.messageTemplate ?? 'Evento {{eventName}} recebido. Analise o payload abaixo e aja conforme seu papel.').trim(),
        sessionId: String(trigger.sessionId ?? 'event-trigger').trim() || 'event-trigger',
        enabled: trigger.enabled !== false,
      }
    : null
  updateCustomSpecialist(id, { trigger: normalized })
  return normalized
}

export async function handleObservedEvent(eventName, payload) {
  if (!shouldCapture(eventName)) return
  TAP.lastEventAt = new Date().toISOString()
  const entry = { id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, event: eventName, payload: compactPayload(payload), timestamp: new Date().toISOString() }
  recentEvents.push(entry)
  while (recentEvents.length > MAX_RECENT_EVENTS) recentEvents.shift()

  const candidates = listCatalog().filter(item => item.kind === 'custom')
  for (const item of candidates) {
    const specialist = getSpecialistById(item.id)
    const trigger = specialist?.trigger
    if (!trigger?.enabled || !matches(trigger.event, eventName) || running.has(item.id)) continue
    running.add(item.id)
    void activate(specialist, trigger, entry).finally(() => running.delete(item.id))
  }
}

// O ponteiro global é atualizado a cada hot reload, evitando que o wrapper do
// bus fique preso a uma versão anterior deste módulo.
TAP.capture = (eventName, payload) => {
  // A observação não pode criar uma rejeição não tratada se um storage opcional
  // ainda não estiver pronto durante o boot.
  void handleObservedEvent(eventName, payload).catch(() => {})
}

async function activate(specialist, trigger, entry) {
  const context = {
    eventName: entry.event,
    event: entry,
    payload: entry.payload,
    history: listRecentEvents(),
    sessionId: trigger.sessionId,
    timestamp: entry.timestamp,
    specialist: { id: specialist.id, name: specialist.name },
  }
  const message = renderTemplate(trigger.messageTemplate, context)
  const extraSystemPrompt = trigger.prompt ? renderTemplate(trigger.prompt, context) : ''
  try {
    const { runAgent } = await import('../../agent/core/agent.js')
    await runAgent(message, trigger.sessionId, null, null, {
      promptBlock: extraSystemPrompt
        ? `## Event activation\n${extraSystemPrompt}\n\nEvent context:\n${JSON.stringify(context, null, 2)}`
        : `## Event context\n${JSON.stringify(context, null, 2)}`,
      messageMetadata: { specialistTrigger: { specialistId: specialist.id, event: entry.event } },
      specialistId: specialist.id,
    })
  } catch (error) {
    console.warn(`[Specialists] Event activation failed for ${specialist.name}:`, error.message)
  }
}
