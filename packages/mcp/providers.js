import { existsSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const CONFIG_FILE = join(PKG_DIR, 'mcp.config.json')
const LEGACY_CONFIG_FILE = join(PKG_DIR, '..', 'agent', 'agent.config.json')
const NAME = /^[a-z][a-z0-9-]{0,62}$/
const HTTP_URL = /^https?:\/\//i
let cached = null

function readConfig() {
  if (cached) return structuredClone(cached)
  for (const file of [CONFIG_FILE, LEGACY_CONFIG_FILE]) {
    if (!existsSync(file)) continue
    try {
      const value = JSON.parse(readFileSync(file, 'utf8'))
      const servers = Array.isArray(value?.servers) ? value.servers : value?.mcp?.servers
      if (Array.isArray(servers)) return structuredClone(cached = { servers })
    } catch { /* Never expose malformed configuration text, which may contain a key. */ }
  }
  return structuredClone(cached = { servers: [] })
}

function saveConfig(config) {
  const temporary = `${CONFIG_FILE}.${randomUUID()}.tmp`
  try {
    let mode = 0o600
    try { mode = statSync(CONFIG_FILE).mode & 0o777 } catch (error) { if (error.code !== 'ENOENT') throw error }
    writeFileSync(temporary, JSON.stringify(config, null, 2), { encoding: 'utf8', mode, flag: 'wx' })
    renameSync(temporary, CONFIG_FILE)
  } finally {
    try { unlinkSync(temporary) } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  cached = structuredClone(config)
}

function cleanName(value) {
  const name = String(value ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  if (!NAME.test(name)) throw new Error('Nome MCP inválido. Use letras, números e hífens.')
  return name
}

function cleanProvider(input = {}, previous = null) {
  const name = cleanName(input.name ?? previous?.name)
  const url = String(input.url ?? previous?.url ?? '').trim()
  if (!HTTP_URL.test(url)) throw new Error('A URL MCP deve começar com http:// ou https://.')
  const type = input.type ?? previous?.type ?? 'http'
  if (type !== 'http') throw new Error('Esta tela suporta MCP Streamable HTTP.')
  return {
    name, url, type,
    api_key: input.api_key === undefined ? previous?.api_key : String(input.api_key ?? ''),
    disabled: input.enabled === undefined ? (previous?.disabled ?? false) : !input.enabled,
    tool_cache: Array.isArray(previous?.tool_cache) ? previous.tool_cache : [],
  }
}

function publicProvider(server) {
  const { api_key, ...safe } = server
  const toolNames = (safe.tool_cache ?? []).map(tool => `mcp_${safe.name.replace(/-/g, '_')}_${tool.name}`)
  return { ...safe, configured: Boolean(api_key), tools: toolNames.length, toolNames, virtualPackage: `mcp-${safe.name}` }
}

export function listMcpProviders() { return readConfig().servers.map(publicProvider) }

export function saveMcpProvider(input) {
  const config = readConfig()
  const name = cleanName(input?.name)
  const index = config.servers.findIndex(server => server?.name === name)
  const provider = cleanProvider(input, index >= 0 ? config.servers[index] : null)
  if (index >= 0) config.servers[index] = provider
  else config.servers.push(provider)
  saveConfig(config)
  return publicProvider(provider)
}

export function removeMcpProvider(name) {
  const config = readConfig()
  const normalized = cleanName(name)
  const servers = config.servers.filter(server => server?.name !== normalized)
  if (servers.length === config.servers.length) return false
  saveConfig({ ...config, servers })
  return true
}

function headers(provider, extra = {}) {
  return { accept: 'application/json, text/event-stream', 'content-type': 'application/json', ...(provider.api_key ? { authorization: `Bearer ${provider.api_key}` } : {}), ...extra }
}

async function rpc(provider, method, params = {}, fetcher = fetch) {
  const request = async (id, requestMethod, requestParams, sessionId = null) => {
    const response = await fetcher(provider.url, { method: 'POST', headers: headers(provider, sessionId ? { 'mcp-session-id': sessionId } : {}), body: JSON.stringify({ jsonrpc: '2.0', ...(id === null ? {} : { id }), method: requestMethod, params: requestParams }) })
    if (!response.ok) throw new Error(`MCP respondeu HTTP ${response.status}.`)
    if (id === null) return { sessionId: response.headers.get('mcp-session-id') }
    const body = await response.json()
    if (body.error) throw new Error(body.error.message || 'Erro retornado pelo servidor MCP.')
    return { result: body.result, sessionId: response.headers.get('mcp-session-id') }
  }
  const initialized = await request(1, 'initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'thinkiac-mcp', version: '1.0.0' } })
  if (method === 'initialize') return initialized.result
  await request(null, 'notifications/initialized', {}, initialized.sessionId)
  return (await request(2, method, params, initialized.sessionId)).result
}

function cachedTool(tool) {
  const name = String(tool?.name ?? '')
  if (!NAME.test(name.replace(/_/g, '-'))) return null
  return { name, description: String(tool.description ?? `Tool MCP ${name}`), inputSchema: tool.inputSchema && typeof tool.inputSchema === 'object' ? tool.inputSchema : { type: 'object', properties: {} } }
}

export async function refreshMcpProvider(name, fetcher = fetch) {
  const config = readConfig()
  const provider = config.servers.find(server => server?.name === cleanName(name))
  if (!provider) throw new Error('Provider MCP não encontrado.')
  provider.tool_cache = ((await rpc(provider, 'tools/list', {}, fetcher))?.tools ?? []).map(cachedTool).filter(Boolean)
  saveConfig(config)
  return { provider: publicProvider(provider), tools: provider.tool_cache }
}

export function discoverMcpTools() {
  return readConfig().servers.filter(provider => provider && !provider.disabled).flatMap(provider => (provider.tool_cache ?? []).map(tool => ({ package: `mcp-${provider.name}`, name: `mcp_${provider.name.replace(/-/g, '_')}_${tool.name}`, description: tool.description, parameters: tool.inputSchema, virtual: true, _call: args => rpc(provider, 'tools/call', { name: tool.name, arguments: args }) })))
}
