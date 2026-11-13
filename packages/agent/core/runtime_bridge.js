



import { join, dirname, resolve } from 'path'
import { fileURLToPath, pathToFileURL } from 'url'
import { existsSync, readdirSync, statSync, readFileSync } from 'fs'
import { createRequire } from 'module'
import { evaluateAction } from '../../governance/service.js'
import { isReadOnly } from '../../governance/lib/engine.js'
import { withRuntimeExecutionContext } from './runtime_execution_context.js'

const PKG_DIR = dirname(fileURLToPath(import.meta.url))
const AGENT_DIR = resolve(PKG_DIR, '..')
const PROJECT_DIR = resolve(PKG_DIR, '..', '..', '..')  
const PACKAGES_DIR = join(PROJECT_DIR, 'packages')        
const MODULES_DIR = join(PROJECT_DIR, '..', '..')
const require = createRequire(import.meta.url)
const { requiredToolPermission } = require('../../auth/discovery_permissions.cjs')

function packageManifest(pkgPath) {
  try { return JSON.parse(readFileSync(join(pkgPath, 'package.json'), 'utf8')) } catch { return null }
}



let _tools = null   
let _routes = null   
let _contexts = null   
let _mtimeHash = null   
let _salt = Date.now() 



function computeMtimeHash() {
  if (!existsSync(PACKAGES_DIR)) return ''
  const parts = []
  
  const dirs = readdirSync(PACKAGES_DIR).sort()

  for (const dir of dirs) {
    const pkgPath = join(PACKAGES_DIR, dir)
    if (!statSync(pkgPath).isDirectory()) continue
    try {
      for (const file of readdirSync(pkgPath).sort()) {
        if (!file.endsWith('.js')) continue
        const abs = join(pkgPath, file)
        const mtime = statSync(abs).mtimeMs
        parts.push(`${dir}/${file}:${mtime}`)
      }
    } catch { }
  }
  return parts.join('|')
}

function isCacheValid() {
  if (!_tools || !_routes || !_contexts) return false
  const current = computeMtimeHash()
  const valid = current === _mtimeHash
  if (!valid) _salt = Date.now() 
  return valid
}



async function getRuntimeRegistry() {
  try {
    
    
    
    
    
    
    
    const rt = await import('logos')

    return {
      registerTools: rt.registerTools,
      registerRoutes: rt.registerRoutes,
      registerContexts: rt.registerContexts || (() => [])
    }
  } catch (e) {
    throw new Error(`logos não encontrado ou falhou no carregamento: ${e.message}`)
  }
}







const PKG_DISCOVERY_TIMEOUT_MS = 8000
function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout após ${ms}ms`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

export async function discoverRuntimeTools() {
  
  
  
  if (isCacheValid()) {
    const { discoverMcpTools } = await import('../mcp_providers.js')
    return [..._tools, ...discoverMcpTools()]
  }

  const { registerTools } = await getRuntimeRegistry()
  const allTools = []

  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    const pkgPath = join(PACKAGES_DIR, dir)
    if (!statSync(pkgPath).isDirectory()) continue
    try {
      const tools = await withTimeout(registerTools(pkgPath), PKG_DISCOVERY_TIMEOUT_MS, dir)
      const manifest = packageManifest(pkgPath)
      for (const tool of tools) {
        allTools.push({
          package: dir,
          name: tool.name,
          description: tool.description ?? null,
          parameters: tool.parameters ?? { type: 'object', properties: {} },
          reach: tool.reach || 'auto',
          recoveryPolicy: tool.recoveryPolicy || null,
          reconcileTool: tool.reconcileTool || null,
          requiredPermission: requiredToolPermission(manifest, tool.name),
          _call: tool.call,
        })
      }
    } catch (e) {
      console.warn(`[runtime_bridge] tools de "${dir}": ${e.message}`)
    }
  }

  _tools = allTools
  _mtimeHash = computeMtimeHash()
  const { discoverMcpTools } = await import('../mcp_providers.js')
  return [..._tools, ...discoverMcpTools()]
}

export async function discoverRuntimeRoutes() {
  if (_routes && isCacheValid()) return _routes

  const { registerRoutes } = await getRuntimeRegistry()
  const allRoutes = []

  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    const pkgPath = join(PACKAGES_DIR, dir)
    if (!statSync(pkgPath).isDirectory()) continue
    try {
      const routes = await registerRoutes(pkgPath)
      for (const route of routes) {
        allRoutes.push({
          package: dir,
          path: '/' + join(dir, route.path).replace(/\\/g, '/'),
          method: route.method.toUpperCase(),
          handler: route.handler,
        })
      }
    } catch (e) {
      console.warn(`[runtime_bridge] routes de "${dir}": ${e.message}`)
    }
  }

  _routes = allRoutes
  return _routes
}

export async function discoverRuntimeContexts() {
  if (_contexts && isCacheValid()) return _contexts

  const { registerContexts } = await getRuntimeRegistry()
  const allContexts = []

  for (const dir of readdirSync(PACKAGES_DIR).sort()) {
    const pkgPath = join(PACKAGES_DIR, dir)
    if (!statSync(pkgPath).isDirectory()) continue
    try {
      const contexts = await registerContexts(pkgPath)
      for (const ctx of contexts) {
        allContexts.push({
          package: dir,
          name: ctx.name,
          priority: ctx.priority ?? 10,
          ttl: ctx.ttl ?? 300,
          call: ctx.call,
        })
      }
    } catch (e) {
      console.warn(`[runtime_bridge] contexts de "${dir}": ${e.message}`)
    }
  }

  _contexts = allContexts
  return _contexts
}



/**
 * A ausência de uma sessão só é aceitável para consultas demonstravelmente
 * read-only. Esta prova usa a mesma normalização da governança, impedindo que
 * um chamador direto alcance `tool._call` por simplesmente omitir contexto.
 */
export function requiresRuntimeGovernance(packageName, toolName, args = {}) {
  return !isReadOnly({
    tool: 'run_runtime_tool',
    input: { package: packageName, tool: toolName, args },
  })
}

export async function invokeRuntimeTool(packageName, toolName, args = {}, governance = null) {
  const action = {
    sessionId: governance?.sessionId,
    tool: 'run_runtime_tool',
    input: { package: packageName, tool: toolName, args },
  }
  const needsGovernance = requiresRuntimeGovernance(packageName, toolName, args)

  
  
  
  if (needsGovernance && !governance?.sessionId) {
    const error = new Error('AÇÃO BLOQUEADA: a tool mutável exige sessionId rastreável.')
    error.code = 'GOVERNANCE_SESSION_REQUIRED'
    throw error
  }
  if (needsGovernance && !governance?.alreadyGoverned) {
    const decision = await evaluateAction({
      ...action,
    }, { authorize: governance?.authorize })
    if (!decision.allowed) {
      const error = new Error(`${decision.classification === 'blocked' ? 'AÇÃO BLOQUEADA' : 'CONFIRMAÇÃO NECESSÁRIA'}: ${decision.reason}`)
      error.code = decision.classification === 'blocked' ? 'GOVERNANCE_BLOCKED' : 'GOVERNANCE_CONFIRMATION_REQUIRED'
      error.governance = decision
      throw error
    }
  }
  const tools = await discoverRuntimeTools()

  const tool = tools.find(t =>
    t.name === toolName &&
    (packageName ? t.package === packageName : true)
  )

  if (!tool) {
    const candidates = tools.filter(t => t.name === toolName).map(t => t.package)
    const hint = candidates.length
      ? `Tool "${toolName}" existe nos packages: ${candidates.join(', ')} — especifique o package.`
      : `Tool "${toolName}" não encontrada em nenhum package. Use list_runtime_tools para ver o catálogo.`
    throw new Error(hint)
  }

  if (typeof tool._call !== 'function') {
    throw new Error(`Tool "${toolName}" (package: ${tool.package}) não tem implementação invocável.`)
  }

  
  
  
  return await withRuntimeExecutionContext(governance, () => tool._call(args))
}



export function buildRuntimeCatalogGuide() {
  return [
    'As tools disponíveis nesta chamada já chegam como schemas nativos.',
    'Se faltar capacidade, busque-a especificamente com list_runtime_tools.',
    'Se existir sem acesso, peça os nomes exatos com request_tool_access; após a governança, retome a tarefa.',
    'Se não existir, não invente uma chamada de runtime: use a tool nativa create_tool apenas para extensão limitada, validada e ainda governada.',
    'Execute uma tool acessível ou concedida com run_runtime_tool({ package, tool, args }).',
    'Consulte rotas HTTP apenas sob demanda com list_runtime_routes; não presuma paths ou parâmetros.',
  ].join('\n')
}

export async function getRuntimeCatalog() {
  return buildRuntimeCatalogGuide()
}

export function invalidateCache() {
  _tools = null; _routes = null; _contexts = null; _mtimeHash = null
}

export function getCacheInfo() {
  const valid = isCacheValid()
  return {
    valid,
    last_reload: new Date(_salt).toISOString(),
    tools_cached: _tools?.length ?? 0,
    routes_cached: _routes?.length ?? 0,
    contexts_cached: _contexts?.length ?? 0
  }
}
