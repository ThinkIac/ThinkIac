import fs from 'node:fs';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { PackageRegistry } from '../src/kernel/registry';
import { stagePackage } from '../src/stabilizer/staging';
import { makeWorkspace } from './helpers';

const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
const settings = (workspace: string) => ({ workspace, externalModules: [], workers: false as const, hotReload: { enabled: false } });

describe('one workspace package model', () => {
  it.each(['modules/arithmetic', 'abc/b/arithmetic'])('composes a provider at %s and a consumer declared earlier', async location => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('aaa/consumer', { 'package.json': '{"name":"consumer"}',
      'index.mjs': 'export function double(n) { /** @register arithmetic double */ return n * 2; }' });
    ws.pkg(location, { 'package.json': '{"name":"@scope/arithmetic"}', 'index.cjs': `
      exports.lifecycle = function lifecycle(context) {
        /** @register module arithmetic */
        return { install() { context.state.set('started', true); }, close() { context.state.set('closed', true); } };
      };
      exports.accept = function accept(resource, context) {
        /**
         * @register type arithmetic
         * @requires arithmetic
         */
        context.state.set(resource.declaration.name, resource.handler);
      };
      exports.local = function local(n) { /** @register arithmetic local */ return n + 1; };
    ` });
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    const state = runtime.container.state('entrypoint:workspace:' + location);
    expect(runtime.container.registry.getState('aaa/consumer')?.error).toBeUndefined();
    expect(state.get('started')).toBe(true);
    expect(await state.get('double')(4)).toBe(8);
    expect(await state.get('local')(4)).toBe(5);
    expect(runtime.container.registry.getState(location)?.state).toBe('active');
    await runtime.close(); expect(state.get('closed')).toBe(true);
  });

  it('does not register child files under their parent and ignores symlink cycles', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('parent', { 'package.json': '{"name":"parent"}' });
    ws.pkg('parent/a/b/child', { 'package.json': '{"name":"child"}', 'index.cjs': `
      exports.provider = function provider() { /** @register module child */ return {}; };
    ` });
    fs.symlinkSync(ws.root, path.join(ws.root, 'cycle'), 'dir');
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    expect([...runtime.container.modules.keys()]).toEqual(['child']);
    expect(runtime.container.registry.discover().map(pkg => pkg.name)).toEqual(['parent', 'child']);
  });

  it('loads ordinary consumer files only after providers install', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const marker = path.join(ws.root, '.provider-ready');
    ws.pkg('zzz/provider', { 'package.json': '{"name":"provider"}', 'module.cjs': `
      exports.provider = function provider() {
        /** @register module provider */
        return { install() { require('node:fs').writeFileSync(${JSON.stringify(marker)}, 'ready'); } };
      };
      exports.type = function type() { /** @register type example */ };
    ` });
    ws.pkg('aaa/consumer', { 'package.json': '{"name":"consumer"}', 'resource.cjs': `
      if (!require('node:fs').existsSync(${JSON.stringify(marker)})) throw Error('provider not installed');
      exports.resource = function resource() { /** @register example value */ };
    ` });
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('aaa/consumer')?.state).toBe('active');
  });

  it('rejects duplicate manifest identities with both paths', () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    for (const folder of ['modules/one', 'abc/b/two']) ws.pkg(folder, { 'package.json': '{"name":"same"}' });
    expect(() => new PackageRegistry(ws.root).discover()).toThrow(/duplicate package name.*same.*abc\/b\/two.*modules\/one/);
  });

  it('diagnoses a missing type with the consumer and source file', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('abc/b/consumer', { 'package.json': '{"name":"consumer"}',
      'index.cjs': 'exports.action = function action() { /** @register absent action */ };' });
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    expect(runtime.container.registry.getState('abc/b/consumer')).toMatchObject({ state: 'denied_contract', error: expect.stringMatching(/missing resource type "absent".*abc\/b\/consumer.*index.cjs/) });
  });

  it('rejects provider hot-add repeatedly without contaminating the sealed catalog', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    ws.pkg('abc/b/provider', { 'package.json': '{"name":"provider"}',
      'index.cjs': 'exports.provider = function provider() { /** @register module late */ return {}; };' });
    const activate = runtime.container.state('runtime').get('activatePackage');
    for (let attempt = 0; attempt < 2; attempt++) {
      expect(await activate('abc/b/provider')).toMatchObject({ ok: false, error: expect.stringMatching(/sealed/) });
      expect(runtime.container.modules.has('late')).toBe(false);
    }
  });

  it('rejects duplicate type owners before any module installs', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    for (const folder of ['first', 'nested/second']) ws.pkg(folder, { 'package.json': JSON.stringify({ name: folder }), 'index.js': `
      exports.type = function type() { /** @register type same */ };
    ` });
    await expect(bootstrap(settings(ws.root))).rejects.toThrow(/duplicate type.*same/);
  });

  it('keeps transactional generations on failed reload and removes resource declarations', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('modules/arithmetic', { 'package.json': '{"name":"arithmetic"}', 'index.cjs': `
      exports.accept = function accept(next, context, snapshot) {
        /**
         * @register type arithmetic
         * @transactional
         */
        const key = 'live:' + snapshot.package;
        const previous = context.state.get(key);
        return {
          commit() { context.state.set(key, next); if (next.some(r => r.declaration.name === 'reject')) throw Error('rejected'); },
          rollback() { context.state.set(key, previous); },
          dispose() { if (context.state.get(key) === next) context.state.delete(key); }
        };
      };
    ` });
    const write = (name: string, value: number) => ws.pkg('abc/b/consumer', { 'package.json': '{"name":"consumer"}',
      'index.cjs': `exports.value = function value() { /** @register arithmetic ${name} */ return ${value}; };` });
    write('value', 1);
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    const live = () => runtime.container.state('entrypoint:workspace:modules/arithmetic').get('live:abc/b/consumer');
    expect(runtime.container.registry.getState('abc/b/consumer')?.error).toBeUndefined();
    expect(await live()[0].handler()).toBe(1);
    write('value', 2); expect((await stagePackage(runtime.container, 'abc/b/consumer')).ok).toBe(true);
    expect(await live()[0].handler()).toBe(2);
    write('reject', 3); expect((await stagePackage(runtime.container, 'abc/b/consumer')).ok).toBe(false);
    expect(await live()[0].handler()).toBe(2);
    ws.pkg('abc/b/consumer', { 'index.cjs': 'exports.value = function value() { /** @register arithmetic value */ }; throw Error("load failed");' });
    expect((await stagePackage(runtime.container, 'abc/b/consumer')).ok).toBe(false);
    expect(await live()[0].handler()).toBe(2);
    ws.pkg('abc/b/consumer', { 'index.cjs': 'exports.value = () => 4;' });
    expect((await stagePackage(runtime.container, 'abc/b/consumer')).ok).toBe(true);
    expect(live()).toEqual([]);
  });

  it('discovers a shipped provider in any directory without a factory export', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const source = path.resolve(__dirname, '../../modules/env');
    const destination = path.join(ws.root, 'abc/b/env');
    fs.mkdirSync(destination, { recursive: true });
    fs.copyFileSync(path.join(source, 'package.json'), path.join(destination, 'package.json'));
    const code = fs.readFileSync(path.join(source, 'index.cjs'), 'utf8')
      .replace(/module\.exports\.createRuntimeModule = provideEnv;/, '')
      .replace("requireCapabilityDependency('@thinkiac/module-runtime-compat', '../runtime-compat')", `require(${JSON.stringify(path.resolve(__dirname, '../../modules/runtime-compat'))})`);
    fs.writeFileSync(path.join(destination, 'index.cjs'), code);
    const runtime = await bootstrap(settings(ws.root)); cleanup.push(() => runtime.close());
    expect(runtime.container.modules.has('env')).toBe(true);
  });
});
