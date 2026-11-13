// tests/bus.test.ts — the event bus is the spine of Lógos; these cover the
// three dispatch primitives, wildcard matching, priority ordering, once/off,
// and owner-scoped teardown (used by hot reload).

import { describe, it, expect, vi } from 'vitest';
import { EventBus, matchesEvent } from '../src/kernel/bus';

describe('matchesEvent', () => {
  it('matches the "*" catch-all', () => {
    expect(matchesEvent('*', 'anything')).toBe(true);
    expect(matchesEvent('*', 'a:b:c')).toBe(true);
  });

  it('matches exact event names', () => {
    expect(matchesEvent('reload:swapped', 'reload:swapped')).toBe(true);
    expect(matchesEvent('reload:swapped', 'reload:staging')).toBe(false);
  });

  it('matches namespace wildcards (ns:*)', () => {
    expect(matchesEvent('reload:*', 'reload:swapped')).toBe(true);
    expect(matchesEvent('reload:*', 'reload:')).toBe(true);
    expect(matchesEvent('reload:*', 'reloadx:swapped')).toBe(false);
    expect(matchesEvent('reload:*', 'views:hmr')).toBe(false);
  });

  it('matches suffix wildcards (*:suffix)', () => {
    expect(matchesEvent('*:error', 'db:error')).toBe(true);
    expect(matchesEvent('*:error', 'a:b:error')).toBe(true);
    expect(matchesEvent('*:error', 'db:warn')).toBe(false);
  });
});

describe('EventBus.emit', () => {
  it('runs all matching handlers, wildcards included', async () => {
    const bus = new EventBus(() => {});
    const seen: string[] = [];
    bus.on('e', () => { seen.push('exact'); });
    bus.on('*', () => { seen.push('star'); });
    bus.on('e:*', () => { seen.push('should-not-run'); });
    await bus.emit('e');
    expect(seen.sort()).toEqual(['exact', 'star']);
  });

  it('swallows handler errors and keeps going, logging each', async () => {
    const log = vi.fn();
    const bus = new EventBus(log);
    const seen: number[] = [];
    bus.on('e', () => { seen.push(1); });
    bus.on('e', () => { throw new Error('boom'); });
    bus.on('e', () => { seen.push(2); });
    await bus.emit('e');
    expect(seen).toEqual([1, 2]);
    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0][0]).toContain('boom');
  });

  it('awaits async handlers before resolving', async () => {
    const bus = new EventBus(() => {});
    let done = false;
    bus.on('e', async () => {
      await new Promise(r => setTimeout(r, 5));
      done = true;
    });
    await bus.emit('e');
    expect(done).toBe(true);
  });
});

describe('EventBus.pipeline', () => {
  it('threads the transformed payload in priority order (lower first)', async () => {
    const bus = new EventBus(() => {});
    bus.on('p', (n: number) => n + 1, { priority: 10 });
    bus.on('p', (n: number) => n * 2, { priority: 20 });
    expect(await bus.pipeline('p', 1)).toBe(4); // (1+1)*2
  });

  it('keeps the current payload when a handler returns undefined or null', async () => {
    const bus = new EventBus(() => {});
    bus.on('p', () => undefined);
    bus.on('p', () => null);
    expect(await bus.pipeline('p', 'keep')).toBe('keep');
  });

  it('a throwing handler does not break the chain', async () => {
    const bus = new EventBus(() => {});
    bus.on('p', (n: number) => n + 1, { priority: 10 });
    bus.on('p', () => { throw new Error('x'); }, { priority: 15 });
    bus.on('p', (n: number) => n + 100, { priority: 20 });
    expect(await bus.pipeline('p', 0)).toBe(101);
  });
});

describe('EventBus.veto', () => {
  it('allows when no handler objects', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => true);
    expect(await bus.veto('v', {})).toEqual({ allowed: true });
  });

  it('a bare false blocks and attributes the owner', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => false, { owner: 'pkgA' });
    expect(await bus.veto('v', {})).toEqual({ allowed: false, by: 'pkgA' });
  });

  it('a { veto:true, reason } object blocks with a reason', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => ({ veto: true, reason: 'nope' }), { owner: 'pkgB' });
    const verdict = await bus.veto('v', {});
    expect(verdict).toEqual({ allowed: false, reason: 'nope', by: 'pkgB' });
  });

  // Quem veta precisa conseguir dizer POR QUE de forma tratável: o transporte
  // traduz `code` em status HTTP e devolve `details` (id da decisão pendente)
  // pro chamador, em vez de tentar deduzir isso do texto do motivo.
  it('carries code and details from the vetoing handler', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => ({ veto: true, reason: 'confirme', code: 'CONFIRMATION_REQUIRED', details: { decisionId: 'd1' } }), { owner: 'gov' });
    expect(await bus.veto('v', {})).toEqual({
      allowed: false, reason: 'confirme', by: 'gov', code: 'CONFIRMATION_REQUIRED', details: { decisionId: 'd1' },
    });
  });

  it('the first vetoing handler wins (priority order)', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => false, { owner: 'late', priority: 90 });
    bus.on('v', () => ({ veto: true, reason: 'early' }), { owner: 'early', priority: 10 });
    expect((await bus.veto('v', {})).by).toBe('early');
  });

  it('a throwing veto handler is treated as no-veto', async () => {
    const bus = new EventBus(() => {});
    bus.on('v', () => { throw new Error('x'); });
    expect(await bus.veto('v', {})).toEqual({ allowed: true });
  });
});

describe('EventBus subscription management', () => {
  it('once fires exactly one time', async () => {
    const bus = new EventBus(() => {});
    let hits = 0;
    bus.once('e', () => { hits++; });
    await bus.emit('e');
    await bus.emit('e');
    expect(hits).toBe(1);
  });

  it('the disposer returned by on() unsubscribes', async () => {
    const bus = new EventBus(() => {});
    let hits = 0;
    const off = bus.on('e', () => { hits++; });
    await bus.emit('e');
    off();
    await bus.emit('e');
    expect(hits).toBe(1);
  });

  it('removeOwner drops every subscription for a folder and reports the count', async () => {
    const bus = new EventBus(() => {});
    let a = 0, b = 0;
    bus.on('e', () => { a++; }, { owner: 'pkgA' });
    bus.on('e', () => { a++; }, { owner: 'pkgA' });
    bus.on('e', () => { b++; }, { owner: 'pkgB' });
    const removed = bus.removeOwner('pkgA');
    expect(removed).toBe(2);
    await bus.emit('e');
    expect(a).toBe(0);
    expect(b).toBe(1);
  });

  it('listeners() returns matching subs sorted by priority', () => {
    const bus = new EventBus(() => {});
    bus.on('e', () => {}, { priority: 30 });
    bus.on('e', () => {}, { priority: 10 });
    bus.on('other', () => {});
    const list = bus.listeners('e');
    expect(list.length).toBe(2);
    expect(list[0].priority).toBe(10);
    expect(list[1].priority).toBe(30);
  });

  it('defaults priority to 100 when unspecified', () => {
    const bus = new EventBus(() => {});
    bus.on('e', () => {});
    expect(bus.listeners('e')[0].priority).toBe(100);
  });
});
