'use strict';

const express = require('express');
const { randomBytes, randomUUID } = require('node:crypto');

const BLOCK_STATUS = { MISSING_SESSION: 401, GOVERNANCE_BLOCKED: 403, CONFIRMATION_REQUIRED: 409, CONFIRMATION_DENIED: 403, GOVERNANCE_ERROR: 503, TOOL_DENIED: 403, POLICY_UNAVAILABLE: 503, TOOL_BLOCKED: 403 };

function createMcpServer(source, createContext = () => ({}), resolveConditions = async () => true) {
  const resolveTools = typeof source === 'function' ? source : async () => source;
  return {
    protocol: 'mcp', version: '2.0.0',
    async listTools(context = createContext(), includeIdentity = false) {
      const visible = [];
      for (const tool of await resolveTools()) if (await resolveConditions(tool.condition || {}, context))
        visible.push({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema, ...(includeIdentity ? { qualifiedName: tool.qualifiedName || `system.${tool.name}` } : {}) });
      return visible;
    },
    async callTool(name, args, context = createContext(), authorize) {
      const tool = (await resolveTools()).find(item => item.name === name);
      if (authorize) await authorize(tool);
      if (!tool) throw new Error(`Tool not found: ${name}`);
      return tool.handler(args, context);
    },
  };
}

async function createMcpHttpServer(options = {}) {
  const host = options.host || '127.0.0.1';
  if (!['127.0.0.1', '::1', 'localhost'].includes(host) && options.allowRemote !== true) throw new Error('Remote MCP bind requires allowRemote: true');
  const app = express(); app.disable('x-powered-by');
  if (typeof options.bootstrap !== 'function') throw new Error('MCP_BOOTSTRAP_REQUIRED');
  const mcp = await options.bootstrap(); const sessions = new Map(), windows = new Map();
  const deny = (res, status, code) => { res.locals.reason = code; if (status === 401) res.set('WWW-Authenticate', 'Bearer'); if (status === 429) res.set('Retry-After', '60'); return res.status(status).json({ error: code, code }); };
  const take = (key, limit) => { const now = Date.now(); for (const [id, entry] of windows) if (entry.until <= now) windows.delete(id); if (!windows.has(key) && windows.size >= 10000) return false; const entry = windows.get(key) || { until: now + 60000, count: 0 }; windows.set(key, entry); return ++entry.count <= limit; };
  app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); const correlationId = randomUUID(); res.set('X-Request-Id', correlationId); res.on('finish', () => Promise.resolve(options.auth && options.auth.audit && options.auth.audit({ timestamp: new Date().toISOString(), correlationId, credentialId: req.identity && req.identity.credentialId || null, principal: req.identity && req.identity.principal && req.identity.principal.subject || null, tenant: req.identity && req.identity.tenantId || null, sessionId: req.runtimeContext && req.runtimeContext.sessionId || null, ip: req.socket.remoteAddress, method: req.method, operation: ['/mcp','/mcp/tools','/mcp/session','/mcp/call'].includes(req.path) ? req.path : 'unknown', tool: req.auditTool || null, status: res.statusCode, reason: res.locals.reason || null })).catch(() => options.log && options.log('[mcp] Audit sink unavailable'))); if (!take(`ip:${req.socket.remoteAddress}`, options.maxRequestsPerMinute || 600)) return deny(res, 429, 'RATE_LIMITED'); next(); });
  app.use(async (req, res, next) => { const match = /^Bearer ([^\s]+)$/i.exec(req.headers.authorization || ''); if (!match) return deny(res, 401, 'UNAUTHENTICATED'); if (!options.auth) return deny(res, 503, 'AUTH_UNAVAILABLE'); try { const identity = await options.auth.authenticate(match[1]); if (!identity || !identity.credentialId || !identity.principal || !identity.principal.subject || !(identity.expiresAt > Date.now())) return deny(res, 401, 'UNAUTHENTICATED'); req.identity = identity; if (!identity.scopes || !identity.scopes.includes('mcp:connect')) return deny(res, 403, 'SCOPE_DENIED'); if (!take(`credential:${identity.credentialId}`, identity.maxRequestsPerMinute || 120)) return deny(res, 429, 'RATE_LIMITED'); req.runtimeContext = options.createContext({ principal: identity.principal, tenantId: identity.tenantId, scopes: identity.scopes, credentialId: identity.credentialId }); next(); } catch { return deny(res, 503, 'AUTH_UNAVAILABLE'); } });
  app.use(express.json({ limit: '1mb' })); const binding = identity => JSON.stringify([identity.credentialId, identity.principal.subject, identity.tenantId || null]);
  app.get('/mcp', (_req, res) => res.json({ protocol: mcp.protocol, version: mcp.version }));
  app.post('/mcp/session', (req, res) => { const now = Date.now(); for (const [id, session] of sessions) if (session.expiresAt <= now) sessions.delete(id); if (sessions.size >= 10000) return deny(res, 429, 'SESSION_LIMIT'); const sessionId = randomBytes(32).toString('base64url'), expiresAt = Math.min(now + (options.sessionTtlMs || 3600000), req.identity.expiresAt); sessions.set(sessionId, { binding: binding(req.identity), expiresAt }); res.status(201).json({ sessionId, expiresAt }); });
  app.get('/mcp/tools', async (req, res) => { if (!req.identity.scopes.includes('mcp:tools:read')) return deny(res, 403, 'SCOPE_DENIED'); try { const visible = []; for (const tool of await mcp.listTools(req.runtimeContext, true)) if (await options.auth.authorize(req.identity, tool)) visible.push(tool); res.json(visible); } catch { deny(res, 503, 'POLICY_UNAVAILABLE'); } });
  app.post('/mcp/call', async (req, res) => { const sessionId = req.headers['mcp-session-id'], session = typeof sessionId === 'string' ? sessions.get(sessionId) : null; if (!session || session.expiresAt <= Date.now() || session.binding !== binding(req.identity)) return deny(res, 401, 'INVALID_SESSION'); const { name, args } = req.body || {}; if (typeof name !== 'string' || !name) return deny(res, 400, 'TOOL_NAME_REQUIRED'); req.runtimeContext = options.createContext({ ...req.runtimeContext, sessionId, approval: req.body.decisionId ? { decisionId: String(req.body.decisionId) } : null }); try { const authorize = async tool => { let allowed = false; try { allowed = Boolean(tool) && await options.resolveConditions(tool.condition || {}, req.runtimeContext) && await options.auth.authorize(req.identity, { ...tool, qualifiedName: tool.qualifiedName || `system.${tool.name}` }) === true; } catch { throw Object.assign(new Error('Policy unavailable'), { code: 'POLICY_UNAVAILABLE' }); } if (!allowed) throw Object.assign(new Error('Tool denied'), { code: 'TOOL_DENIED' }); req.auditTool = tool.name; }; res.json({ result: await mcp.callTool(name, args || {}, req.runtimeContext, authorize) }); } catch (err) { const status = BLOCK_STATUS[err && err.code]; res.locals.reason = err && err.code || 'TOOL_ERROR'; if (status) return res.status(status).json({ error: err.message, code: err.code, blocked: true, blockedBy: err.blockedBy || null, ...(err.details || {}) }); res.status(500).json({ error: 'Tool execution failed', code: 'TOOL_ERROR' }); } });
  app.use((err, _req, res, _next) => deny(res, err && err.type === 'entity.too.large' ? 413 : 400, 'INVALID_BODY'));
  const server = await new Promise((resolve, reject) => { const value = app.listen(options.port ?? 3333, host, () => resolve(value)); value.once('error', reject); }); server.on('close', () => { sessions.clear(); windows.clear(); }); return { app, server, mcp };
}
module.exports = { createMcpServer, createMcpHttpServer };

function createRuntimeModule(host) {
  let cache = null;
  const invalidating = ['reload:swapped', 'package:rolled_back', 'package:added', 'package:removed'];
  const bootstrap = async workspace => {
    const resolveTools = async () => cache || (cache = [...await host.loadTools(workspace), ...(host.state('tools').get('kernel') || [])]);
    await resolveTools();
    return createMcpServer(resolveTools, host.createContext, host.resolveConditions);
  };
  return {
    name: 'mcp', phase: 'wire', after: ['tools'],
    api: {
      createMcpServer: (source) => createMcpServer(source, host.createContext, host.resolveConditions),
      bootstrapMcp: bootstrap,
      createMcpHttpServer: async (options = {}) => createMcpHttpServer({ ...options, bootstrap: () => bootstrap(options.workspace || process.env.PACKAGES_PATH), createContext: host.createContext, resolveConditions: host.resolveConditions, log: host.log }),
    },
    install() { for (const event of invalidating) host.on(event, () => { cache = null; }, { priority: 10 }); },
  };
}
module.exports.createRuntimeModule = createRuntimeModule;
