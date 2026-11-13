// tests/manifest.test.ts — auto-generated capability manifest from @register_*
// tags (the same scan output the runtime wires from).

import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { generateManifest, writeManifest } from '../src/kernel/manifest';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ''; scanCache.clear(); });
afterEach(() => ws.cleanup());

function samplePackage(): string {
  return ws.pkg('sample', {
    'package.json': '{"name":"sample","version":"3.1.0","description":"a demo"}',
    'tools.js': '/**\n * @register_tool ping\n * @description pings\n */\nexports.ping = function ping() { return "pong"; };',
    'hooks.js': '/**\n * @register_hook boot\n * @priority 20\n */\nexports.h = function h() {};',
    'routes.js': '/**\n * @register_router status\n * @method get\n */\nexports.status = function status(req, res) { return res.json({}); };',
    'commands.js': '/**\n * @register_command run\n * @description runs\n */\nexports.run = function run() {};',
  });
}

describe('generateManifest', () => {
  it('collects tools, hooks, routes and commands with package metadata', async () => {
    const dir = samplePackage();
    const m = await generateManifest(dir);
    expect(m).toMatchObject({ name: 'sample', version: '3.1.0', description: 'a demo' });
    expect(m.tools[0]).toMatchObject({ name: 'ping', description: 'pings', reach: 'auto' });
    expect(m.hooks[0]).toMatchObject({ event: 'boot', priority: 20 });
    expect(m.routes[0]).toMatchObject({ path: 'status', method: 'get' });
    expect(m.commands[0]).toMatchObject({ name: 'run', description: 'runs' });
    expect(typeof m.generatedAt).toBe('string');
  });

  it('falls back to the folder name when package.json is absent', async () => {
    const dir = ws.pkg('nameless', { 'tools.js': '/**\n * @register_tool t\n */\nexports.t = function t() {};' });
    const m = await generateManifest(dir);
    expect(m.name).toBe('nameless');
  });

  it('throws for a missing folder', async () => {
    await expect(generateManifest('no-such-folder')).rejects.toThrow(/Folder not found/);
  });
});

describe('writeManifest', () => {
  it('writes logos.json into the package folder and returns its path', async () => {
    const dir = samplePackage();
    const out = await writeManifest(dir);
    expect(out).toBe(path.join(dir, 'logos.json'));
    const written = JSON.parse(fs.readFileSync(out, 'utf-8'));
    expect(written.name).toBe('sample');
    expect(written.tools.map((t: any) => t.name)).toEqual(['ping']);
  });
});
