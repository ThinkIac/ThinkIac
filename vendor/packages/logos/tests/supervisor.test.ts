import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { bootstrap, stopPackage, startPackage, recoverIsolatedPackage } from '../src/index';
import { stagePackage } from '../src/stabilizer/staging';
import { makeWorkspace } from './helpers';
const { createRuntimeModule } = require('../../modules/supervisor/runtime.cjs');
const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
async function until(fn: () => any, ms = 6000) {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) { if (await fn()) return; await delay(30); }
  throw new Error('Condition timed out');
}
function manifest() {
  return { name: 'vaulted', isolated: true,
    runtime: { supervision: { delayMs: 30, maxDelayMs: 60, maxRestarts: 3 }, contractVersion: 1,
      provides: { services: {}, tools: ['vaulted.double'], events: [] }, requires: { services: {} },
      permissions: { tools: { invoke: [], exposeToAgents: ['vaulted.double'], administer: [] }, events: { publish: [], subscribe: [], transform: [], veto: [], request: [] }, data: { database: ['self'], files: [], secrets: [] }, network: [], process: { spawn: [] }, ui: [] } } };
}
describe('Logos supervisor integration', () => {
  it('recovers a killed child and its tools, persists stop across boot, starts explicitly', async () => {
    const w = makeWorkspace('logos-supervised-');
    let runtime: any;
    const config = { workspace: w.root, port: false as const, views: { enabled: false }, hotReload: { enabled: false }, modules: [createRuntimeModule({ recoverIsolatedPackage })] };
    w.pkg('vaulted', { 'package.json': JSON.stringify(manifest()), 'tools.js': '/** @register_tool double */\nfunction double({ value }) { return value * 2; }\nexports.double = double;' });
    try {
      runtime = await bootstrap(config);
      const old = runtime.container.state('isolated').get('vaulted').pid;
      process.kill(old, 'SIGKILL');
      await until(() => runtime.container.registry.getState('vaulted')?.state === 'active' && runtime.container.state('isolated').get('vaulted')?.pid !== old);
      expect(await runtime.bus.pipeline('tool:call', { package: 'vaulted', tool: 'double', args: { value: 21 } })).toBe(42);
      expect(runtime.container.state('supervisor').get('controller').snapshot('vaulted').restarts).toBe(1);
      expect((await stopPackage(runtime.container, 'vaulted')).ok).toBe(true);
      expect(runtime.container.state('isolated').get('vaulted')).toBeUndefined();
      expect((await stagePackage(runtime.container, 'vaulted')).ok).toBe(false);
      await runtime.close(); runtime = await bootstrap(config);
      expect(runtime.container.registry.getState('vaulted').state).toBe('stopped');
      expect(runtime.container.state('isolated').get('vaulted')).toBeUndefined();
      expect((await startPackage(runtime.container, 'vaulted')).ok).toBe(true);
      expect(await runtime.bus.pipeline('tool:call', { package: 'vaulted', tool: 'double', args: { value: 5 } })).toBe(10);
    } finally { await runtime?.close(); w.cleanup(); }
  }, 20000);
  it('isolated hot reload replaces child and rejected candidate keeps healthy child', async () => {
    const w = makeWorkspace('logos-supervised-stage-'); let runtime: any;
    const dir = w.pkg('vaulted', { 'package.json': JSON.stringify(manifest()), 'tools.js': '/** @register_tool double */\nfunction double({ value }) { return value * 2; }\nexports.double = double;' });
    try {
      runtime = await bootstrap({ workspace: w.root, port: false, views: { enabled: false }, modules: [createRuntimeModule({ recoverIsolatedPackage })] });
      const old = runtime.container.state('isolated').get('vaulted').pid;
      fs.writeFileSync(path.join(dir, 'tools.js'), '/** @register_tool double */\nfunction double({ value }) { return value * 3; }\nexports.double = double;');
      expect((await stagePackage(runtime.container, 'vaulted')).ok).toBe(true);
      const current = runtime.container.state('isolated').get('vaulted').pid;
      expect(current).not.toBe(old);
      expect(await runtime.bus.pipeline('tool:call', { package: 'vaulted', tool: 'double', args: { value: 2 } })).toBe(6);
      fs.writeFileSync(path.join(dir, 'tools.js'), 'not valid JavaScript !');
      await expect(stagePackage(runtime.container, 'vaulted')).rejects.toThrow();
      expect(runtime.container.state('isolated').get('vaulted').pid).toBe(current);
      expect(await runtime.bus.pipeline('tool:call', { package: 'vaulted', tool: 'double', args: { value: 2 } })).toBe(6);
    } finally { await runtime?.close(); w.cleanup(); }
  }, 20000);
});
