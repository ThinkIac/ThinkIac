import { afterEach, describe, expect, it } from 'vitest';
import { bootstrap } from '../src/index';
import { Container } from '../src/kernel/container';
import { stagePackage } from '../src/stabilizer/staging';
import { makeWorkspace } from './helpers';

const cleanup: Array<() => any> = [];
afterEach(async () => { for (const close of cleanup.splice(0).reverse()) await close(); });

describe('transactional resource generations', () => {
  it('rejects duplicate publication and waits for commit before explicit rollback', async () => {
    const c = new Container({ workspace: '/tmp/logos-resource-commit-race' });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    c.use({ name: 'counter', phase: 'wire', install() {}, resources: {
      counter: { prepare() { return {
        async commit() { seen.push('commit'); await waiting; seen.push('published'); },
        rollback() { seen.push('rollback'); }, dispose() {},
      }; } },
    } });
    c.sealModules(); await c.installPhase('wire');
    const transaction = await c.resourceTransactions.prepare('sample', []);
    const publishing = transaction.commit();
    await expect(transaction.commit()).rejects.toThrow('not prepared');
    const rollingBack = transaction.rollback();
    expect(seen).toEqual(['commit']);
    release();
    await publishing; await rollingBack;
    expect(seen).toEqual(['commit', 'published', 'rollback']);
    await expect(transaction.finish()).rejects.toThrow('not committed');
    await c.closeModules();
  });

  it('waits for preparation during shutdown and releases the candidate before closing modules', async () => {
    const c = new Container({ workspace: '/tmp/logos-resource-close' });
    let release!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const seen: string[] = [];
    c.use({ name: 'pending', phase: 'wire', install() {}, close() { seen.push('module'); }, resources: {
      pending: { async prepare() {
        await waiting;
        return { commit() { seen.push('commit'); }, rollback() { seen.push('rollback'); }, dispose() { seen.push('dispose'); } };
      } },
    } });
    c.sealModules(); await c.installPhase('wire');
    const preparing = c.resourceTransactions.prepare('sample', []);
    const rejected = expect(preparing).rejects.toThrow('Resource lifecycle is closed');
    const closing = c.closeModules();
    release();
    await rejected; await closing;
    expect(seen).toEqual(['rollback', 'module']);
  });

  it('aborts an uncommitted snapshot at shutdown and prevents publication afterwards', async () => {
    const c = new Container({ workspace: '/tmp/logos-resource-close-prepared' });
    let rolledBack = false;
    c.use({ name: 'pending', phase: 'wire', install() {}, resources: {
      pending: { prepare() { return {
        commit() { throw new Error('must not publish'); }, rollback() { rolledBack = true; }, dispose() {},
      }; } },
    } });
    c.sealModules(); await c.installPhase('wire');
    const transaction = await c.resourceTransactions.prepare('sample', []);
    await c.closeModules();
    expect(rolledBack).toBe(true);
    await expect(transaction.commit()).rejects.toThrow('Resource lifecycle is closed');
  });
  it('replaces and removes declarations on reload, retaining the old callable on rejection', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    const write = (value: number) => workspace.pkg('sample', {
      'package.json': '{"name":"sample"}',
      'actions.js': `exports.value = function() { /** @register arithmetic value */ return ${value}; };`,
    });
    write(1);
    let live: readonly any[] = [];
    let reject = false;
    let retired = 0;
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: [], workers: false,
      hotReload: { enabled: false }, modules: [{ name: 'arithmetic', phase: 'wire', install() {},
        resources: { arithmetic: { prepare(next) {
          const old = live;
          return {
            commit() { live = next; if (reject) throw new Error('publication rejected'); },
            rollback() { live = old; },
            dispose() { retired++; if (live === next) live = []; },
          };
        } } },
      }] });
    cleanup.push(() => runtime.close());
    const reference = { kind: 'arithmetic', name: 'value' };
    const resolve = () => runtime.container.resolveResource('sample', reference);
    expect(resolve()).toEqual({ package: 'sample', ...reference });
    expect(await live[0].handler()).toBe(1);
    write(2);
    expect((await stagePackage(runtime.container, 'sample')).ok).toBe(true);
    expect(await live[0].handler()).toBe(2);
    expect(retired).toBe(1);
    reject = true; write(3);
    expect((await stagePackage(runtime.container, 'sample')).ok).toBe(false);
    expect(resolve()).toEqual({ package: 'sample', ...reference });
    expect(await live[0].handler()).toBe(2);
    reject = false;
    workspace.pkg('sample', { 'actions.js': 'exports.value = () => 4;' });
    expect((await stagePackage(runtime.container, 'sample')).ok).toBe(true);
    expect(live).toHaveLength(0);
    expect(resolve).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));
    await runtime.close();
    expect(retired).toBe(3);
  });

  it('rolls back all prepared consumers in reverse order when a later consumer rejects', async () => {
    const c = new Container({ workspace: '/tmp/logos-resource-rollback' });
    const order: string[] = [];
    for (const name of ['first', 'second', 'third']) c.use({ name, phase: 'wire', install() {}, resources: {
      [name]: { prepare() {
        if (name === 'third') throw new Error('prepare rejected');
        return { commit() { order.push(`commit:${name}`); }, rollback() { order.push(`rollback:${name}`); }, dispose() {} };
      } },
    } });
    c.sealModules(); await c.installPhase('wire');
    await expect(c.resourceTransactions.prepare('sample', [])).rejects.toThrow('prepare rejected');
    expect(order).toEqual(['rollback:second', 'rollback:first']);
    await c.closeModules();
  });

  it('restores committed resources when a swapping listener rejects', async () => {
    const workspace = makeWorkspace(); cleanup.push(workspace.cleanup);
    workspace.pkg('sample', { 'package.json': '{"name":"sample"}' });
    let live = 0;
    const runtime = await bootstrap({ workspace: workspace.root, externalModules: [], workers: false,
      hotReload: { enabled: false }, modules: [{ name: 'counter', phase: 'wire', install() {}, resources: {
        counter: { prepare() { const old = live; return {
          commit() { live = old + 1; }, rollback() { live = old; }, dispose() {},
        }; } },
      } }] });
    cleanup.push(() => runtime.close());
    runtime.container.bus.on('logos:package:swapping', () => { throw new Error('swap rejected'); });
    expect(live).toBe(1);
    expect((await stagePackage(runtime.container, 'sample')).ok).toBe(false);
    expect(live).toBe(1);
  });
});
