// tests/scan.test.ts — file discovery + decorator registration against real
// .js fixture packages (the scanner reads source and require()s the files, so
// in-memory functions won't do — comments would be lost).

import fs from 'fs';
import path from 'path';
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import {
  getJsFilesRecursively, resolveAgentFolder, scanCache,
  registerTools, registerHooks, registerRoutes, registerDeclarations,
} from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(() => { ws.cleanup(); });

describe('getJsFilesRecursively', () => {
  it('finds .js files recursively but skips ignored/dot dirs', () => {
    ws.pkg('p', {
      'a.js': '', 'sub/b.js': '', 'readme.md': '',
      'node_modules/dep.js': '', '.cache/c.js': '',
    });
    const files = getJsFilesRecursively(path.join(ws.root, 'p')).map(f => path.basename(f)).sort();
    expect(files).toEqual(['a.js', 'b.js']);
  });

  it('returns [] for a missing dir', () => {
    expect(getJsFilesRecursively('/no/such/dir')).toEqual([]);
  });
});

it('discovers modern router and hook declarations without legacy markers', async () => {
  const dir = ws.pkg('modern', {
    'route.js': '/**\n * @register router /abc\n * @method GET\n */\nexports.route = function route() { return {}; };',
    'hook.js': 'exports.hook = function hook(payload) { /**\n * @register hook\n * @name sample:event\n */ return payload; };',
  });
  expect((await registerRoutes(dir)).map((route: any) => route.path)).toEqual(['abc']);
  expect((await registerHooks(dir)).map((hook: any) => hook.event)).toEqual(['sample:event']);
});

it('discovers arbitrary declarations with their exported handler and source', async () => {
  const dir = ws.pkg('custom', {
    'handler.js': '/**\n * @register fulano\n * @name example\n * @option value\n */\nexports.action = function action() { return 42; };',
  });
  const [entry] = await registerDeclarations(dir);
  expect(entry.declaration).toMatchObject({ type: 'fulano', name: 'example', tags: { option: ['value'] } });
  expect(entry.handler()).toBe(42);
  expect(entry.file).toBe(path.join(dir, 'handler.js'));
});

describe('resolveAgentFolder', () => {
  it('resolves a folder name against the workspace', () => {
    process.env.PACKAGES_PATH = ws.root;
    ws.pkg('alpha', { 'x.js': '' });
    expect(resolveAgentFolder('alpha')).toBe(path.join(ws.root, 'alpha'));
  });

  it('resolves an existing absolute path and returns null otherwise', () => {
    const dir = ws.pkg('beta', { 'x.js': '' });
    expect(resolveAgentFolder(dir)).toBe(dir);
    expect(resolveAgentFolder('does-not-exist')).toBeNull();
    expect(resolveAgentFolder('')).toBeNull();
  });
});

describe('registerTools (end-to-end scan)', () => {
  it('reads @register_tool with an above-declaration doc and builds a JSON schema', async () => {
    const dir = ws.pkg('mathpkg', {
      'tools.js': [
        '/**',
        ' * @register_tool add',
        ' * @description adds two numbers',
        ' * @param {number} a - first',
        ' * @param {number?} b - second',
        ' */',
        'exports.add = function add(args) { return args.a + (args.b || 0); };',
      ].join('\n'),
    });
    const tools = await registerTools(dir);
    expect(tools.length).toBe(1);
    const t = tools[0];
    expect(t.name).toBe('add');
    expect(t.description).toBe('adds two numbers');
    expect(t.parameters.type).toBe('object');
    expect(t.parameters.properties.a).toEqual({ type: 'number', description: 'first' });
    expect(t.parameters.required).toEqual(['a']); // b is optional
    expect(typeof t.call).toBe('function');
    expect(await t.call({ a: 2, b: 3 })).toBe(5);
  });

  it('converts array param types (string[]) to a JSON-Schema array', async () => {
    const dir = ws.pkg('arr', {
      'tools.js': [
        '/**',
        ' * @register_tool tag',
        ' * @param {string[]} labels - the labels',
        ' */',
        'exports.tag = function tag() {};',
      ].join('\n'),
    });
    const [t] = await registerTools(dir);
    expect(t.parameters.properties.labels).toEqual({
      type: 'array', items: { type: 'string' }, description: 'the labels',
    });
  });

  it('emits enum and x-enumSource in the JSON schema', async () => {
    const dir = ws.pkg('enumpkg', {
      'tools.js': [
        '/**',
        ' * @register_tool publish',
        ' * @param {string} status - the state @enum draft,published',
        ' * @param {string} channel - target @enumSource tool:ntfy/listNtfyChannels#name',
        ' */',
        'exports.publish = function publish() {};',
      ].join('\n'),
    });
    const [t] = await registerTools(dir);
    expect(t.parameters.properties.status).toEqual({
      type: 'string', description: 'the state', enum: ['draft', 'published'],
    });
    expect(t.parameters.properties.channel).toEqual({
      type: 'string', description: 'target', 'x-enumSource': 'tool:ntfy/listNtfyChannels#name',
    });
  });

  it('skips files without a @register_ marker', async () => {
    const dir = ws.pkg('mixed', {
      'plain.js': 'exports.x = () => 1;',
      'tools.js': '/**\n * @register_tool only\n */\nexports.only = function only() { return 1; };',
    });
    const tools = await registerTools(dir);
    expect(tools.map((t: any) => t.name)).toEqual(['only']);
  });

  it('throws for an unresolvable folder', async () => {
    await expect(registerTools('nope-not-here')).rejects.toThrow(/Folder not found/);
  });

  it('serves a second scan from cache until an mtime changes', async () => {
    const dir = ws.pkg('cachetest', {
      'tools.js': '/**\n * @register_tool one\n */\nexports.one = function one() { return 1; };',
    });
    const first = await registerTools(dir);
    const second = await registerTools(dir);
    expect(second).toBe(first); // identical reference → cache hit

    // Change the file (and bump mtime) → fresh scan, different reference.
    const file = path.join(dir, 'tools.js');
    fs.writeFileSync(file, '/**\n * @register_tool one\n */\nexports.one = function one() { return 1; };\n/**\n * @register_tool two\n */\nexports.two = function two() { return 2; };');
    fs.utimesSync(file, new Date(Date.now() + 2000), new Date(Date.now() + 2000));
    const third = await registerTools(dir);
    expect(third).not.toBe(first);
    expect(third.map((t: any) => t.name).sort()).toEqual(['one', 'two']);
  });
});

describe('registerHooks / registerRoutes', () => {
  it('reads hooks with priority and routes with method', async () => {
    const dir = ws.pkg('web', {
      'hooks.js': '/**\n * @register_hook user:created\n * @priority 5\n */\nexports.h = function h() {};',
      'routes.js': '/**\n * @register_router ping\n * @method post\n */\nexports.ping = function ping(req, res) { return res.json({ ok: true }); };',
    });
    const hooks = await registerHooks(dir);
    const routes = await registerRoutes(dir);
    expect(hooks[0]).toMatchObject({ event: 'user:created', priority: 5 });
    expect(routes[0]).toMatchObject({ path: 'ping', method: 'post' });
  });

});


describe('runtime discovery regressions', () => {
  it('never executes tests or their fixtures, even when they contain registration markers', async () => {
    const marker = path.join(ws.root, 'test-executed');
    const testSource = `// @register_router accidental
require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'executed');`;
    const dir = ws.pkg('production', {
      'routes.js': '/**\n * @register_router ping\n */\nexports.ping = function ping() { return { ok: true }; };',
      'routes.test.js': testSource,
      'nested/routes.spec.js': testSource,
      'test/fixture.js': testSource,
      'tests/nested/fixture.js': testSource,
      '__tests__/fixture.js': testSource,
      'nested/test/fixture.js': testSource,
      'nested/contest.js': 'exports.value = 1;',
    });
    expect(getJsFilesRecursively(dir).map(file => path.relative(dir, file)).sort())
      .toEqual(['nested/contest.js', 'routes.js']);
    const routes = await registerRoutes(dir);
    expect(routes.map((route: any) => route.path)).toEqual(['ping']);
    expect(fs.existsSync(marker)).toBe(false);
  });

  it('reports failed imports with their file and reason while preserving working routes', async () => {
    const dir = ws.pkg('partial', {
      'broken.js': "// @register_router broken\nrequire('node:async');",
      'routes.js': '/**\n * @register_router ping\n */\nexports.ping = function ping() { return { ok: true }; };',
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const routes = await registerRoutes(dir);
      expect(routes.map((route: any) => route.path)).toEqual(['ping']);
      expect(warn).toHaveBeenCalledWith(expect.stringContaining(path.join(dir, 'broken.js')));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('node:async'));
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('[scan:routes]'));
    } finally { warn.mockRestore(); }
  });
});
