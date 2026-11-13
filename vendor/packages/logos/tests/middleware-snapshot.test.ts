import fs from 'fs';
import { describe, it, expect, vi } from 'vitest';
import { loadMiddlewareSnapshot, resolveMiddlewares, runMiddlewares } from '../src/kernel/middleware';
import { makeWorkspace } from './helpers';

describe('router middleware snapshots', () => {
  it('performs no discovery on requests and preserves old generation while the new one is prepared', async () => {
    const ws = makeWorkspace();
    try {
      const dir = ws.pkg('gated', { 'mw.js': `
/**
 * @register_predicate admin
 */
exports.admin = function admin(ctx) { return ctx.role === 'admin'; };
/**
 * @register_middleware gate
 * @predicate admin
 */
exports.gate = function gate(ctx, next) { ctx.version = 'old'; return next(); };
` });
      const old = await loadMiddlewareSnapshot(dir);
      const spy = vi.spyOn(fs, 'readdirSync');
      const context = { role: 'admin', version: '' };
      await runMiddlewares(await resolveMiddlewares(dir, context, old), context, () => null);
      expect(context.version).toBe('old');
      expect(await resolveMiddlewares(dir, { role: 'guest' }, old)).toHaveLength(0);
      expect(spy).not.toHaveBeenCalled(); spy.mockRestore();
      const file = `${dir}/mw.js`;
      fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace("'old'", "'new generation'"));
      const fresh = await loadMiddlewareSnapshot(dir);
      for (const [snapshot, value] of [[old, 'old'], [fresh, 'new generation']] as const) {
        await runMiddlewares(await resolveMiddlewares(dir, context, snapshot), context, () => null);
        expect(context.version).toBe(value);
      }
    } finally { vi.restoreAllMocks(); ws.cleanup(); }
  });
});
