import { describe, expect, it } from 'vitest';
import { ReactiveLifecycle } from '../src/kernel/lifecycle';
import { ServiceCycleError } from '../src/kernel/services';

describe('ReactiveLifecycle', () => {
  it('waits for a mandatory dependency, then activates provider before consumer', async () => {
    const calls: string[] = [];
    const lifecycle = new ReactiveLifecycle();
    lifecycle.register({
      owner: 'agenda',
      requires: { 'notifications.push': '1.x' },
      activate(ctx) {
        const push = ctx.inject<{ name: string }>('notifications.push');
        calls.push(`agenda:${push.name}`);
      },
    });

    const waiting = await lifecycle.reconcile();
    expect(waiting.waiting).toEqual(['agenda']);
    expect(lifecycle.state('agenda')).toBe('waiting_dependencies');

    lifecycle.register({
      owner: 'ntfy',
      provides: { 'notifications.push': '1.0.0' },
      activate(ctx) {
        calls.push('ntfy');
        ctx.provide('notifications.push', { name: 'ntfy' });
      },
    });
    const mounted = await lifecycle.reconcile();

    expect(mounted.activated).toEqual(['ntfy', 'agenda']);
    expect(calls).toEqual(['ntfy', 'agenda:ntfy']);
  });

  it('tears down consumers before a replaced provider and remounts only the affected closure', async () => {
    const calls: string[] = [];
    const lifecycle = new ReactiveLifecycle();
    lifecycle.register({ owner: 'unrelated', activate: () => { calls.push('unrelated:up'); return () => calls.push('unrelated:down'); } });
    lifecycle.register({
      owner: 'push', generation: 'g1', provides: { 'notifications.push': '1.0.0' },
      activate(ctx) {
        calls.push('push:g1:up');
        ctx.provide('notifications.push', 'g1');
        return () => calls.push('push:g1:down');
      },
    });
    lifecycle.register({
      owner: 'agenda', requires: { 'notifications.push': '1.x' },
      activate(ctx) {
        calls.push(`agenda:${ctx.inject('notifications.push')}:up`);
        return () => calls.push('agenda:down');
      },
    });
    await lifecycle.reconcile();
    calls.length = 0;

    lifecycle.register({
      owner: 'push', generation: 'g2', provides: { 'notifications.push': '1.1.0' },
      activate(ctx) {
        calls.push('push:g2:up');
        ctx.provide('notifications.push', 'g2');
        return () => calls.push('push:g2:down');
      },
    });
    const result = await lifecycle.reconcile();

    expect(result.deactivated).toEqual(['agenda', 'push']);
    expect(result.activated).toEqual(['push', 'agenda']);
    expect(calls).toEqual(['agenda:down', 'push:g1:down', 'push:g2:up', 'agenda:g2:up']);
    expect(calls).not.toContain('unrelated:down');
  });

  it('converges after explicit provider selection to the same state as a clean mount', async () => {
    const make = () => {
      const seen: string[] = [];
      const lifecycle = new ReactiveLifecycle({ selections: { 'notifications.push': 'ntfy' } });
      lifecycle.register({ owner: 'ntfy', provides: { 'notifications.push': '1.0.0' }, activate(ctx) { ctx.provide('notifications.push', 'ntfy'); } });
      lifecycle.register({ owner: 'hermes', provides: { 'notifications.push': '1.0.0' }, activate(ctx) { ctx.provide('notifications.push', 'hermes'); } });
      lifecycle.register({ owner: 'agenda', requires: { 'notifications.push': '1.x' }, activate(ctx) { seen.push(String(ctx.inject('notifications.push'))); } });
      return { lifecycle, seen };
    };

    const changed = make();
    await changed.lifecycle.reconcile();
    changed.lifecycle.select('notifications.push', 'hermes');
    await changed.lifecycle.reconcile();

    const clean = make();
    clean.lifecycle.select('notifications.push', 'hermes');
    await clean.lifecycle.reconcile();

    expect(changed.lifecycle.snapshot()).toEqual(clean.lifecycle.snapshot());
    expect(changed.seen.at(-1)).toBe('hermes');
    expect(clean.seen).toEqual(['hermes']);
  });

  it('rejects cycles before activating any package', async () => {
    const calls: string[] = [];
    const lifecycle = new ReactiveLifecycle();
    lifecycle.register({ owner: 'alpha', provides: { alpha: '1.0.0' }, requires: { beta: '1.x' }, activate: () => { calls.push('alpha'); } });
    lifecycle.register({ owner: 'beta', provides: { beta: '1.0.0' }, requires: { alpha: '1.x' }, activate: () => { calls.push('beta'); } });

    await expect(lifecycle.reconcile()).rejects.toBeInstanceOf(ServiceCycleError);
    expect(calls).toEqual([]);
  });
});
