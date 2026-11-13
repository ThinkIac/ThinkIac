import { afterEach, describe, expect, it, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import express from 'express';
import { Container } from '../src/kernel/container';
import { packageOperation } from '../src/stabilizer/operations';
import { Stabilizer } from '../src/stabilizer';
import { HealthMonitor, normalizeMonitor, normalizeHealth } from '../src/stabilizer/health';

const dirs: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true }); });
function fixture(monitor: any = {}, critical = false) {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-health-')); dirs.push(workspace);
  fs.mkdirSync(path.join(workspace, 'demo'));
  fs.writeFileSync(path.join(workspace, 'demo/package.json'), JSON.stringify({ name: 'demo', runtime: { isolation: { critical }, stability: { monitor: { route: 'health', failureThreshold: 2, successThreshold: 2, ...monitor } } } }));
  const c = new Container({ workspace } as any);
  c.registry.setState('demo', 'active');
  let body: any = { ok: true }; let calls = 0;
  const router = express.Router(); router.get('/demo/health', (_req, res) => { calls++; res.json(body); });
  c.state('routers').set('demo', router);
  const recover = vi.fn(async () => ({ ok: true }));
  const h = new HealthMonitor(c, recover);
  return { c, h, recover, set: (value: any) => { body = value; }, calls: () => calls };
}
describe('operational health contract', () => {
  it('keeps legacy manifests opt-in and rejects unsafe configuration', () => {
    expect(normalizeMonitor(undefined)).toBeNull();
    expect(() => normalizeMonitor({ route: '../write' })).toThrow();
    expect(() => normalizeMonitor({ route: 'health', recovery: 'restart' })).toThrow();
    expect(() => normalizeMonitor({ route: 'health', interval: 0 })).toThrow();
  });
  it('normalizes HTTP and legacy bodies conservatively', () => {
    expect(normalizeHealth(200, { ok: true }).status).toBe('healthy');
    expect(normalizeHealth(200, { ok: false }).status).toBe('unhealthy');
    expect(normalizeHealth(200, { status: 'degraded' }).status).toBe('degraded');
    expect(normalizeHealth(503, { status: 'healthy' }).status).toBe('unhealthy');
    expect(normalizeHealth(200, { status: 'typo' }).status).toBe('unhealthy');
    expect(normalizeHealth(200, {}).status).toBe('healthy');
    expect(normalizeHealth(0, null).status).toBe('unhealthy');
  });
  it('uses thresholds, preserves active, and never recovers degradation/report', async () => {
    const f = fixture();
    await f.h.probe('demo'); await f.h.probe('demo');
    expect(f.c.registry.getState('demo')?.health.status).toBe('healthy');
    f.set({ ok: false }); await f.h.probe('demo');
    expect(f.c.registry.getState('demo')?.health.status).toBe('healthy');
    await f.h.probe('demo'); expect(f.c.registry.getState('demo')?.health.status).toBe('unhealthy');
    f.set({ status: 'degraded', reason: 'token=secret' }); await f.h.probe('demo');
    expect(f.c.registry.getState('demo')?.health.status).toBe('degraded');
    expect(f.c.registry.getState('demo')?.state).toBe('active');
    expect(f.recover).not.toHaveBeenCalled();
    expect(fs.readFileSync(path.join(f.c.workspace, '.logos/health.json'), 'utf8')).not.toContain('secret');
    await f.h.close();
  });
  it('persists cooldown and budget across supervisor recreation', async () => {
    const f = fixture({ recovery: 'reload', maxRecoveries: 1, cooldown: 1 });
    f.set({ ok: false }); await f.h.probe('demo'); await f.h.probe('demo');
    expect(f.recover).toHaveBeenCalledTimes(1); await f.h.close();
    const h = new HealthMonitor(f.c, f.recover);
    await new Promise(r => setTimeout(r, 5)); await h.probe('demo');
    expect(f.recover).toHaveBeenCalledTimes(1);
    expect(f.c.registry.getState('demo')?.health.status).toBe('quarantined'); await h.close();
  });
  it('does not probe stopped packages or stop critical packages', async () => {
    const f = fixture({ recovery: 'stop' }, true); f.set({ ok: false });
    await f.h.probe('demo'); await f.h.probe('demo'); expect(f.recover).not.toHaveBeenCalled();
    f.c.registry.setState('demo', 'stopped'); await f.h.probe('demo'); expect(f.calls()).toBe(2); await f.h.close();
  });
  it('starts only configured timers and clears them on close', async () => {
    vi.useFakeTimers(); const f = fixture(); f.h.start(); expect(vi.getTimerCount()).toBe(1);
    await f.h.close(); expect(vi.getTimerCount()).toBe(0);
  });
});


describe('probe lifecycle and serialization', () => {
  it('never overlaps a timed-out handler and releases timeout timers on close', async () => {
    vi.useFakeTimers(); const f = fixture({ timeout: 10 });
    let calls = 0; let finish: any;
    f.c.state('routers').set('demo', { handle(_req: any, res: any) { calls++; finish = () => res.json({ ok: true }); } });
    const first = f.h.probe('demo'); await vi.advanceTimersByTimeAsync(10); await first;
    await f.h.probe('demo'); expect(calls).toBe(1);
    finish(); const second = f.h.probe('demo'); await f.h.close(); await second;
    expect(vi.getTimerCount()).toBe(0);
  });
  it('ignores a result completed after manual stop', async () => {
    const f = fixture(); let finish: any;
    f.c.state('routers').set('demo', { handle(_req: any, res: any) { finish = () => res.json({ ok: false }); } });
    const probe = f.h.probe('demo'); f.c.registry.setState('demo', 'stopped'); finish(); await probe;
    expect(f.c.registry.getState('demo')?.health).toBeUndefined(); expect(f.recover).not.toHaveBeenCalled(); await f.h.close();
  });
  it('serializes same-package operations but allows other packages to progress', async () => {
    const f = fixture(); const order: string[] = []; let release: any;
    const first = packageOperation(f.c, 'demo', async () => { order.push('start'); await new Promise(r => { release = r; }); order.push('end'); });
    const second = packageOperation(f.c, 'demo', async () => { order.push('second'); });
    await packageOperation(f.c, 'other', async () => { order.push('other'); });
    await f.h.probe('demo'); expect(f.calls()).toBe(0); expect(order).not.toContain('second');
    release(); await Promise.all([first, second]); expect(order.indexOf('second')).toBeGreaterThan(order.indexOf('end')); await f.h.close();
  });
  it('fails closed when the recovery ledger is corrupt', async () => {
    const f = fixture({ recovery: 'reload', failureThreshold: 1 });
    fs.mkdirSync(path.join(f.c.workspace, '.logos')); fs.writeFileSync(path.join(f.c.workspace, '.logos/health.json'), '{broken');
    const h = new HealthMonitor(f.c, f.recover); f.set({ ok: false }); await h.probe('demo');
    expect(f.recover).not.toHaveBeenCalled(); expect(f.c.registry.getState('demo')?.health.reason).toBe('ledger_unavailable'); await h.close(); await f.h.close();
  });
  it('cooldown prevents a second recovery until it expires and failures emit safe events', async () => {
    vi.useFakeTimers(); const f = fixture({ recovery: 'reload', failureThreshold: 1, cooldown: 100, maxRecoveries: 3 });
    const emit = vi.spyOn(f.c.bus, 'emit'); f.recover.mockResolvedValue({ ok: false }); f.set({ ok: false });
    await f.h.probe('demo'); await f.h.probe('demo'); expect(f.recover).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(101); await f.h.probe('demo'); expect(f.recover).toHaveBeenCalledTimes(2);
    expect(emit).toHaveBeenCalledWith('package:recovery_failed', { pkg: 'demo', policy: 'reload', ok: false }); await f.h.close();
  });
  it('starts after runtime ready, adds diagnostics without changing lifecycle, and has no legacy timers', async () => {
    vi.useFakeTimers(); const f = fixture(); const stabilizer = new Stabilizer(f.c);
    expect(vi.getTimerCount()).toBe(0); await f.c.bus.emit('runtime:ready', {}); expect(vi.getTimerCount()).toBe(1);
    expect(stabilizer.diagnostics('demo')).toMatchObject({ state: 'active', health: { status: 'unknown' } });
    expect(f.c.registry.snapshot().demo.state).toBe('active'); await stabilizer.close(); expect(vi.getTimerCount()).toBe(0);
    fs.writeFileSync(path.join(f.c.workspace, 'demo/package.json'), JSON.stringify({ name: 'demo', runtime: { stability: { routes: ['health'] } } }));
    const legacy = new HealthMonitor(f.c, f.recover); legacy.start(); expect(vi.getTimerCount()).toBe(0); await legacy.close(); await f.h.close();
  });
});

describe('real runtime integration', () => {
  it('probes mounted GET routes with hot reload disabled and exposes health through HTTP and tools', async () => {
    const { bootstrap } = await import('../src/index');
    const { makeWorkspace } = await import('./helpers');
    const workspace = makeWorkspace('logos-monitor-boot-');
    workspace.pkg('sample', {
      'package.json': JSON.stringify({ name: 'sample', runtime: { stability: { monitor: { route: 'health', successThreshold: 1, recovery: 'report' } } } }),
      'routes.js': 'export function health() { /** @register_router health @method GET */ return { status: "degraded" }; }',
    });
    const instance = await bootstrap({ workspace: workspace.root, port: 0, views: { enabled: false }, hotReload: { enabled: false } });
    try {
      await instance.stabilizer.health.probe('sample');
      const address = instance.server.address() as any;
      const response = await fetch(`http://127.0.0.1:${address.port}/__health`);
      expect((await response.json() as any).packages.sample).toMatchObject({ state: 'active', health: { status: 'degraded' } });
      expect(instance.stabilizer.diagnostics('sample')).toMatchObject({ state: 'active', health: { status: 'degraded' } });
      const tools = await import('../src/modules/tools');
      // Kernel tools expose the same additive registry snapshot.
      const catalog = tools.kernelTools(instance.container);
      const status = await catalog.find((tool: any) => tool.name === 'runtime_status')!.handler({});
      expect(status.packages.sample.health.status).toBe('degraded');
    } finally { await instance.close(); workspace.cleanup(); }
  });
});

describe('recovery through existing lifecycle operations', () => {
  it.each(['reload', 'stop', 'failed-reload'])('%s preserves the staging/stop contract', async (policy) => {
    const { bootstrap } = await import('../src/index');
    const { makeWorkspace } = await import('./helpers');
    const workspace = makeWorkspace('logos-monitor-recovery-');
    workspace.pkg('sample', {
      'package.json': JSON.stringify({ name: 'sample', runtime: { stability: {
        routes: policy === 'failed-reload' ? ['missing'] : ['health'],
        monitor: { route: 'health', failureThreshold: 1, recovery: policy === 'stop' ? 'stop' : 'reload' },
      } } }),
      'routes.js': 'export function health() { /** @register_router health @method GET */ return { ok: false }; }',
    });
    const instance = await bootstrap({ workspace: workspace.root, port: false, views: { enabled: false }, hotReload: { enabled: false } });
    try {
      const router = instance.container.state('routers').get('sample'); const previous = router.stack;
      await instance.stabilizer.health.probe('sample');
      const state = instance.container.registry.getState('sample');
      if (policy === 'stop') {
        expect(state?.state).toBe('stopped'); expect(router.stack).toHaveLength(0);
        await instance.stabilizer.health.probe('sample'); expect(state?.state).toBe('stopped');
      } else {
        expect(state?.state).toBe('active');
        expect(state?.health?.status).toBe(policy === 'reload' ? 'recovering' : 'unhealthy');
        if (policy === 'failed-reload') expect(router.stack).toBe(previous);
        else expect(router.stack).not.toBe(previous);
      }
    } finally { await instance.close(); workspace.cleanup(); }
  });
});
