import { afterEach, describe, expect, it, vi } from 'vitest';
import { makeWorkspace } from './helpers';
import { resolveLogosDependencies, selectRegistryVersion } from '../src/kernel/logos-dependencies';
import { PackageRegistry } from '../src/kernel/registry';

const workspaces: ReturnType<typeof makeWorkspace>[] = [];
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); workspaces.splice(0).forEach(ws => ws.cleanup()); });
function workspace() { const ws = makeWorkspace(); workspaces.push(ws); return ws; }
function pkg(ws: ReturnType<typeof makeWorkspace>, folder: string, manifest: any) {
  ws.pkg(folder, { 'package.json': JSON.stringify(manifest) });
}

describe('logosDependencies', () => {
  it('orders installed dependencies before their consumer', async () => {
    const ws = workspace();
    pkg(ws, 'consumer', { name: 'consumer', logosDependencies: { provider: '1.0.0' } });
    pkg(ws, 'provider', { name: 'provider', version: '1.0.0' });
    const result = await resolveLogosDependencies(new PackageRegistry(ws.root));
    expect(result.packages.map(pkg => pkg.folder)).toEqual(['provider', 'consumer']);
  });

  it('keeps an optional dependency from blocking the consumer', async () => {
    const ws = workspace(); pkg(ws, 'consumer', { name: 'consumer', logosDependencies: { 'missing?': '1.0.0' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    const result = await resolveLogosDependencies(new PackageRegistry(ws.root));
    expect(result.packages.map(pkg => pkg.folder)).toEqual(['consumer']);
    expect(result.diagnostics[0]).toMatchObject({ dependency: 'missing', optional: true });
  });

  it('blocks missing required dependencies and required cycles', async () => {
    const ws = workspace();
    pkg(ws, 'a', { name: 'a', logosDependencies: { b: '1.0.0' } });
    pkg(ws, 'b', { name: 'b', logosDependencies: { a: '1.0.0' } });
    const cycle = await resolveLogosDependencies(new PackageRegistry(ws.root));
    expect(cycle.blocked.map(item => item.folder).sort()).toEqual(['a', 'b']);

    const absent = workspace(); pkg(absent, 'c', { name: 'c', logosDependencies: { missing: '1.0.0' } });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('missing', { status: 404 })));
    const result = await resolveLogosDependencies(new PackageRegistry(absent.root));
    expect(result.blocked[0]).toMatchObject({ folder: 'c' });
  });

  it('uses the Logos catalog independently of npm registry and accepts a host override', async () => {
    const ws = workspace();
    pkg(ws, 'consumer', { name: 'consumer', logosDependencies: { 'missing?': '1.0.0' } });
    vi.stubEnv('npm_config_registry', 'https://registry.npmjs.org/');
    const fetcher = vi.fn().mockResolvedValue(new Response('missing', { status: 404 }));
    vi.stubGlobal('fetch', fetcher);
    await resolveLogosDependencies(new PackageRegistry(ws.root));
    expect(fetcher.mock.calls[0][0]).toBe('https://npm.thinkiac.cloud/missing');
    await resolveLogosDependencies(new PackageRegistry(ws.root), { registry: 'https://catalog.example.org/' });
    expect(fetcher.mock.calls[1][0]).toBe('https://catalog.example.org/missing');
  });

  it('falls back from requested release to lower then newest available', () => {
    expect(selectRegistryVersion('1.4.0', ['1.2.0', '1.3.1', '2.0.0'])).toBe('1.3.1');
    expect(selectRegistryVersion('9.0.0', ['1.2.0', '2.0.0'])).toBe('2.0.0');
  });
});
