import { createMcpToolError } from './mcp_context.js';

/** One authenticated session per bridge process; no tool argument selects identity. */
export function createMcpHttpClient({ baseUrl = process.env.AGENT_MCP_HTTP_URL || 'http://127.0.0.1:3333',
  token = process.env.THINKIAC_MCP_TOKEN, fetchImpl = fetch, now = Date.now } = {}) {
  let session = null;
  let pending = null;
  async function request(path, body, sessionId) {
    if (!token) throw new Error('THINKIAC_MCP_TOKEN não definido. Emita uma credencial em /auth/mcp/credentials.');
    const res = await fetchImpl(`${baseUrl}${path}`, {
      method: body === undefined ? 'GET' : 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = await res.json();
    if (!res.ok) throw createMcpToolError(data, res.status);
    return data;
  }
  async function getSession() {
    if (session?.expiresAt > now() + 1000) return session.sessionId;
    pending ??= request('/mcp/session', {}).then(value => (session = value)).finally(() => { pending = null; });
    return (await pending).sessionId;
  }
  return {
    listTools: () => request('/mcp/tools'),
    async callTool(name, args, decisionId) {
      const invoke = async () => request('/mcp/call', { name, args, ...(decisionId ? {decisionId} : {}) }, await getSession());
      try { return (await invoke()).result; }
      catch (error) {
        
        if (error.status !== 401 || error.code !== 'INVALID_SESSION') throw error;
        session = null;
        return (await invoke()).result;
      }
    },
  };
}
