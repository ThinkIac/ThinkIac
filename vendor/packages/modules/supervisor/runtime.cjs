'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { atomic, read, policy, request } = require('./common.cjs');

/** Public LogosModule contract; lifecycle operations are supplied by the host. */
function createRuntimeModule({ recoverIsolatedPackage, root } = {}) {
  return { name: 'supervisor', phase: 'boot', swappable: false, install(container) {
    const dir = path.join(container.workspace, '.logos', 'supervisor');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
    const file = path.join(dir, 'packages.json');
    const intent = read(file, { version: 1, packages: {} });
    if (intent?.version !== 1 || !intent.packages || Object.values(intent.packages).some(x => !['running','stopped'].includes(x))) throw new Error('Invalid package supervisor intent');
    const records = new Map(), timers = new Map();
    let closed = false;
    const wantsRunning = folder => !closed && intent.packages[folder] !== 'stopped';
    const get = folder => {
      if (!records.has(folder)) records.set(folder, { desired: intent.packages[folder] ?? 'running', restarts: 0, failures: [], state: 'running', health: 'unknown', error: null });
      return records.get(folder);
    };
    function bootBlock(pkg, visiting = new Set()) {
      if (!wantsRunning(pkg.folder)) return 'stopped';
      if (visiting.has(pkg.folder)) return 'Dependency cycle';
      visiting.add(pkg.folder);
      for (const name of Object.keys(pkg.logosDependencies ?? {})) {
        if (name.endsWith('?')) continue;
        const dependency = container.registry.discover().find(p => p.name === name || p.folder === name || p.folder === name.replace(/^@[^/]+\//, ''));
        if (dependency && bootBlock(dependency, new Set(visiting))) return `Dependency stopped: ${name}`;
      }
      return null;
    }
    function cancel(folder) { clearTimeout(timers.get(folder)); timers.delete(folder); }
    async function schedule(folder, recover, exit) {
      if (!wantsRunning(folder) || timers.has(folder)) return;
      const pkg = container.registry.getPackage(folder), r = get(folder);
      const p = policy(pkg?.runtime?.supervision ?? {});
      if (p.restart === 'never' || (p.restart === 'on-failure' && exit?.code === 0 && !exit?.signal)) { r.state = 'failed'; return; }
      const now = Date.now();
      r.failures = r.readyAt && now - r.readyAt >= p.minUptimeMs ? [] : r.failures.filter(t => now - t < p.windowMs);
      if (r.failures.length >= p.maxRestarts) { r.state = 'failed'; r.error = 'Restart limit reached'; return; }
      r.failures.push(now); r.restarts++; r.state = 'backoff'; r.health = 'unhealthy';
      const wait = Math.min(p.maxDelayMs, p.delayMs * 2 ** Math.min(r.failures.length - 1, 30));
      timers.set(folder, setTimeout(async () => {
        timers.delete(folder);
        if (!wantsRunning(folder)) return;
        try {
          r.state = 'starting';
          const result = await recover();
          if (result?.ok === false) throw new Error(result.error ?? 'Recovery rejected');
          if (!wantsRunning(folder)) return;
          r.state = 'running'; r.health = result?.health ?? 'ready'; r.readyAt = Date.now(); r.error = null;
        } catch (e) { r.error = e.message; await schedule(folder, recover); }
      }, wait));
    }
    const controller = {
      wantsRunning, bootBlock,
      async beforeStop(folder) {
        if (!container.registry.getPackage(folder)) throw new Error(`Unknown package: ${folder}`);
        const next = { ...intent, packages: { ...intent.packages, [folder]: 'stopped' } };
        atomic(file, next); intent.packages = next.packages; cancel(folder);
        Object.assign(get(folder), { desired: 'stopped', state: 'stopped', health: 'unknown' });
      },
      async beforeStart(folder) {
        const pkg = container.registry.getPackage(folder);
        if (!pkg) throw new Error(`Unknown package: ${folder}`);
        const old = intent.packages[folder]; intent.packages[folder] = 'running';
        const blocked = bootBlock(pkg);
        if (blocked) { if (old === undefined) delete intent.packages[folder]; else intent.packages[folder] = old; throw new Error(blocked); }
        try { atomic(file, intent); } catch (error) {
          if (old === undefined) delete intent.packages[folder]; else intent.packages[folder] = old;
          throw error;
        }
        cancel(folder); Object.assign(get(folder), { desired: 'running', failures: [], state: 'starting' });
      },
      snapshot(folder) {
        const r = get(folder), runner = container.state('isolated').get(folder);
        const proc = container.state('proc').get(folder);
        const observed = container.registry.getState(folder)?.state;
        const state = ['backoff', 'failed'].includes(r.state) ? r.state : observed === 'active' ? 'running' : observed ?? r.state;
        return { desired: r.desired, state, health: runner?.running ? 'ready' : r.health, restarts: r.restarts, error: r.error, pid: runner?.pid ?? proc?.pid ?? null, owner: proc ? 'proc' : runner ? 'isolated' : 'runtime' };
      },
      scheduleProc: (folder, recover, exit) => schedule(folder, recover, exit),
      cancel,
      external: async () => {
        if (!process.env.LOGOS_SUPERVISOR_ROOT && !root) return { available: false };
        try { return { available: true, ...await request(root ?? process.env.LOGOS_SUPERVISOR_ROOT, 'status') }; }
        catch (e) { return { available: false, error: e.message }; }
      },
      close() { closed = true; for (const folder of timers.keys()) cancel(folder); },
    };
    container.state('supervisor').set('controller', controller);
    container.bus.on('isolated:exit', async event => {
      if (event.expected || !wantsRunning(event.pkg)) return;
      const r = get(event.pkg); r.error = `Exit ${event.code ?? event.signal}`; r.health = 'unhealthy';
      container.registry.setState(event.pkg, 'failed', r.error);
      const p = policy(container.registry.getPackage(event.pkg)?.runtime?.supervision ?? {});
      if (p.restart === 'on-failure' && event.code === 0 && !event.signal) { r.state = 'stopped'; return; }
      await schedule(event.pkg, () => recoverIsolatedPackage(container, event.pkg));
    }, { owner: 'system' });
    container.bus.on('reload:swapped', event => { const r = get(event.pkg); if (wantsRunning(event.pkg)) Object.assign(r, { state: 'running', readyAt: Date.now(), error: null }); }, { owner: 'system' });
    container.bus.on('shutdown', () => controller.close(), { owner: 'system', priority: -1000 });
  } };
}
function notifyReady() {
  if (!process.env.LOGOS_SUPERVISOR_SERVICE || !process.send) return () => {};
  const send = type => { if (process.connected) process.send({ type }, () => {}); };
  send('logos:ready');
  const timer = setInterval(() => send('logos:heartbeat'), 1000); timer.unref();
  return () => clearInterval(timer);
}
module.exports = { createRuntimeModule, notifyReady };
