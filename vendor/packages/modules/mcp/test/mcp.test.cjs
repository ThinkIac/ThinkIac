'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMcpServer, createMcpHttpServer } = require('..');

test('filters a live tool source and invokes the authorized captured tool', async () => {
  let tools = [{ name: 'ok', inputSchema: {}, condition: { enabled: true }, handler: args => args.value }];
  const server = createMcpServer(() => tools, () => ({}), async condition => condition.enabled !== false);
  assert.deepEqual(await server.listTools(), [{ name: 'ok', description: undefined, inputSchema: {} }]);
  assert.equal(await server.callTool('ok', { value: 7 }), 7);
  tools = [{ name: 'next', handler: () => 'updated' }];
  assert.equal((await server.listTools())[0].name, 'next');
});

test('HTTP transport accepts an ephemeral port and binds sessions to credentials', async () => {
  const mcp = createMcpServer([{ name: 'echo', handler: args => args }]);
  const { server } = await createMcpHttpServer({ port: 0, bootstrap: async () => mcp, createContext: value => value, resolveConditions: async () => true, auth: { authenticate: async token => ({ credentialId: token, principal: { subject: 'u' }, scopes: ['mcp:connect', 'mcp:tools:read'], expiresAt: Date.now() + 10_000 }), authorize: async () => true } });
  try { const base = `http://127.0.0.1:${server.address().port}`; const session = await (await fetch(`${base}/mcp/session`, { method: 'POST', headers: { Authorization: 'Bearer one' } })).json(); const response = await fetch(`${base}/mcp/call`, { method: 'POST', headers: { Authorization: 'Bearer one', 'mcp-session-id': session.sessionId, 'content-type': 'application/json' }, body: JSON.stringify({ name: 'echo', args: { value: 3 } }) }); assert.deepEqual(await response.json(), { result: { value: 3 } }); } finally { await new Promise(resolve => server.close(resolve)); }
});
