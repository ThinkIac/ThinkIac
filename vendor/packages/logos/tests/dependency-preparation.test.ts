import { describe, it, expect, vi, afterEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { makeWorkspace } from './helpers';
const factory = require('../../modules/stabilizer/runtime/dependencies.cjs');
const workspaces: ReturnType<typeof makeWorkspace>[] = [];
afterEach(() => { vi.unstubAllEnvs(); workspaces.splice(0).forEach(ws => ws.cleanup()); });
function setup() {
  const ws = makeWorkspace(); workspaces.push(ws);
  const children: EventEmitter[] = [];
  const spawn = vi.fn(() => { const child = new EventEmitter(); children.push(child); return child; });
  const exports: any = {};
  factory((id: string) => id === 'node:child_process' ? { spawn } : require(id), {}, exports);
  const installer = new exports.DependencyInstaller({ workspace: ws.root, log() {} });
  return { ws, children, spawn, installer };
}
describe('module-owned dependency preparation', () => {
  it('recognizes packages without a CommonJS entry and omits development dependencies in production', async () => {
    const { ws, spawn, installer } = setup();
    ws.pkg('sample', { 'package.json': JSON.stringify({ dependencies: { 'exports-only': '*' }, devDependencies: { missing: '*' } }) });
    ws.pkg('sample/node_modules/exports-only', { 'package.json': '{"name":"exports-only","exports":{"import":"./index.mjs"}}' });
    vi.stubEnv('NODE_ENV', 'production');
    expect(await installer.ensureDeps('sample')).toBe(false);
    expect(spawn).not.toHaveBeenCalled();
  });
  it('propagates installation failure and retries without recording a successful fingerprint', async () => {
    const { ws, children, spawn, installer } = setup();
    ws.pkg('sample', { 'package.json': '{"dependencies":{"missing":"*"}}' });
    const first = installer.ensureDeps('sample');
    const rejected = expect(first).rejects.toThrow(/npm install failed/);
    await new Promise(resolve => setImmediate(resolve)); children[0].emit('close', 1, null);
    await rejected;
    expect(installer.depsFingerprint.has('sample')).toBe(false);
    const retry = installer.ensureDeps('sample');
    await new Promise(resolve => setImmediate(resolve)); children[1].emit('close', 0, null);
    expect(await retry).toBe(true);
    expect(spawn.mock.calls[0][1]).toEqual(expect.arrayContaining(['--workspaces=false', '--no-save']));
    expect(spawn.mock.calls[0][2].cwd).toBe(ws.root + '/sample');
  });
});
