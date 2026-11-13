// tests/tools.test.ts — tool execution wrapper (conditions, lifecycle events,
// middleware) and the kernel self-operation tools.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Container } from '../src/kernel/container';
import { toolToMcp, kernelTools } from '../src/modules/tools';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(() => ws.cleanup());

describe('toolToMcp', () => {
  it('maps a tool to the MCP shape', () => {
    const c = new Container({ workspace: ws.root });
    const mcp = toolToMcp(c, { name: 'sum', description: 'adds', parameters: { type: 'object' } }, 'pkg');
    expect(mcp).toMatchObject({ name: 'sum', description: 'adds' });
    expect(typeof mcp.handler).toBe('function');
  });

  it('runs the tool and emits tool_before / tool_after', async () => {
    const c = new Container({ workspace: ws.root });
    const events: string[] = [];
    c.bus.on('tool_before', () => { events.push('before'); });
    c.bus.on('tool_after', () => { events.push('after'); });
    const mcp = toolToMcp(c, { name: 'echo', call: (args: any) => args.v }, 'pkg');
    expect(await mcp.handler({ v: 7 })).toBe(7);
    expect(events).toEqual(['before', 'after']);
  });

  it('throws when the tool is not available in the given context', async () => {
    const c = new Container({ workspace: ws.root });
    const mcp = toolToMcp(c, { name: 'admin', call: () => 1, condition: { only: ['isAdmin'] } }, 'pkg');
    await expect(mcp.handler({}, {})).rejects.toThrow(/not available/);
    expect(await mcp.handler({}, { isAdmin: true })).toBe(1);
  });
});

describe('kernelTools', () => {
  it('exposes runtime activation and diagnostics tools', () => {
    const names = kernelTools(new Container({ workspace: ws.root })).map(t => t.name);
    expect(names).toEqual([
      'runtime_commit', 'runtime_activate_package', 'runtime_package_diagnostics',
      'runtime_reboot_impact', 'runtime_status', 'runtime_manifest',
    ]);
  });

  it('runtime_activate_package uses the runtime activation boundary', async () => {
    const c = new Container({ workspace: ws.root });
    c.state('runtime').set('activatePackage', async (folder: string) => ({ ok: true, pkg: folder }));
    const tool = kernelTools(c).find(t => t.name === 'runtime_activate_package')!;
    await expect(tool.handler({ package: 'topology' })).resolves.toEqual({ ok: true, pkg: 'topology' });
  });

  it('runtime_package_diagnostics returns the stabilizer snapshot', async () => {
    const c = new Container({ workspace: ws.root });
    c.state('runtime').set('packageDiagnostics', (folder?: string) => ({ workspaceWatcher: true, folder }));
    const tool = kernelTools(c).find(t => t.name === 'runtime_package_diagnostics')!;
    await expect(tool.handler({ package: 'topology' })).resolves.toEqual({ workspaceWatcher: true, folder: 'topology' });
  });

  // O agente precisa conseguir medir o custo de um reset ANTES de pedir um:
  // sem pacote crítico pendurado, reiniciar é liberado.
  it('runtime_reboot_impact responde com o custo do reset global', async () => {
    const c = new Container({ workspace: ws.root });
    const tool = kernelTools(c).find(t => t.name === 'runtime_reboot_impact')!;
    const impact: any = await tool.handler({});
    expect(impact.rebootAdvised).toBe(true);
    expect(impact.criticalPackages).toEqual([]);
    expect(impact.liveSessions).toEqual([]);
  });

  it('runtime_status reports the registry snapshot', async () => {
    const c = new Container({ workspace: ws.root });
    c.registry.setState('alpha', 'active');
    const status = kernelTools(c).find(t => t.name === 'runtime_status')!;
    const result: any = await status.handler({});
    expect(result.packages.alpha.state).toBe('active');
    expect(Array.isArray(result.errors)).toBe(true);
  });

  it('runtime_commit dispatches the reload:commit pipeline', async () => {
    const c = new Container({ workspace: ws.root });
    let seen: any = null;
    c.bus.on('reload:commit', (p: any) => { seen = p; return { ok: true }; });
    const commit = kernelTools(c).find(t => t.name === 'runtime_commit')!;
    const result: any = await commit.handler({ package: 'alpha' });
    expect(seen).toMatchObject({ pkg: 'alpha', requestedBy: 'tool' });
    expect(result).toEqual({ ok: true });
  });
});
