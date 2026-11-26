import { afterEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import path from 'path';
import { compileType } from '../src/kernel/type-source';
import { getJsFilesRecursively, registerDeclarations, registerRoutes, scanCache } from '../src/kernel/scan';
import { bootstrap } from '../src/index';
import { stagePackage } from '../src/stabilizer/staging';
import { candidateHash } from '../src/stabilizer/candidate';
import { makeWorkspace } from './helpers';

const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); scanCache.clear(); });
const block = (registration: string) => `###\n# @register ${registration}\n#\n###\n`;

describe('native LógosType', () => {
  it('associates lexer comments with anonymous exported functions and keeps names optional', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', {
      'package.json': '{"type":"module"}',
      'actions.type': block('router') + 'exports.hello = -> "hello"\n' +
        block('arithmetic double') + 'module.exports.double = (n) -> n * 2\n',
    });
    const entries = await registerDeclarations(dir);
    expect(entries.map(e => [e.declaration.type, e.declaration.name])).toEqual([['router', 'hello'], ['arithmetic', 'double']]);
    expect(entries[0].handler()).toBe('hello');
    expect(entries[1].handler(21)).toBe(42);
    expect(entries.every(e => e.file.endsWith('.type'))).toBe(true);
    expect(fs.readdirSync(dir)).toEqual(['actions.type', 'package.json']);
  });

  it('supports local functions exported by name without installing a global loader', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const before = require.extensions['.type'];
    const dir = ws.pkg('sample', { 'actions.type': block('arithmetic answer') +
      'answer = -> 42\nexports.answer = answer\n',
    });
    const entries = await registerDeclarations(dir);
    expect(entries[0].handler()).toBe(42);
    expect(require.extensions['.type']).toBe(before);
  });

  it('passes router tags unchanged to the existing HTTP annotation parser', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', { 'routes.type':
      '###\n# @register router\n# @name status\n# @method get\n# @public true\n#\n###\nexports.status = (req, res) -> res.json ok: true\n',
    });
    const routes = await registerRoutes(dir);
    expect(routes).toHaveLength(1);
    expect(routes[0]).toMatchObject({ path: 'status', method: 'get', public: true });
  });

  it('ignores fake comments inside strings and emits original source maps', () => {
    const source = "text = '''\n###\n# @register arithmetic fake\n###\nexports.fake = -> 0\n'''\n" +
      block('arithmetic real') + 'exports.real = -> 42\n';
    const compiled = compileType(source, '/tmp/sample.type');
    expect(Object.keys(compiled.docs)).toEqual(['real']);
    const map = JSON.parse(Buffer.from(compiled.js.match(/base64,([^\n]+)/)![1], 'base64').toString());
    expect(map.sources).toContain('/tmp/sample.type');
    expect(map.sourcesContent).toEqual([source]);
  });

  it('loads LogosType and CoffeeScript extensions while keeping test files and nested packages outside the owning scan', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', {
      'actions.type': "helper = require './coffee.coffee'\n" + block('arithmetic actions') + 'exports.actions = -> helper.coffee()\n',
      'actions.test.type': '', 'tests/fixture.type': '',
      'nested/package.json': '{}', 'nested/actions.type': '', 'actions.js': '',
      'coffee.coffee': "helper = require './short.coffe'\n" + block('arithmetic coffee') + 'exports.coffee = -> helper.short()\n',
      'short.coffe': block('arithmetic short') + 'exports.short = -> 6 * 7\n',
      'think.think': "helper = require './short.coffe'\n" + block('arithmetic think') + 'exports.think = -> helper.short()\n',
      'ignored.spec.coffe': block('arithmetic ignored') + 'exports.ignored = -> 0\n',
    });
    expect(getJsFilesRecursively(dir).map(f => path.relative(dir, f)).sort()).toEqual([
      'actions.js', 'actions.type', 'coffee.coffee', 'short.coffe',
    ]);
    const entries = await registerDeclarations(dir);
    expect(entries.map(entry => entry.declaration.name).sort()).toEqual(['actions', 'coffee', 'short']);
    expect(entries.find(entry => entry.declaration.name === 'coffee')!.handler()).toBe(42);
    expect(entries.find(entry => entry.declaration.name === 'actions')!.handler()).toBe(42);
  });

  it('boots nested .type providers and mixed consumers using the existing authority boundary', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('modules/deep/provider', { 'package.json': '{"name":"provider"}',
      'index.type': block('type arithmetic') + 'arithmetic = (context) ->\n  contracts:\n    arithmetic: {input: ["number"], output: "number"}\n  resources:\n    arithmetic: (resource) -> context.state.set resource.declaration.name, resource.handler\n',
    });
    ws.pkg('abc/b/consumer', { 'package.json': '{"name":"consumer"}',
      'index.type': block('arithmetic double').replace('#\n###', '# @returns "number"\n###') + 'exports.double = (n) -> n * 2\n',
      'other.cjs': 'exports.triple = function triple(n) { /**\n * @register arithmetic triple\n * @returns "number"\n */ return n * 3; };',
    });
    const runtime = await bootstrap({ workspace: ws.root, externalModules: [] }); cleanup.push(() => runtime.close());
    const state = runtime.container.state('entrypoint:workspace:modules/deep/provider');
    expect(await state.get('double')(21)).toBe(42);
    expect(await state.get('triple')(14)).toBe(42);
  });

  it('reloads .type dependencies and retains the live generation after a compile failure', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', { 'package.json': '{"name":"sample"}',
      'helper.type': 'exports.value = 1\n',
      'actions.type': "helper = require './helper.type'\n" + block('arithmetic value') + 'exports.value = -> helper.value\n',
    });
    let live: readonly any[] = [];
    const runtime = await bootstrap({ workspace: ws.root, externalModules: [], hotReload: { enabled: false },
      modules: [{ name: 'arithmetic', phase: 'wire', install() {}, resources: { arithmetic: { prepare(next) {
        const old = live; return { commit() { live = next; }, rollback() { live = old; }, dispose() {} };
      } } } }] }); cleanup.push(() => runtime.close());
    expect(await live[0].handler()).toBe(1);
    const firstHash = candidateHash(dir);
    fs.writeFileSync(path.join(dir, 'helper.type'), 'exports.value = 2\n');
    expect(candidateHash(dir)).not.toBe(firstHash);
    expect((await stagePackage(runtime.container, 'sample')).ok).toBe(true);
    expect(await live[0].handler()).toBe(2);
    fs.writeFileSync(path.join(dir, 'actions.type'), block('arithmetic value') + 'exports.value = ( ->\n');
    const failed = await stagePackage(runtime.container, 'sample');
    expect(failed.ok).toBe(false);
    expect(await live[0].handler()).toBe(2);
  });

  it('executes .type inside the isolated runner with mediated authority', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('sample', { 'package.json': '{"name":"sample","isolated":true}',
      'helper.type': 'exports.factor = 2\n',
      'actions.type': "helper = require './helper.type'\n" + block('arithmetic double') +
        'exports.double = (n) -> n * helper.factor\n',
    });
    let handler: any;
    const runtime = await bootstrap({ workspace: ws.root, externalModules: ['isolated-runtime'],
      modules: [{ name: 'arithmetic', phase: 'wire', install() {}, resources: { arithmetic(resource) { handler = resource.handler; } } }] });
    cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('sample')).toEqual(expect.objectContaining({state: 'active'}));
    expect(await handler(21)).toBe(42);
  });

  it('denies .type dependencies escaping an isolated package', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('outside', { 'helper.type': 'exports.value = 42\n' });
    ws.pkg('sample', { 'package.json': '{"name":"sample","isolated":true}',
      'actions.type': "helper = require '../outside/helper.type'\n" + block('arithmetic value') + 'exports.value = -> helper.value\n',
    });
    const runtime = await bootstrap({ workspace: ws.root, externalModules: ['isolated-runtime'],
      modules: [{ name: 'arithmetic', phase: 'wire', install() {}, resources: { arithmetic() { throw new Error('must not publish'); } } }] });
    cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('sample').state).not.toBe('active');
  });

  it('reports syntax errors with the original .type filename and retries corrected source', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const dir = ws.pkg('sample', { 'broken.type': block('module broken') + 'exports.broken = ( ->\n' });
    await expect(registerDeclarations(dir, true)).rejects.toThrow(/broken\.type/);
    fs.writeFileSync(path.join(dir, 'broken.type'), block('module fixed') + 'exports.fixed = -> {}\n');
    expect((await registerDeclarations(dir, true))[0].declaration.name).toBe('fixed');
  });
});
