// tests/registry.test.ts — package discovery and per-package lifecycle state.

import { describe, it, expect, afterEach } from 'vitest';
import { PackageRegistry } from '../src/kernel/registry';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
afterEach(() => ws?.cleanup());

describe('PackageRegistry.discover', () => {
  it('returns an empty list when the workspace does not exist', () => {
    const reg = new PackageRegistry('/no/such/workspace');
    expect(reg.discover()).toEqual([]);
  });

  it('lists direct child folders, skipping dotfolders and ignored dirs', () => {
    ws = makeWorkspace();
    ws.pkg('alpha', { 'package.json': '{"name":"alpha"}' });
    ws.pkg('beta', { 'package.json': '{"name":"beta"}' });
    ws.pkg('.hidden', { 'x.js': '' });
    ws.pkg('node_modules', { 'x.js': '' });
    const reg = new PackageRegistry(ws.root);
    const names = reg.discover().map(p => p.folder).sort();
    expect(names).toEqual(['alpha', 'beta']);
  });

  it('lists declared module roots without recursive package discovery', () => {
    ws = makeWorkspace();
    ws.pkg('app', { 'package.json': '{"name":"app"}' });
    ws.pkg('modules/mcp', { 'package.json': '{"name":"@logos/mcp","runtime":{"role":"module"}}' });
    ws.pkg('agent/mcp', { 'package.json': '{"name":"@logos/agent-mcp","runtime":{"role":"module"}}' });
    ws.pkg('app/vendor/tool', { 'package.json': '{"name":"not-a-logos-package"}' });
    const reg = new PackageRegistry(ws.root);
    expect(reg.discover().map(p => p.folder).sort()).toEqual(['agent', 'agent/mcp', 'app', 'modules/mcp']);
    const mcp = reg.getPackage('modules/mcp');
    expect(mcp).toMatchObject({ folder: 'modules/mcp', name: '@logos/mcp' });
    expect(reg.isModulePackage(mcp)).toBe(true);
    expect(reg.getPackage('agent/mcp')).toMatchObject({ folder: 'agent/mcp', name: '@logos/agent-mcp' });
  });
});

describe('PackageRegistry.getPackage', () => {
  it('merges package.json fields and always sets folder/path/dir', () => {
    ws = makeWorkspace();
    ws.pkg('alpha', { 'package.json': '{"name":"alpha","version":"1.2.3"}' });
    const reg = new PackageRegistry(ws.root);
    const pkg = reg.getPackage('alpha');
    expect(pkg).toMatchObject({ name: 'alpha', version: '1.2.3', folder: 'alpha' });
    expect(pkg.path).toBe(pkg.dir);
    expect(pkg.dir.endsWith('/alpha')).toBe(true);
  });

  it('tolerates a package with no package.json', () => {
    ws = makeWorkspace();
    ws.pkg('bare', { 'index.js': '' });
    const reg = new PackageRegistry(ws.root);
    expect(reg.getPackage('bare')).toMatchObject({ folder: 'bare' });
  });
});

describe('PackageRegistry.isModulePackage', () => {
  it('is true only for runtime.role === "module"', () => {
    const reg = new PackageRegistry('/x');
    expect(reg.isModulePackage({ runtime: { role: 'module' } } as any)).toBe(true);
    expect(reg.isModulePackage({ runtime: { role: 'package' } } as any)).toBe(false);
    expect(reg.isModulePackage({} as any)).toBe(false);
    expect(reg.isModulePackage(null as any)).toBe(false);
  });
});

describe('PackageRegistry state', () => {
  it('starts with no state and records transitions with a timestamp', () => {
    const reg = new PackageRegistry('/x');
    expect(reg.getState('alpha')).toBeNull();
    reg.setState('alpha', 'wiring');
    reg.setState('alpha', 'active');
    const state = reg.getState('alpha');
    expect(state!.state).toBe('active');
    expect(typeof state!.since).toBe('number');
  });

  it('captures an error string on failure', () => {
    const reg = new PackageRegistry('/x');
    reg.setState('alpha', 'failed', 'boom');
    expect(reg.getState('alpha')!.error).toBe('boom');
  });

  it('snapshot returns every tracked package', () => {
    const reg = new PackageRegistry('/x');
    reg.setState('a', 'active');
    reg.setState('b', 'rolled_back');
    const snap = reg.snapshot();
    expect(Object.keys(snap).sort()).toEqual(['a', 'b']);
    expect(snap.b.state).toBe('rolled_back');
  });
});
