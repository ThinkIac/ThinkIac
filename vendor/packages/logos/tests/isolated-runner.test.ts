import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { IsolatedRunner } from '../src/core/isolated';
import { bootstrap } from '../src/index';
import { makeWorkspace } from './helpers';

const runners: IsolatedRunner[] = [];
afterEach(async () => { await Promise.all(runners.splice(0).map(runner => runner.stop('test_finished'))); });

function isolatedPackage(source: string) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-isolated-'));
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'isolated-demo', isolated: true }));
  fs.writeFileSync(path.join(dir, 'entry.js'), source);
  return dir;
}

describe('IsolatedRunner', () => {
  it('exposes arbitrary declarations and invokes their handler in the child', async () => {
    const dir = isolatedPackage(`
      exports.action = function action(value) { /**
       * @register fulano
       * @name example
       * @option first
       * @option second
       */ return value * 2; };
    `);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir });
    runners.push(runner);
    const manifest = await runner.start();
    expect(manifest.declarations[0].declaration).toMatchObject({ type: 'fulano', name: 'example', tags: { option: ['first', 'second'] } });
    await expect(runner.invoke(manifest.declarations[0].id, [21])).resolves.toBe(42);
  });
  it('loads and executes package code only in its child process', async () => {
    const dir = isolatedPackage(`
      exports.double = value => { /** @register_tool double @param {number} value - value */ return value * 2; };
    `);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir });
    runners.push(runner);

    const manifest = await runner.start();
    expect(manifest.tools).toHaveLength(1);
    expect(runner.pid).not.toBe(process.pid);
    await expect(runner.invoke(manifest.tools[0].id, [21])).resolves.toBe(42);
  });

  it('preserves @public route metadata across the isolated boundary', async () => {
    const dir = isolatedPackage(`
      exports.publicRoute = () => { /** @register_router public @public */ return { ok: true }; };
      exports.privateRoute = () => { /** @register_router private */ return { ok: true }; };
    `);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir });
    runners.push(runner);

    const manifest = await runner.start();
    expect(manifest.routes.map(route => ({ path: route.path, public: (route as any).public }))).toEqual([
      { path: 'public', public: true },
      { path: 'private', public: false },
    ]);
  });

  it('mediates child event emission through the host callback', async () => {
    const dir = isolatedPackage(`
      const { emit } = require('logos');
      exports.announce = async ({ message }) => { /** @register_tool announce */ await emit('isolated-demo:announced', { message }); return { ok: true }; };
    `);
    const onEvent = vi.fn(async () => undefined);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir, onEvent });
    runners.push(runner);

    const manifest = await runner.start();
    await expect(runner.invoke(manifest.tools[0].id, [{ message: 'hello' }])).resolves.toEqual({ ok: true });
    expect(onEvent).toHaveBeenCalledWith('isolated-demo:announced', { message: 'hello' });
  });

  it('denies ambient Node capabilities instead of letting a package bypass IPC', async () => {
    const dir = isolatedPackage(`
      exports.probe = () => { /** @register_tool probe */
        try { require('node:net'); return 'escaped'; }
        catch (error) { return error.message; }
      };
    `);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir });
    runners.push(runner);

    const manifest = await runner.start();
    await expect(runner.invoke(manifest.tools[0].id, [])).resolves.toMatch(/Native module access is denied/);
  });

  it('rejects pending calls and stops the child', async () => {
    const dir = isolatedPackage(`
      exports.wait = () => { /** @register_tool wait */ return new Promise(() => {}); };
    `);
    const runner = new IsolatedRunner({ folder: 'isolated-demo', dir });
    runners.push(runner);
    await runner.start();
    const pending = runner.invoke(runner.surfaces!.tools[0].id, []);
    const expected = expect(pending).rejects.toThrow('shutdown');
    await runner.stop('shutdown');
    await expected;
    expect(runner.running).toBe(false);
  });

  it('wires an isolated tool through the real runtime without importing it in the host', async () => {
    const workspace = makeWorkspace('logos-isolated-bootstrap-');
    let instance: any;
    try {
      workspace.pkg('vaulted', {
        'package.json': JSON.stringify({
          name: 'vaulted', isolated: true,
          runtime: { contractVersion: 1, provides: { services: {}, tools: ['vaulted.double'], events: [] }, requires: { services: {} },
            permissions: { tools: { invoke: [], exposeToAgents: ['vaulted.double'], administer: [] }, events: { publish: [], subscribe: [], transform: [], veto: [], request: [] }, data: { database: ['self'], files: [], secrets: [] }, network: [], process: { spawn: [] }, ui: [] } },
        }),
        'tools.js': '/** @register_tool double */\nfunction double({ value }) { return value * 2; }\nexports.double = double;',
      });
      instance = await bootstrap({ workspace: workspace.root, port: false, views: { enabled: false } });
      await expect(instance.bus.pipeline('tool:call', { package: 'vaulted', tool: 'double', args: { value: 21 } })).resolves.toBe(42);
    } finally {
      await instance?.close(); workspace.cleanup();
    }
  });

});
