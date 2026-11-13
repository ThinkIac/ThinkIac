// tests/mcp.test.ts — HTTP transport of the MCP server: session propagation
// and the `tool_before` gate.
//
// The transport is how EXTERNAL agents (Codex, Claude Code, `think agent:*`)
// reach the runtime's tools. It used to run them straight: no session attached
// to the call and no way for a policy to stop it. These tests pin both.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Container } from '../src/kernel/container';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';
import { mcpApi } from './mcp-module';

let ws: FixtureWorkspace;
const running: any[] = [];
const sessions = new Map<string, string>();

beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(async () => {
  for (const server of running.splice(0)) await new Promise<void>(r => server.close(() => r()));
  ws.cleanup();
});

/** Boots the HTTP transport on a free port over a one-tool fixture package. */
async function boot(container: Container) {
  const dir = ws.pkg('echopkg', {
    'tools.js': [
      '/**',
      ' * @register_tool echo',
      ' * @description echoes the value back',
      ' * @param {string} value - what to echo',
      ' */',
      'exports.echo = function echo(args) { return args.value; };',
    ].join('\n'),
  });
  const port = 34000 + Math.floor(Math.random() * 1000);
  const { server } = await mcpApi(container).createMcpHttpServer({ port, workspace: dir, auth: {
    authenticate: async () => ({ credentialId: 'test', principal: { subject: 'user' }, scopes: ['mcp:connect','mcp:tools:read'], expiresAt: Date.now()+60000 }),
    authorize: async () => true,
  } });
  running.push(server);
  const base = `http://127.0.0.1:${port}`;
  const issued = await (await fetch(base+'/mcp/session', {method:'POST',headers:{Authorization:'Bearer test'}})).json();
  sessions.set(base, issued.sessionId);
  return base;
}

const call = (base: string, body: any, headers: Record<string, string> = {}) =>
  fetch(`${base}/mcp/call`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization:'Bearer test', 'mcp-session-id':sessions.get(base)!, ...headers },
    body: JSON.stringify(body),
  });

describe('POST /mcp/call', () => {
  it('runs the tool and returns its result', async () => {
    const base = await boot(new Container({ workspace: ws.root }));
    const res = await call(base, { name: 'echo', args: { value: 'oi' } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ result: 'oi' });
  });

  it('propagates the session id to tool_before and to the tool context', async () => {
    const c = new Container({ workspace: ws.root });
    const seen: any[] = [];
    c.bus.on('tool_before', (payload: any, ctx: any) => { seen.push({ payload, sessionId: ctx?.sessionId }); });
    const base = await boot(c);

    await call(base, { name: 'echo', args: { value: 'x' } }, { 'x-session-id': 'sess-42' });
    expect(seen).toHaveLength(1);
    expect(seen[0].payload).toMatchObject({ tool: 'echo', sessionId: sessions.get(base) });
    expect(seen[0].sessionId).toBe(sessions.get(base));
  });

  it('ignores untrusted session ids in the body', async () => {
    const c = new Container({ workspace: ws.root });
    const seen: any[] = [];
    c.bus.on('tool_before', (payload: any) => { seen.push(payload); });
    const base = await boot(c);

    await call(base, { name: 'echo', args: { value: 'x' }, sessionId: 'from-body' });
    expect(seen[0].sessionId).toBe(sessions.get(base));
  });

  it('uses authenticated session when no legacy session is sent', async () => {
    const c = new Container({ workspace: ws.root });
    const seen: any[] = [];
    c.bus.on('tool_before', (payload: any) => { seen.push(payload); });
    const base = await boot(c);

    const res = await call(base, { name: 'echo', args: { value: 'x' } });
    expect(res.status).toBe(200);
    expect(seen[0].sessionId).toBe(sessions.get(base));
  });

  it('answers 403 and does NOT run the tool when a tool_before handler vetoes', async () => {
    const c = new Container({ workspace: ws.root });
    let ran = false;
    c.bus.on('tool_after', (p: any) => { if (!p?.payload?.blocked) ran = true; });
    c.bus.on('tool_before', () => ({ veto: true, reason: 'AÇÃO BLOQUEADA: política da sessão' }), { owner: 'governance' });
    const base = await boot(c);

    const res = await call(base, { name: 'echo', args: { value: 'x' } }, { 'x-session-id': 'sess-42' });
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ blocked: true, blockedBy: 'governance', error: expect.stringContaining('política') });
    expect(ran).toBe(false);
  });

  it('maps each veto code to its own status and passes the details through', async () => {
    const cases: [string, number][] = [
      ['MISSING_SESSION', 401],
      ['GOVERNANCE_BLOCKED', 403],
      ['CONFIRMATION_REQUIRED', 409],
      ['CONFIRMATION_DENIED', 403],
      ['GOVERNANCE_ERROR', 503],
    ];
    for (const [code, status] of cases) {
      const c = new Container({ workspace: ws.root });
      c.bus.on('tool_before', () => ({ veto: true, code, reason: `barrado: ${code}`, details: { decisionId: 'dec-1' } }), { owner: 'governance' });
      const base = await boot(c);
      const res = await call(base, { name: 'echo', args: { value: 'x' } });
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code, blocked: true, blockedBy: 'governance', decisionId: 'dec-1' });
    }
  });

  it('carries the approval decisionId from the body into the tool context', async () => {
    const c = new Container({ workspace: ws.root });
    const seen: any[] = [];
    c.bus.on('tool_before', (_p: any, ctx: any) => { seen.push(ctx?.approval); });
    const base = await boot(c);

    await call(base, { name: 'echo', args: { value: 'x' }, decisionId: 'dec-9' }, { 'x-session-id': 's1' });
    expect(seen[0]).toEqual({ decisionId: 'dec-9' });
  });

  it('denies unknown tools before invocation', async () => {
    const c = new Container({ workspace: ws.root });
    const base = await boot(c);
    const res = await call(base, { name: 'does-not-exist', args: {} });
    expect(res.status).toBe(403);
  });

  it('still requires a tool name', async () => {
    const base = await boot(new Container({ workspace: ws.root }));
    const res = await call(base, { args: {} });
    expect(res.status).toBe(400);
  });
});
