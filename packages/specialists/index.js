// packages/specialists/index.js — catálogo e construtor de especialistas do Runtime.
//
// Especialista = prompt (próprio e/ou composto de AGENT.md de outros pacotes)
// + allowlist de tools + provider/modelo, resolvido e injetado por sessão no
// ciclo do agente (ver aurora/core/agent.js). Funciona sozinho — não depende
// de Projects nem de nenhum outro pacote além do runtime.

import {
  listCatalog, getSpecialistById, createCustomSpecialist, updateCustomSpecialist,
  deleteCustomSpecialist, composePrompt, previewPrompt,
} from './lib/catalog.js'
import { discoverAgentFiles } from './lib/discovery.js'
import {
  getSessionSpecialistId, setSessionSpecialistId, resolveSessionSpecialist,
} from './lib/session.js'
import { agentProfileProvider } from './lib/agent-profile.js'
import { assertSurface } from '../ui-schema/index.js'

try {
  const profiles = await import('../agent/runtime/index.js')
  globalThis.__specialistsAgentProfilesOff?.()
  globalThis.__specialistsAgentProfilesOff = profiles.registerAgentProfileProvider('specialists', agentProfileProvider)
} catch { /* integração opcional */ }

function serializeSpecialist(resolved) {
  if (!resolved) return null
  return {
    id: resolved.id,
    kind: resolved.kind,
    name: resolved.name,
    description: resolved.description ?? null,
    prompt: resolved.ownPrompt ?? null,
    agents: (resolved.composedAgents || []).map(a => a.pkg).filter(Boolean),
    tools: resolved.toolsAllowlist ?? null,
    provider: resolved.provider ?? null,
    model: resolved.model ?? null,
    fallbackModel: resolved.fallbackModel ?? null,
    composedPrompt: composePrompt(resolved),
  }
}

function requireCustom(id) {
  if (id.startsWith('pkg:')) {
    throw new Error('Especialistas genéricos (um por pacote) não podem ser editados ou removidos por aqui — edite o AGENT.md do pacote.')
  }
}

// ── Tools (LLM / MCP) ────────────────────────────────────────────────────

/**
 * @register_tool listSpecialists
 * @description Lista o catálogo de especialistas: genéricos (um por pacote com AGENT.md, somente leitura) e personalizados (CRUD).
 */
export function listSpecialists() {
  return { specialists: listCatalog() }
}

/**
 * @register_tool getSpecialist
 * @description Detalha um especialista do catálogo com o prompt já composto (genérico ou personalizado).
 * @param {string} id - id do catálogo (ex.: "pkg:ntfy" ou o uuid de um especialista personalizado)
 */
export function getSpecialist({ id }) {
  const resolved = getSpecialistById(id)
  if (!resolved) throw new Error(`Especialista "${id}" não encontrado`)
  return serializeSpecialist(resolved)
}

/**
 * @register_tool listComposableAgents
 * @description Lista os AGENT.md de pacotes disponíveis pra compor um especialista personalizado.
 */
export function listComposableAgents() {
  return {
    agents: discoverAgentFiles({ includeRoot: false }).map(f => ({
      pkg: f.pkg, name: f.name, description: f.description || null,
    })),
  }
}

/**
 * @register_tool previewSpecialistPrompt
 * @description Pré-visualiza o prompt composto de um rascunho (prompt próprio + AGENT.md escolhidos, na ordem dada) sem salvar nada.
 * @param {string?} prompt - instruções próprias (texto livre)
 * @param {string[]?} agents - nomes de pacote a compor, na ordem desejada
 */
export function previewSpecialistPrompt({ prompt = null, agents = [] } = {}) {
  return { composedPrompt: previewPrompt({ prompt, agents }) }
}

/**
 * @register_tool createSpecialist
 * @description Cria um especialista personalizado: prompt próprio, composição de AGENT.md, allowlist de tools e provider/modelo com fallback.
 * @param {string} name - nome do especialista
 * @param {string?} description - descrição curta
 * @param {string?} prompt - instruções próprias (texto livre)
 * @param {string[]?} agents - nomes de pacote a compor, na ordem desejada (ver listComposableAgents)
 * @param {string[]?} tools - allowlist exata de nomes de tool; omitido/null = sem restrição
 * @param {string?} provider - provider explícito (ex.: "anthropic", "openrouter")
 * @param {string?} model - modelo explícito
 * @param {string?} fallbackModel - modelo usado se o primário falhar
 */
export function createSpecialist(data = {}) {
  const { trigger: _legacyTrigger, ...specialist } = data
  const created = createCustomSpecialist(specialist)
  return serializeSpecialist(getSpecialistById(created.id))
}

/**
 * @register_tool updateSpecialist
 * @description Atualiza um especialista personalizado existente. Só campos enviados são alterados.
 * @param {string} id - uuid do especialista personalizado
 * @param {string?} name - novo nome
 * @param {string?} description - nova descrição
 * @param {string?} prompt - novas instruções próprias
 * @param {string[]?} agents - nova composição de AGENT.md, na ordem desejada
 * @param {string[]?} tools - nova allowlist de tools; envie null explicitamente pra remover a restrição
 * @param {string?} provider - novo provider explícito
 * @param {string?} model - novo modelo explícito
 * @param {string?} fallbackModel - novo modelo de fallback
 */
export function updateSpecialist({ id, ...changes }) {
  requireCustom(id)
  const { trigger: _legacyTrigger, ...specialist } = changes
  updateCustomSpecialist(id, specialist)
  return serializeSpecialist(getSpecialistById(id))
}

/**
 * @register_tool deleteSpecialist
 * @description Remove um especialista personalizado. Sessões que o tinham fixado voltam automaticamente a "sem especialista" no próximo turno.
 * @param {string} id - uuid do especialista personalizado
 */
export function deleteSpecialist({ id }) {
  requireCustom(id)
  return deleteCustomSpecialist(id)
}

/**
 * @register_tool setSessionSpecialist
 * @description Fixa (ou limpa, com id vazio/"none") o especialista de uma sessão. Enquanto fixado, TODA a sessão usa o prompt/tools/modelo dele.
 * @param {string} session_id - id da sessão
 * @param {string?} specialist_id - id do catálogo, ou "none"/vazio pra limpar
 */
export function setSessionSpecialist({ session_id, specialist_id = null }) {
  if (specialist_id && specialist_id !== 'none' && !getSpecialistById(specialist_id)) {
    throw new Error(`Especialista "${specialist_id}" não encontrado`)
  }
  const value = setSessionSpecialistId(session_id, specialist_id)
  return { sessionId: session_id, specialistId: value }
}

/**
 * @register_tool getSessionSpecialist
 * @description Consulta o especialista fixado numa sessão (ou null, se estiver sem nenhum).
 * @param {string} session_id - id da sessão
 */
export function getSessionSpecialist({ session_id }) {
  const resolved = resolveSessionSpecialist(session_id)
  return { sessionId: session_id, specialist: resolved ? serializeSpecialist(resolved) : null }
}

const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'specialists-catalog',
  eyebrow: 'Agent runtime',
  title: 'Especialistas',
  description: 'Perfis com instruções, AGENT.md, ferramentas e modelos próprios.',
  forms: {
    specialist: { fields: [
      { name: 'name', component: 'input' }, { name: 'description', component: 'input' },
      { name: 'prompt', component: 'textarea' }, { name: 'agents', component: 'select' },
      { name: 'tools', component: 'textarea' }, { name: 'provider', component: 'input' },
      { name: 'model', component: 'input' }, { name: 'fallbackModel', component: 'input' },
    ] },
  },
  actions: {
    'specialists.create': { intent: 'write' }, 'specialists.update': { intent: 'write' },
    'specialists.preview': { intent: 'read' }, 'specialists.remove': { intent: 'destructive' },
  },
})

function systemState() {
  return { specialists: listCatalog(), agents: listComposableAgents().agents }
}

export function systemView() {
  /** @register_router system/view @method GET */
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: systemState() }
}

export function systemAction(req) {
  /** @register_router system/action @method POST */
  const action = String(req.body?.action || '')
  const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}
  try {
    if (action === 'specialists.preview') return { status: 200, state: systemState(), preview: previewSpecialistPrompt(values).composedPrompt }
    if (action === 'specialists.create') createSpecialist(values)
    else if (action === 'specialists.update') updateSpecialist(values)
    else if (action === 'specialists.remove') deleteSpecialist(values)
    else return { status: 404, mensagem: 'Ação de Especialistas não permitida.' }
    return { status: 200, state: systemState(), notice: action === 'specialists.remove' ? 'Especialista removido.' : 'Especialista salvo.' }
  } catch (error) { return { status: 400, mensagem: error.message } }
}

// ── Rotas HTTP (views + InputBar) ─────────────────────────────────────────

// O runtime monta rotas em /<folder>/<path> sempre com UM segmento no meio —
// não existe rota "raiz" de pacote. O path aqui é "catalog" (não o nome do
// próprio pacote) justamente pra não colidir com o folder e não estender pra
// nenhuma leitura estranha.
export function routerListSpecialists(req) {
  /** @register_router catalog
   *  @method GET */
  try { return { data: listSpecialists() } }
  catch (e) { return { status: 500, data: { error: e.message } } }
}

export function routerCreateSpecialist(req) {
  /** @register_router catalog
   *  @method POST */
  try { return { data: createSpecialist(req.body || {}) } }
  catch (e) { return { status: 400, data: { error: e.message } } }
}

export function routerComposableAgents(req) {
  /** @register_router agents
   *  @method GET */
  try { return { data: listComposableAgents() } }
  catch (e) { return { status: 500, data: { error: e.message } } }
}

export function routerPreviewPrompt(req) {
  /** @register_router preview
   *  @method POST */
  try { return { data: previewSpecialistPrompt(req.body || {}) } }
  catch (e) { return { status: 400, data: { error: e.message } } }
}

export function routerSessionSpecialistGet(req) {
  /** @register_router session
   *  @method GET */
  const sessionId = req.query?.session_id || 'default'
  try {
    const resolved = resolveSessionSpecialist(sessionId)
    return { data: { sessionId, specialistId: getSessionSpecialistId(sessionId), specialist: resolved ? serializeSpecialist(resolved) : null } }
  } catch (e) { return { status: 500, data: { error: e.message } } }
}

export function routerSessionSpecialistSet(req) {
  /** @register_router session
   *  @method POST */
  const { session_id = 'default', specialist_id = null } = req.body || {}
  try { return { data: setSessionSpecialist({ session_id, specialist_id }) } }
  catch (e) { return { status: 400, data: { error: e.message } } }
}

export function routerGetSpecialist(req) {
  /** @register_router catalog/:id
   *  @method GET */
  try { return { data: getSpecialist({ id: req.params.id }) } }
  catch (e) { return { status: 404, data: { error: e.message } } }
}

export function routerUpdateSpecialist(req) {
  /** @register_router catalog/:id
   *  @method PATCH */
  try { return { data: updateSpecialist({ id: req.params.id, ...(req.body || {}) }) } }
  catch (e) { return { status: 400, data: { error: e.message } } }
}

export function routerDeleteSpecialist(req) {
  /** @register_router catalog/:id
   *  @method DELETE */
  try { return { data: deleteSpecialist({ id: req.params.id }) } }
  catch (e) { return { status: 400, data: { error: e.message } } }
}
