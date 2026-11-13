import { listMcpProviders, removeMcpProvider, refreshMcpProvider, saveMcpProvider } from './providers.js'
import { assertSurface } from '../ui-schema/index.js'
import { requirePermission } from '../auth/authorization.js'

const SYSTEM_SURFACE = Object.freeze({
  version: 1,
  kind: 'mcp-providers',
  eyebrow: 'Tools nativas',
  title: 'MCP',
  description: 'Conecte servidores MCP. As tools sincronizadas entram diretamente no catálogo nativo do Runtime.',
  forms: {
    provider: { fields: [
      { name: 'name', component: 'input' },
      { name: 'url', component: 'input' },
      { name: 'api_key', component: 'input' },
      { name: 'enabled', component: 'toggle' },
    ] },
  },
  actions: {
    'mcp.save-provider': { intent: 'write' },
    'mcp.refresh-provider': { intent: 'write' },
    'mcp.remove-provider': { intent: 'destructive' },
  },
})

export function providersGet(req) {
  /** @register_router providers @method GET */
  // API de configuração, sem surface própria. A UI administrativa usa system/view.
  requirePermission(req, 'mcp.providers.read')
  return { data: listMcpProviders() }
}

export function providersSave(req) {
  /** @register_router providers @method POST */
  requirePermission(req, 'mcp.providers.write')
  try { return { data: saveMcpProvider(req.body ?? {}) } }
  catch (error) { return { status: 422, data: { error: error.message } } }
}

export async function providersRefresh(req) {
  /** @register_router providers/:name/refresh @method POST */
  requirePermission(req, 'mcp.providers.write')
  try { return { data: await refreshMcpProvider(req.params?.name) } }
  catch (error) { return { status: 422, data: { error: error.message } } }
}

export function providersDelete(req) {
  /** @register_router providers/:name @method DELETE */
  requirePermission(req, 'mcp.providers.write')
  try { return removeMcpProvider(req.params?.name) ? { data: { removed: true } } : { status: 404, data: { error: 'Provider MCP não encontrado.' } } }
  catch (error) { return { status: 422, data: { error: error.message } } }
}

export function systemView(req) {
  /** @register_router system/view @method GET */
  requirePermission(req, 'mcp.providers.read')
  return { status: 200, surface: assertSurface(SYSTEM_SURFACE), state: { providers: listMcpProviders() } }
}

export async function systemAction(req) {
  /** @register_router system/action @method POST */
  requirePermission(req, 'mcp.providers.write')
  const action = String(req.body?.action ?? '')
  const values = req.body?.values && typeof req.body.values === 'object' ? req.body.values : {}
  try {
    if (action === 'mcp.save-provider') {
      saveMcpProvider(values.provider ?? values)
      return { status: 200, state: { providers: listMcpProviders() }, notice: 'Servidor MCP salvo.' }
    }
    if (action === 'mcp.refresh-provider') {
      await refreshMcpProvider(values.name)
      return { status: 200, state: { providers: listMcpProviders() }, notice: 'Tools MCP sincronizadas.' }
    }
    if (action === 'mcp.remove-provider') {
      if (!removeMcpProvider(values.name)) return { status: 404, mensagem: 'Servidor MCP não encontrado.' }
      return { status: 200, state: { providers: listMcpProviders() }, notice: 'Servidor MCP removido.' }
    }
    return { status: 404, mensagem: 'Ação de System não permitida.' }
  } catch (error) { return { status: 422, mensagem: error.message } }
}
