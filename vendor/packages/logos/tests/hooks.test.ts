// tests/hooks.test.ts — wiring package @register_hook functions onto the bus,
// including condition gating and owner-scoped re-wiring on reload.

import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { Container } from '../src/kernel/container';
import { wirePackageHooks } from '../src/modules/hooks';
import { scanCache } from '../src/kernel/scan';
import { makeWorkspace, FixtureWorkspace } from './helpers';

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); process.env.PACKAGES_PATH = ws.root; scanCache.clear(); });
afterEach(() => ws.cleanup());

function pkg(folder: string, hooksJs: string) {
  const dir = ws.pkg(folder, { 'hooks.js': hooksJs });
  return { folder, dir, path: dir };
}

describe('wirePackageHooks', () => {
  it('registers a hook so a bus dispatch invokes it', async () => {
    const c = new Container({ workspace: ws.root });
    const p = pkg('greet', [
      '/**\n * @register_hook say:hi\n */',
      'exports.hi = function hi(payload) { return { ...payload, greeted: true }; };',
    ].join('\n'));
    const count = await wirePackageHooks(c, p);
    expect(count).toBe(1);
    const result = await c.bus.pipeline('say:hi', { greeted: false });
    expect(result.greeted).toBe(true);
  });

  it('gates a hook by its @only condition', async () => {
    const c = new Container({ workspace: ws.root });
    const p = pkg('gated', [
      '/**\n * @register_hook do:it\n * @only enabled\n */',
      'exports.h = function h(payload) { return { ran: true }; };',
    ].join('\n'));
    await wirePackageHooks(c, p);
    // condition is checked against the dispatch ctx (2nd arg to pipeline)
    expect(await c.bus.pipeline('do:it', { ran: false }, {})).toEqual({ ran: false });
    expect(await c.bus.pipeline('do:it', { ran: false }, { enabled: true })).toEqual({ ran: true });
  });

  it('re-wiring removes the previous version of the hook (no duplicates)', async () => {
    const c = new Container({ workspace: ws.root });
    const p = pkg('counter', [
      '/**\n * @register_hook tick\n */',
      'exports.h = function h(n) { return n + 1; };',
    ].join('\n'));
    await wirePackageHooks(c, p);
    await wirePackageHooks(c, p); // reload — should replace, not stack
    expect(await c.bus.pipeline('tick', 0)).toBe(1);
  });

  it('returns 0 for a package with no hooks', async () => {
    const c = new Container({ workspace: ws.root });
    const dir = ws.pkg('empty', { 'index.js': 'exports.x = 1;' });
    expect(await wirePackageHooks(c, { folder: 'empty', dir, path: dir })).toBe(0);
  });
});
