import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';

const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('sealed module lifecycle', () => {
  it('loads explicitly selected modules from workspace paths and installed packages', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const factory = (name: string) => `exports.createRuntimeModule = () => ({ name: '${name}', phase: 'wire', install() {} });`;
    workspace.pkg('capability', { 'package.json': '{"main":"index.cjs"}', 'index.cjs': factory('path-capability') });
    workspace.pkg('node_modules/@example/capability', { 'package.json': '{"main":"index.cjs"}', 'index.cjs': factory('installed-capability') });
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: ['./capability', '@example/capability'],
      workers: false, hotReload: { enabled: false } });
    cleanup.push(() => runtime.close());
    expect(runtime.container.modules.has('path-capability')).toBe(true);
    expect(runtime.container.modules.has('installed-capability')).toBe(true);
    expect(runtime.app).toBeNull();
  });

  it('prepares packages in dependency order before importing workspace modules', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    workspace.pkg('provider', { 'package.json': '{"name":"provider"}' });
    workspace.pkg('consumer', {
      'package.json': '{"name":"consumer","logosDependencies":{"provider":"1.0.0"}}',
    });
    workspace.pkg('preparer', {
      'package.json': '{"main":"index.cjs"}',
      'index.cjs': `exports.createRuntimeModule = host => {
        host.on('logos:package:preparing', ({pkg, version}) => {
          if (version !== 1) throw new Error('missing protocol version');
          host.state('preparation').set(pkg.folder, true);
          if (pkg.folder === 'consumer' && !host.state('preparation').get('provider'))
            throw new Error('provider not prepared');
        });
        return {name:'preparer', phase:'boot', install() {}};
      };`,
    });
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: ['./preparer'] });
    cleanup.push(() => runtime.close());
    expect(runtime.container.state('preparation').get('provider')).toBe(true);
    expect(runtime.container.registry.getState('consumer')?.state).toBe('active');
  });

  it('blocks required consumers when module-owned preparation fails', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    workspace.pkg('provider', { 'package.json': '{"name":"provider"}' });
    workspace.pkg('consumer', { 'package.json': '{"name":"consumer","logosDependencies":{"provider":"1.0.0"}}' });
    workspace.pkg('preparer', {
      'package.json': '{"main":"index.cjs"}',
      'index.cjs': `exports.createRuntimeModule = host => {
        host.on('logos:package:preparing', ({pkg}) => {
          if (pkg.folder === 'provider') throw new Error('preparation rejected');
        });
        return {name:'preparer', phase:'boot', install() {}};
      };`,
    });
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: ['./preparer'] });
    cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('provider')?.state).toBe('blocked');
    expect(runtime.container.registry.getState('consumer')?.state).toBe('blocked');
  });

  it('boots and closes with no optional modules', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: [], workers: false, hotReload: { enabled: false } });
    cleanup.push(() => runtime.close());
    expect(runtime.app).toBeNull();
    expect(runtime.server).toBeNull();
    expect(runtime.mcp).toBeNull();
    expect(runtime.container.modulesSealed).toBe(true);
    await runtime.close();
    await runtime.close();
  });

  it('serves HTTP without views, MCP, WebSocket or repository', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: ['http'], workers: false, port: 0, host: '127.0.0.1', hotReload: { enabled: false } });
    cleanup.push(() => runtime.close());
    const port = runtime.server.address().port;
    expect(port).toBeGreaterThan(0);
    expect((await fetch(`http://127.0.0.1:${port}/__health`)).status).toBe(200);
    expect((await fetch(`http://127.0.0.1:${port}/__ready`)).status).toBe(200);
    await runtime.close();
    expect(runtime.server.listening).toBe(false);
  });

  it('closes MCP HTTP transports opened through the compatibility API', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: ['tools', 'mcp'], workers: false, hotReload: { enabled: false } });
    cleanup.push(() => runtime.close());
    const api = runtime.container.state('external-api').get('mcp');
    const transport = await api.createMcpHttpServer({ port: 0 });
    expect(transport.server.listening).toBe(true);
    await runtime.close();
    expect(transport.server.listening).toBe(false);
  });

  it('delivers a new resource type after seal and announces ready after start', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    workspace.pkg('sample', { 'package.json': '{"name":"sample"}',
      'actions.js': 'exports.double = function(value) { /** @register arithmetic double */ return value * 2; };' });
    const order: string[] = [];
    let resource: any;
    let ready: any;
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: [], workers: false, hotReload: { enabled: false }, modules: [{
      name: 'arithmetic', version: '1.2.3', phase: 'wire',
      resources: { arithmetic: (value: any) => { order.push('resource'); resource = value; } },
      install(container: Container) {
        expect(container.modulesSealed).toBe(true);
        container.bus.on('logos:ready', value => { ready = value; order.push('ready'); });
      },
      prepare() { order.push('prepare'); }, start() { order.push('start'); }, close() { order.push('close'); },
    }] });
    cleanup.push(() => runtime.close());
    expect(await resource.handler(21)).toBe(42);
    expect(order).toEqual(['resource', 'prepare', 'start', 'ready']);
    expect(ready).toMatchObject({ version: 1, origin: 'logos', workspace: workspace.root, phase: 'ready', authority: { kind: 'system' } });
    expect(ready.correlationId).toBeTypeOf('string');
    expect(() => runtime.container.use({ name: 'late', phase: 'wire', install() {} })).toThrow(/sealed/);
    await runtime.close(); expect(order.at(-1)).toBe('close');
  });

  it('rejects the complete graph before any module installation', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    let acquired = false;
    await expect(bootstrap({ workspace: workspace.root, externalModules: [], workers: false, modules: [
      { name: 'early', phase: 'boot', install() { acquired = true; } },
      { name: 'invalid', phase: 'wire', requires: ['missing'], install() {} },
    ] })).rejects.toThrow(/requires missing/);
    expect(acquired).toBe(false);
  });

  it('cleans partial installation in reverse order without announcing ready', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const seen: string[] = [];
    await expect(bootstrap({ workspace: workspace.root, externalModules: [], workers: false, modules: [
      { name: 'first', phase: 'wire', install(container: Container) { container.bus.on('logos:ready', () => seen.push('ready')); }, close() { seen.push('first'); } },
      { name: 'broken', phase: 'wire', requires: ['first'], install() { throw new Error('installation failed'); }, close() { seen.push('broken'); } },
    ] })).rejects.toThrow('installation failed');
    expect(seen).toEqual(['broken', 'first']);
  });

  it('keeps the sealed catalog independent from caller mutation and rejects resource conflicts', () => {
    const c = new Container({ workspace: '/tmp/logos-catalog' });
    const requires: string[] = [];
    c.use({ name: 'test', phase: 'wire', requires, install() {} });
    c.sealModules(); requires.push('missing');
    (c.modules as Map<string, any>).clear();
    expect(c.modules.get('test')?.requires).toEqual([]);
    const conflict = new Container({ workspace: '/tmp/logos-conflict' });
    for (const name of ['a', 'b']) conflict.use({ name, phase: 'wire', resources: { same() {} }, install() {} });
    expect(() => conflict.sealModules()).toThrow(/claimed by both/);
  });

  it('attempts all shutdown hooks even when one fails and shares the close result', async () => {
    const c = new Container({ workspace: '/tmp/logos-close-errors' });
    const seen: string[] = [];
    c.use({ name: 'a', phase: 'wire', install() {}, close() { seen.push('a'); } });
    c.use({ name: 'b', phase: 'wire', requires: ['a'], install() {}, close() { seen.push('b'); throw new Error('close failure'); } });
    c.sealModules(); await c.installPhase('wire');
    const closing = c.closeModules();
    expect(c.closeModules()).toBe(closing);
    await expect(closing).rejects.toThrow('Module shutdown failed');
    expect(seen).toEqual(['b', 'a']);
  });

  it('propagates registrar failures while retaining ordinary event error semantics', async () => {
    const c = new Container({ workspace: '/tmp/logos-strict-events' });
    c.log = () => {};
    c.use({ name: 'example', phase: 'wire', install() {}, resources: { example() { throw new Error('invalid resource'); } } });
    c.sealModules(); await c.installPhase('wire');
    await expect(c.bus.emitStrict('register:example', {})).rejects.toThrow('invalid resource');
    await expect(c.bus.emit('register:example', {})).resolves.toBeUndefined();
    await c.closeModules();
    expect(c.bus.listeners('register:example')).toHaveLength(0);
  });
});
