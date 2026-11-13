import { stabilityReceipts } from './core/stability_receipts.js'
import { saveConfig as persistAgentConfig, normalizeConfig } from './utils/config.js'
import {
    existsSync,
    readFileSync
} from 'fs'

import { runAgent, setSessionModel, getSessionModel } from './core/agent.js'
import { listToolSchemas } from './core/registry.js'
import { getSession, clearSession, getSessionWorkspace, setSessionWorkspace } from './memory/session.js'
import { createWorkspaceResolver, resolveWorkspaceSelection, workspaceRootsFromModule } from './core/workspace.js'
import { executeReset, BUILTIN_SCHEMAS } from './core/builtin_tools.js'
import { discoverRuntimeTools } from './core/runtime_bridge.js'
import { resolveProvider } from './llm/provider.js'
import { getFreshModelCatalog, resolveGlobalModelFresh } from './llm/model_registry.js'
import { pushAgentStatus } from './utils/stream.js'
import { clearConfigCache } from './utils/config.js'
import { eventCall as $ } from './host/agent_host.js'
import { describeInferenceCapabilities, runInference } from './inference.js'
import { listMcpProviders, saveMcpProvider, removeMcpProvider, refreshMcpProvider } from './mcp_providers.js'

import { join } from 'path'
import { dirname } from 'path'
import { fileURLToPath } from 'url'
import { createRequire } from 'module'

const require = createRequire(import.meta.url)
const { getProxy } = require('logos')
const { authorize } = require('../auth/permissions.cjs')

const PKG_DIR = join(dirname(fileURLToPath(import.meta.url)), '..')


const workspaceResolver = createWorkspaceResolver(workspaceRootsFromModule(import.meta.url))

export async function inferenceCapabilities(payload = {}) {
    /** @register_hook inference:capabilities */
    const catalog = await getFreshModelCatalog().catch(() => null)
    return { ...payload, inference: describeInferenceCapabilities(catalog) }
}

export async function inferenceRun(payload = {}) {
    /** @register_hook inference:run */
    return runInference(payload, (event, value) => $(event, value))
}





export async function chat(req) {
    /**
     * @register_router chat
     * @method POST
     */
    const { message, session_id = 'default' } = req.body ?? {}
    if (!message) return { status: 400, data: { error: '`message` is required' } }
    try {
        
        await $('agent:message', { message, sessionId: session_id }).catch(() => {});

        const workspace = await resolveWorkspaceSelection(workspaceResolver, getSessionWorkspace(session_id))
        const response = await runAgent(message, session_id, (progress) => {
            pushAgentStatus(session_id, 'running', progress?.label ?? '')
        }, null, { cwd: workspace?.path, messageMetadata: workspace ? { workspace } : undefined })
        
        pushAgentStatus(session_id, 'done', response)
        return { data: { response, session_id } }
    } catch (e) {
        return { status: 500, data: { error: e.message } }
    }
}

export async function sessionWorkspaceGet(req) {
    /**
     * @register_router session/workspace
     * @method GET
     */
    const { session_id = 'default' } = req.query ?? {}
    try { return { data: { workspace: await resolveWorkspaceSelection(workspaceResolver, getSessionWorkspace(session_id)), roots: await workspaceResolver.listRoots() } } }
    catch (e) { return { status: 500, data: { error: e.message } } }
}

export async function sessionWorkspaceSet(req) {
    /**
     * @register_router session/workspace
     * @method POST
     */
    const { session_id = 'default', path = null } = req.body ?? {}
    try {
        const workspace = path ? await workspaceResolver.resolve(path) : null
        return { data: { workspace: setSessionWorkspace(session_id, workspace) } }
    } catch (e) { return { status: 422, data: { error: e.message } } }
}

export async function workspaceBrowse(req) {
    /**
     * @register_router workspaces/browse
     * @method GET
     */
    const { path = null } = req.query ?? {}
    try {
        if (!path) return { data: { roots: await workspaceResolver.listRoots() } }
        return { data: await workspaceResolver.list(path) }
    } catch (e) { return { status: 422, data: { error: e.message } } }
}

export async function sessionModelGet(req) {
    /**
     * @register_router session/model
     * @method GET
    */
    const { session_id = 'default' } = req.query ?? {}
    
    
    
    
    
    
    
    
    try { return { data: { ...getSessionModel(session_id), catalog: await getFreshModelCatalog() } } }
    catch (e) { return { status: 500, data: { error: e.message } } }
}

export function sessionModelSet(req) {
    /**
     * @register_router session/model
     * @method POST
     */
    const { session_id = 'default', model = null } = req.body ?? {}
    try { return { data: setSessionModel(session_id, model) } }
    catch (e) { return { status: 400, data: { error: e.message } } }
}

export async function toolsList(req) {
    /**
     * @register_router tools
     * @method GET
     */
    
    
    
    
    
    
    
    try {
        
        
        const discoveredRuntimeTools = await discoverRuntimeTools()
        const runtimeByName = new Map(discoveredRuntimeTools.map(tool => [tool.name, tool]))
        const runtimeTools = listToolSchemas().filter(t => t.mode !== 'builtin')
        const seen = new Set()
        const tools = [
            ...discoveredRuntimeTools.map(tool => ({
                name: tool.name,
                description: tool.description,
                input_schema: tool.parameters,
                package: tool.package,
                requiredPermission: tool.requiredPermission,
            })),
            ...BUILTIN_SCHEMAS.map(tool => ({
                ...tool,
                package: tool._package ?? runtimeByName.get(tool.name)?.package ?? 'agent',
            })),
            ...runtimeTools.map(tool => ({ ...tool, package: tool.package ?? 'agent' })),
        ].filter(t => {
            
            
            if (seen.has(t.name)) return false
            seen.add(t.name)
            if (!t.requiredPermission) return true
            return authorize({ userId: req.user?.id, permission: t.requiredPermission, database: getProxy('auth') }).allowed
        })
        return { data: { tools } }
    }
    catch (e) { return { data: { tools: [], error: e.message } } }
}

export function sessionGet(req) {
    /**
     * @register_router session
     * @method GET
     */
    const { session_id = 'default' } = req.query ?? {}
    try {
        const s = getSession(session_id)
        return { data: { id: s.id, turns: s.messages.length, has_summary: !!s.summary, created_at: s.created_at } }
    } catch (e) { return { status: 500, data: { error: e.message } } }
}

export async function sessionClear(req) {
    /**
     * @register_router session/clear
     * @method POST
     */
    const { session_id = 'default' } = req.body ?? {}
    try { await clearSession(session_id); return { data: { cleared: session_id } } }
    catch (e) { return { status: 500, data: { error: e.message } } }
}

export async function reset(req) {
    /**
     * @register_router reset
     * @method POST
     */
    const { reason = 'reset via HTTP' } = req.body ?? {}
    const status = await executeReset(reason)
    return { data: { success: true, message: status, restarting: true } }
}

export async function providerGet(req) {
    /**
     * @register_router provider
     * @method GET
     */
    try {
        const r = resolveProvider()
        return { data: { provider: r.provider, model: r.model, embed_model: r.embedModel, base_url: r.baseUrl ?? null } }
    } catch (e) { return { status: 500, data: { error: e.message } } }
}

export async function modelsGet() {
    /**
     * @register_router models
     * @method GET
     */
    return { data: await getFreshModelCatalog() }
}

export async function modelsResolve(req) {
    /**
     * @register_router models/resolve
     * @method POST
     */
    const result = await resolveGlobalModelFresh(req.body ?? {})
    return { status: result.ok ? 200 : 422, data: result }
}

export async function listModels() {
    /**
     * @register_tool listModels
     * @description Lista modelos por acesso com capacidades, estado operacional e evidências atuais.
     */
    
    
    return await getFreshModelCatalog()
}

export async function selectModel({ requires = {}, prefers = {}, policy = {}, override = null } = {}) {
    /**
     * @register_tool selectModel
     * @description Resolve um modelo por requisitos concretos e explica candidatos aceitos e rejeitados.
     * @param {object?} requires - Requisitos obrigatórios de capacidade e operação.
     * @param {object?} prefers - Preferências não obrigatórias.
     * @param {object?} policy - Pesos quality, cost e latency.
     * @param {string?} override - ID modelo@acesso ou modelo explícito.
     */
    return await resolveGlobalModelFresh({ requires, prefers, policy, override })
}

export async function providerSet(req) {
    /**
     * @register_router provider
     * @method POST
     */
    try {
        const { provider, model, base_url, api_key, persist = true } = req.body ?? {}
        if (!provider) return { status: 400, data: { error: '`provider` required' } }
        const { setProviderOverride, persistProviderConfig } = await import('./llm/provider.js')
        setProviderOverride({ provider, model, base_url, api_key })
        if (persist) persistProviderConfig({ provider, model, base_url, api_key })
        const r = resolveProvider()
        return { data: { success: true, active: { provider: r.provider, model: r.model, base_url: r.baseUrl }, persisted: persist } }
    } catch (e) { return { status: 500, data: { error: e.message } } }
}

export async function providerModels(req) {
    /**
     * @register_router provider/models
     * @method GET
     */
    try {
        const { listProviderModels } = await import('./llm/provider.js')
        const { provider: qp, base_url, api_key } = req.query ?? {}
        const { provider: active } = resolveProvider()
        return { data: await listProviderModels(qp ?? active, { base_url, api_key }) }
    } catch (e) { return { status: 500, data: { error: e.message } } }
}

export function mcpProvidersGet() {
    /**
     * @register_router mcp/providers
     * @method GET
     */
    return { data: listMcpProviders() }
}

export function mcpProvidersSave(req) {
    /**
     * @register_router mcp/providers
     * @method POST
     */
    try { return { data: saveMcpProvider(req.body ?? {}) } }
    catch (e) { return { status: 422, data: { error: e.message } } }
}

export async function mcpProvidersRefresh(req) {
    /**
     * @register_router mcp/providers/:name/refresh
     * @method POST
     */
    try { return { data: await refreshMcpProvider(req.params?.name) } }
    catch (e) { return { status: 422, data: { error: e.message } } }
}

export function mcpProvidersDelete(req) {
    /**
     * @register_router mcp/providers/:name
     * @method delete
     */
    try {
        const removed = removeMcpProvider(req.params?.name)
        return removed ? { data: { removed: true } } : { status: 404, data: { error: 'Provider MCP não encontrado.' } }
    } catch (e) { return { status: 422, data: { error: e.message } } }
}

export async function saveConfigRoute(req) {
    /**
     * @register_router config/save
     * @method POST
     */
    try {
        const updates = req.body ?? {}
        const file = join(PKG_DIR, 'agent.config.json')
        if (!existsSync(file)) return { status: 404, data: { error: 'agent.config.json not found' } }
        const current = normalizeConfig(JSON.parse(readFileSync(file, 'utf8')))
        const ALLOWED = new Set(['scheduler', 'agent', 'llm'])
        for (const [k, v] of Object.entries(updates)) {
            if (!ALLOWED.has(k)) continue
            if (!current[k]) current[k] = {}
            if (typeof v === 'object' && !Array.isArray(v)) Object.assign(current[k], v)
        }
        persistAgentConfig(current)
        clearConfigCache()
        return { data: { success: true } }
    } catch (e) { return { status: 500, data: { error: e.message } } }
}

export function getDeliveryStatus({ sessionId, runId, taskId, pkg, candidateHash } = {}) {
    /**
     * @register_tool getDeliveryStatus
     * @description Consulta evidências locais e do Runtime por sessão e execução ou tarefa, sem inferir ativação.
     * @param {string} sessionId - Sessão dona da consulta.
     * @param {string?} runId - Execução consultada.
     * @param {string?} taskId - Tarefa consultada.
     * @param {string?} pkg - Pacote consultado.
     * @param {string?} candidateHash - Hash do candidato do Runtime.
     */
    if (!sessionId || (!runId && !taskId)) return { success: false, error: 'Informe sessionId e runId ou taskId.' }
    const filter = { sessionId, runId, taskId, pkg, candidateHash }
    return { success: true, deliveries: stabilityReceipts.deliveries(filter), receipts: stabilityReceipts.list(filter) }
}
