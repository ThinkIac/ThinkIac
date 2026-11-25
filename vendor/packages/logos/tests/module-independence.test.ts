import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { currentAuthority } from '../src/kernel/authority-context';
import { Container } from '../src/kernel/container';
import { makeWorkspace } from './helpers';

const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('independent module composition', () => {
  it('requires the isolation module before loading an isolated package', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('sample', { 'package.json': '{"name":"sample","isolated":true}',
      'actions.js': 'throw new Error("isolated source must not execute in host");' });
    const runtime = await bootstrap({ workspace: ws.root, externalModules: [] });
    cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('sample').state).toBe('denied_contract');
    expect(runtime.container.state('isolated').size).toBe(0);
  });
  it('mediates a new isolated capability without adding a kernel handler', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('native', {
      'package.json': '{"name":"native","main":"index.cjs","runtime":{"role":"module"}}',
      'index.cjs': `exports.register = context => context.register({
        name: 'arithmetic', phase: 'wire', install() {},
        capabilities: { arithmetic(request, owner) {
          if (owner.package !== 'sample') throw new Error('Wrong owner');
          return request.value * 2;
        } },
        resources: { arithmetic: resource => context.state.set('call', resource.handler) }
      });`,
    });
    ws.pkg('sample', {
      'package.json': '{"name":"sample","isolated":true}',
      'actions.js': `exports.call = function(value) { /** @register arithmetic call */
        return require('logos').requestCapability({ surface: 'arithmetic', value });
      };`,
    });
    const runtime = await bootstrap({ workspace: ws.root, externalModules: ['isolated-runtime', './native'] });
    cleanup.push(() => runtime.close());
    const handler = runtime.container.state('entrypoint:./native').get('call');
    expect(await handler(21)).toBe(42);
    await runtime.close(); expect(runtime.container.state('runtime:capabilities').size).toBe(0);
  });

  it('rejects duplicate mediated capabilities before installation', () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const container = new Container({ workspace: ws.root });
    for (const name of ['one', 'two']) container.use({ name, phase: 'boot', install() {}, capabilities: { custom() {} } });
    expect(() => container.sealModules()).toThrow(/capability.*claimed by both/);
  });

  it('runs native event registration with a scoped context and cleans entrypoint subscriptions', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('native', {
      'package.json': '{"main":"index.cjs","runtime":{"role":"module"}}',
      'index.cjs': `exports.register = context => {
        if (context.http || context.container || context.authority || context.registry) throw new Error('unrestricted context');
        context.on('custom:event', () => context.state.set('called', true));
        context.register({ name: 'native', phase: 'wire', install(ctx) {
          ctx.state.set('sameContext', ctx === context);
          try { ctx.register({ name: 'late', phase: 'wire', install() {} }); }
          catch (error) { ctx.state.set('lateError', error.message); }
        } });
      };`,
    });
    const runtime = await bootstrap({ workspace: ws.root, externalModules: ['./native'] });
    cleanup.push(() => runtime.close());
    const state = runtime.container.state('entrypoint:./native');
    expect(state.get('sameContext')).toBe(true);
    expect(state.get('lateError')).toMatch(/only during/);
    await runtime.bus.emit('custom:event'); expect(state.get('called')).toBe(true);
    expect(runtime.workers).toBeNull(); expect(runtime.stabilizer).toBeNull();
    await runtime.close(); expect(runtime.bus.listeners('custom:event')).toHaveLength(0);
  });

  it('preserves the authority of tools when a second runtime is created', async () => {
    const one = makeWorkspace(); const two = makeWorkspace(); cleanup.push(one.cleanup, two.cleanup);
    for (const ws of [one, two]) ws.pkg('sample', {
      'package.json': '{"name":"sample"}',
      'tools.js': 'exports.inspect = function(args, context) { /** @register_tool inspect */ return context.authority(); };',
    });
    const first = await bootstrap({ workspace: one.root, externalModules: ['tools'] }); cleanup.push(() => first.close());
    const second = await bootstrap({ workspace: two.root, externalModules: ['tools'] }); cleanup.push(() => second.close());
    const api = first.container.state('external-api').get('tools');
    const tools = await api.loadMcpTools(one.root);
    expect(await tools[0].handler({}, { authority: () => currentAuthority().access })).toBe(first.container.authority);
  });

  it('keeps view broadcasts bound to their originating runtime', async () => {
    const one = makeWorkspace(); const two = makeWorkspace(); cleanup.push(one.cleanup, two.cleanup);
    const config = { externalModules: ['http', 'websocket-runtime', 'svelte'], port: false as const, views: { enabled: false } };
    const first = await bootstrap({ ...config, workspace: one.root }); cleanup.push(() => first.close());
    const second = await bootstrap({ ...config, workspace: two.root }); cleanup.push(() => second.close());
    const seen: string[] = [];
    first.container.state('ws').get('hub').broadcast = () => seen.push('first');
    second.container.state('ws').get('hub').broadcast = () => seen.push('second');
    first.container.state('views').set('engine', { setTheme() {} });
    first.container.state('external-api').get('views').setTheme({});
    expect(seen).toEqual(['first']);
  });
});
