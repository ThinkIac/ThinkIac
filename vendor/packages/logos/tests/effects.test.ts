import { describe, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { EffectScope, EffectScopeClosedError } from '../src/kernel/effects';
import { makeWorkspace } from './helpers';

describe('EffectScope', () => {
  it('disposes effects in LIFO order exactly once', async () => {
    const calls: string[] = [];
    const scope = new EffectScope({ owner: 'agenda', generation: 'g1' });
    await scope.effect(() => () => { calls.push('first'); }, { kind: 'listener' });
    scope.defer(() => { calls.push('second'); }, { kind: 'timer' });

    const first = await scope.dispose('reload');
    const second = await scope.dispose('again');

    expect(calls).toEqual(['second', 'first']);
    expect(first).toBe(second);
    expect(first).toMatchObject({ owner: 'agenda', generation: 'g1', reason: 'reload', disposed: 2, failed: 0 });
  });

  it('shares one disposal across concurrent callers', async () => {
    let releases = 0;
    const scope = new EffectScope({ owner: 'agenda' });
    scope.defer(async () => {
      await Promise.resolve();
      releases += 1;
    });

    const [left, right] = await Promise.all([scope.dispose('left'), scope.dispose('right')]);
    expect(left).toBe(right);
    expect(left.reason).toBe('left');
    expect(releases).toBe(1);
  });

  it('aborts and releases an asynchronous acquisition that completes during dispose', async () => {
    let finish!: (dispose: () => void) => void;
    let signal: AbortSignal | undefined;
    let releases = 0;
    const scope = new EffectScope({ owner: 'worker' });
    const acquiring = scope.effect(async currentSignal => {
      signal = currentSignal;
      return new Promise<() => void>(resolve => { finish = resolve; });
    }, { kind: 'process' });

    await Promise.resolve();
    const disposing = scope.dispose('cancelled');
    expect(signal?.aborted).toBe(true);
    finish(() => { releases += 1; });

    await expect(acquiring).resolves.toBeUndefined();
    const report = await disposing;
    expect(releases).toBe(1);
    expect(report).toMatchObject({ disposed: 1, failed: 0 });
  });

  it('continues after disposer failures and reports every error', async () => {
    const calls: string[] = [];
    const scope = new EffectScope({ owner: 'broken' });
    scope.defer(() => { calls.push('first'); });
    scope.defer(() => { throw new Error('boom'); }, { kind: 'listener', label: 'bad listener' });
    scope.defer(() => { calls.push('last'); });

    const report = await scope.dispose('stop');
    expect(calls).toEqual(['last', 'first']);
    expect(report.disposed).toBe(2);
    expect(report.failed).toBe(1);
    expect(report.errors[0]).toMatchObject({ kind: 'listener', label: 'bad listener', message: 'boom' });
  });

  it('disposes children before older parent effects and rejects effects after closing', async () => {
    const calls: string[] = [];
    const parent = new EffectScope({ owner: 'parent' });
    parent.defer(() => { calls.push('parent'); });
    const child = parent.child({ owner: 'child', kind: 'component' });
    child.defer(() => { calls.push('child'); });

    await parent.dispose('shutdown');
    expect(calls).toEqual(['child', 'parent']);
    expect(parent.signal.aborted).toBe(true);
    expect(child.signal.aborted).toBe(true);
    expect(() => parent.defer(() => undefined)).toThrow(EffectScopeClosedError);
    await expect(parent.effect(() => () => undefined)).rejects.toBeInstanceOf(EffectScopeClosedError);
  });
});

describe('Container effect inventory', () => {
  it('returns a frozen snapshot and removes disposed scopes from the live inventory', async () => {
    const ws = makeWorkspace('logos-effects-inventory-');
    try {
      const container = new Container({ workspace: ws.root });
      const scope = container.createScope({ owner: 'agenda', generation: 'g7', kind: 'package' });
      scope.defer(() => undefined, { kind: 'listener', label: 'agenda:created', detail: { channel: 'created' } });
      const child = scope.child({ owner: 'agenda/component', generation: 'g7', kind: 'component' });

      const inventory = container.effectInventory();
      expect(Object.isFrozen(inventory)).toBe(true);
      expect(Object.isFrozen(inventory[0].resources)).toBe(true);
      expect(Object.isFrozen((inventory[0].resources[0].metadata as any).detail)).toBe(true);
      expect(inventory[0]).toMatchObject({ owner: 'agenda', generation: 'g7', kind: 'package', state: 'open' });
      expect(inventory[0].resources[0]).toMatchObject({ kind: 'listener', label: 'agenda:created', state: 'active' });
      expect(inventory.some(item => item.id === child.id && item.parentId === scope.id)).toBe(true);
      expect(() => (inventory as any).push({})).toThrow();
      expect(() => ((inventory[0].resources[0].metadata as any).detail.channel = 'changed')).toThrow();

      await scope.dispose('test');
      expect(container.effectInventory()).toEqual([]);
    } finally {
      ws.cleanup();
    }
  });

  it('owns bus subscriptions so package disposal leaves no listener behind', async () => {
    const ws = makeWorkspace('logos-effects-bus-');
    try {
      const container = new Container({ workspace: ws.root });
      const scope = container.createPackageScope('agenda', 'g1');
      let calls = 0;
      container.bus.on('agenda:created', () => { calls += 1; }, { owner: 'agenda', scope });

      await container.bus.emit('agenda:created');
      await container.disposePackageScope('agenda', 'reload');
      await container.bus.emit('agenda:created');

      expect(calls).toBe(1);
      expect(container.bus.listeners('agenda:created')).toHaveLength(0);
    } finally {
      ws.cleanup();
    }
  });
});
