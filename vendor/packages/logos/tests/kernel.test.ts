// tests/kernel.test.ts — kernel unit tests (no external deps, run with vitest).

import { describe, it, expect } from 'vitest';
import { EventBus, matchesEvent } from '../src/kernel/bus';
import { buildAboveDocMap, resolveDoc, parseConditions } from '../src/kernel/jsdoc';
import { parseRoute, parseTool, parseModule } from '../src/kernel/parsers';
import { resolveConditions } from '../src/kernel/conditions';
import { ScanCache } from '../src/kernel/cache';

describe('matchesEvent', () => {
  it('matches exact, namespace and suffix wildcards', () => {
    expect(matchesEvent('*', 'anything')).toBe(true);
    expect(matchesEvent('reload:*', 'reload:swapped')).toBe(true);
    expect(matchesEvent('reload:*', 'views:hmr')).toBe(false);
    expect(matchesEvent('*:error', 'db:error')).toBe(true);
    expect(matchesEvent('a:b', 'a:b')).toBe(true);
  });
});

describe('EventBus', () => {
  it('emit runs all handlers and swallows errors', async () => {
    const bus = new EventBus(() => {});
    const seen: number[] = [];
    bus.on('e', () => { seen.push(1); });
    bus.on('e', () => { throw new Error('boom'); });
    bus.on('e', () => { seen.push(2); });
    await bus.emit('e');
    expect(seen).toEqual([1, 2]);
  });

  it('pipeline threads a transformed payload in priority order', async () => {
    const bus = new EventBus(() => {});
    bus.on('p', (n: number) => n + 1, { priority: 10 });
    bus.on('p', (n: number) => n * 2, { priority: 20 });
    expect(await bus.pipeline('p', 1)).toBe(4); // (1+1)*2
  });

  it('veto blocks and reports who blocked', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => ({ veto: true, reason: 'nope' }), { owner: 'pkgA' });
    const verdict = await bus.veto('v', {});
    expect(verdict.allowed).toBe(false);
    expect(verdict.by).toBe('pkgA');
    expect(verdict.reason).toBe('nope');
  });

  it('removeOwner drops a package\'s subscriptions', async () => {
    const bus = new EventBus(() => {});
    let hits = 0;
    bus.on('x', () => { hits++; }, { owner: 'pkgA' });
    await bus.emit('x');
    bus.removeOwner('pkgA');
    await bus.emit('x');
    expect(hits).toBe(1);
  });
});

describe('jsdoc resolution', () => {
  it('finds a doc block above a function declaration', () => {
    const src = `
/**
 * @register_tool sum
 */
function sum(a, b) { return a + b; }
`;
    const map = buildAboveDocMap(src);
    expect(map.sum).toContain('@register_tool sum');
  });

  it('prefers an inside-body doc (v1 style) over the above map', () => {
    // Built via the Function constructor so the JSDoc survives in fn.toString()
    // — a source-level function body would have its comments stripped by the
    // test transpiler, which is exactly the v1 fragility esbuild-migration.md
    // documents. Real packages ship .js files, whose comments are preserved.
    const withInside = new Function('/**\n * @register_tool inside\n */\nreturn 1;');
    const doc = resolveDoc(withInside as Function, { withInside: 'ignored above doc' });
    expect(doc).toContain('@register_tool inside');
  });

  it('treats @when and @only as the same condition', () => {
    const cond = parseConditions('@only a\n@when b\n@never c');
    expect(cond.only).toEqual(['a', 'b']);
    expect(cond.never).toEqual(['c']);
  });
});

describe('parsers', () => {
  it('parses a route with method and credential requirement', () => {
    const doc = '@register_router ping\n@method post\n@requireCredential';
    const route = parseRoute(function ping() {}, doc);
    expect(route).toMatchObject({ path: 'ping', method: 'post', credentialRequired: true });
  });

  it('parses a tool with params', () => {
    const doc = '@register_tool add\n@description adds\n@param {number} a - first\n@param {number?} b - second';
    const tool = parseTool(function add() {}, doc);
    expect(tool!.name).toBe('add');
    expect(tool!.parameters.find((p: any) => p.name === 'b')!.required).toBe(false);
  });

  it('parses a module with phase/after/swappable', () => {
    const doc = '@register_module http\n@phase wire\n@after env\n@swappable false';
    const mod = parseModule(function install() {}, doc);
    expect(mod).toMatchObject({ name: 'http', phase: 'wire', swappable: false });
    expect(mod!.after).toEqual(['env']);
  });
});

describe('conditions', () => {
  it('requires only-keys present and never-keys absent', async () => {
    expect(await resolveConditions({ only: ['a'] }, { a: true })).toBe(true);
    expect(await resolveConditions({ only: ['a'] }, {})).toBe(false);
    expect(await resolveConditions({ never: ['b'] }, { b: true })).toBe(false);
  });
});

describe('ScanCache', () => {
  it('invalidates when the fingerprint changes', () => {
    const cache = new ScanCache();
    cache.set('k', 'fp1', [1]);
    expect(cache.get('k', 'fp1')).toEqual([1]);
    expect(cache.get('k', 'fp2')).toBeUndefined();
  });
});
