import { describe, expect, it, afterEach } from 'vitest';
import { bootstrap } from '../src/index';
import { compileType, loadType } from '../src/kernel/type-source';
import { Container } from '../src/kernel/container';
import { assertValue, checkType, typedResource } from '../src/kernel/resource-types';
import { makeWorkspace } from './helpers';
const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });
async function boot(alias: string, body = 'double = (n) -> n * 2', returns = '"number"', contract = true, isolated = false) {
  const ws = makeWorkspace(); cleanup.push(ws.cleanup);
  ws.pkg('providers/deep/arithmetic', { 'package.json': '{"name":"arithmetic"}', 'index.type': `###
@register ${alias} arithmetic
###
arithmetic = (ctx) ->
  resources:
    arithmetic: (resource) -> ctx.state.set resource.declaration.name, resource.handler
${contract ? '  contracts:\n    arithmetic:\n      input: ["number"]\n      output: "number"' : ''}
` });
  ws.pkg('consumers/deep/sample', { 'package.json': JSON.stringify({name: 'sample', isolated}), 'index.type': `###\n@register arithmetic\n${returns ? '@returns ' + returns : ''}\n###\n${body}\n` });
  const runtime = await bootstrap({ workspace: ws.root, externalModules: isolated ? ['isolated-runtime'] : [] });
  cleanup.push(() => runtime.close()); return runtime;
}
const handler = (r: any) => r.container.state('entrypoint:workspace:providers/deep/arithmetic').get('double');
describe('LógosType contracts', () => {
  it('preserves advisory JSDoc on legacy JavaScript resources', () => {
    const container = new Container();
    const handler = (value: object) => value;
    const resource = {
      file: '/legacy/index.js', handler,
      declaration: { type: 'tool', tags: { params: ['{}', '{object} value'] } },
    };
    expect(typedResource(container, resource)).toBe(resource);
  });
  for (const alias of ['module', 'type']) it(`${alias} uses the same typed contract`, async () => {
    const fn = handler(await boot(alias));
    expect(fn(21)).toBe(42);
    expect(() => fn('21')).toThrow(/input\[0\].*number/);
    expect(() => fn()).toThrow(/expected 1 arguments/);
  });
  it('checks resolved asynchronous output', async () => {
    const fn = handler(await boot('type', 'double = (n) -> Promise.resolve "wrong"'));
    await expect(fn(21)).rejects.toThrow(/output.*number/);
  });
  it('checks synchronous output', async () => {
    const fn = handler(await boot('module', 'double = (n) -> "wrong"'));
    expect(() => fn(21)).toThrow(/output.*number/);
  });
  it('validates the same contract across isolated RPC', async () => {
    const fn = handler(await boot('type', undefined, undefined, true, true));
    expect(await fn(21)).toBe(42);
    expect(() => fn('21')).toThrow(/input/);
  });
  it('requires provider input and output types', async () => {
    await expect(boot('module', undefined, undefined, false)).rejects.toThrow(/requires an input and output contract/);
  });
  for (const annotation of ['', '"string"', 'invalid']) it(`rejects return annotation ${annotation}`, async () => {
    const r = await boot('module', undefined, annotation);
    expect(r.container.registry.getState('consumers/deep/sample')?.state).not.toBe('active');
    expect(handler(r)).toBeUndefined();
  });
  it('validates nested data and rejects unknown types', () => {
    expect(() => assertValue({users: [{age: 'wrong'}]}, {users: [{age: 'number'}]}, 'value')).toThrow(/users\[0\].age/);
    expect(() => checkType('any', 'schema')).toThrow(/unsupported/);
    expect(() => checkType([], 'schema')).toThrow(/exactly one/);
  });
  it('keeps helpers local and rejects conflicting explicit exports', () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    const filename = ws.pkg('sample', {'index.type': ''}) + '/index.type';
    const source = 'helper = -> 0\n###\n@register arithmetic\n###\nanswer = -> 42\n';
    const result = loadType(filename, compileType(source, filename).js);
    expect(Object.keys(result)).toEqual(['answer']); expect(result.answer()).toBe(42);
    delete require.cache[filename];
    expect(() => loadType(filename, compileType(source + 'exports.answer = -> 1\n', filename).js)).toThrow(/conflicting export/);
  });
  it('rejects alias name collisions before installation', async () => {
    const ws = makeWorkspace(); cleanup.push(ws.cleanup);
    ws.pkg('provider', {'package.json': '{"name":"provider"}', 'index.type': '###\n@register module duplicate\n###\na = -> {}\n###\n@register type duplicate\n###\nb = -> {}\n'});
    await expect(bootstrap({workspace: ws.root, externalModules: []})).rejects.toThrow(/duplicate/);
  });
});
