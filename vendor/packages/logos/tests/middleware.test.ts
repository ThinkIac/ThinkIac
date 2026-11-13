// tests/middleware.test.ts — predicate-gated package middleware chains.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { resolveMiddlewares, runMiddlewares } from '../src/kernel/middleware';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(() => ws.cleanup());

describe('runMiddlewares', () => {
  it('runs the chain around the handler in order and returns its value', async () => {
    const order: string[] = [];
    const mw = (label: string) => ({
      call: async (_ctx: any, next: any) => { order.push(`>${label}`); const r = await next(); order.push(`<${label}`); return r; },
    });
    const result = await runMiddlewares([mw('a'), mw('b')], {}, async () => { order.push('handler'); return 42; });
    expect(result).toBe(42);
    expect(order).toEqual(['>a', '>b', 'handler', '<b', '<a']);
  });

  it('runs the handler directly when there are no middlewares', async () => {
    expect(await runMiddlewares([], {}, async () => 'direct')).toBe('direct');
  });

  it('a middleware that does not call next() short-circuits the handler', async () => {
    let ran = false;
    const block = { call: async () => 'blocked' };
    const result = await runMiddlewares([block], {}, async () => { ran = true; return 'handler'; });
    expect(result).toBe('blocked');
    expect(ran).toBe(false);
  });
});

describe('resolveMiddlewares', () => {
  it('returns [] for a folder with no middleware', async () => {
    const dir = ws.pkg('empty', { 'index.js': 'exports.x = () => 1;' });
    expect(await resolveMiddlewares(dir, {})).toEqual([]);
  });

  it('keeps middleware whose predicates all pass and drops the rest', async () => {
    const dir = ws.pkg('gated', {
      'mw.js': [
        '/**\n * @register_predicate isAdmin\n */',
        'exports.isAdmin = function isAdmin(ctx) { return ctx.role === "admin"; };',
        '/**\n * @register_middleware adminOnly\n * @predicate isAdmin\n */',
        'exports.adminOnly = function adminOnly(ctx, next) { return next(); };',
        '/**\n * @register_middleware always\n */',
        'exports.always = function always(ctx, next) { return next(); };',
      ].join('\n'),
    });
    const asAdmin = await resolveMiddlewares(dir, { role: 'admin' });
    expect(asAdmin.map((m: any) => m.name).sort()).toEqual(['adminOnly', 'always']);

    const asGuest = await resolveMiddlewares(dir, { role: 'guest' });
    expect(asGuest.map((m: any) => m.name)).toEqual(['always']);
  });
});
