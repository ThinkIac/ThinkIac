// src/index.ts — Lógos runtime entry point.
//
// bootstrap(config) keeps the exact v1 signature and return shape, plus new
// optional keys (http.public, views.theme/index/tailwind, hotReload.quiescenceMs, mcp).
// Every loose v1 export (pushToSession, broadcast, $, dispatchEvent, register*,
// scriba, getProxy, setViewsGlobalData, …) is preserved as a facade over the
// default container, so existing packages and callers do not change.
//
// Marca: Lógos. Superfície pública: o pacote `logos`.

'use strict';

import express from 'express';
import http from 'http';
import { performance } from 'perf_hooks';
import { HttpPerformance, recordPhase } from './kernel/http-performance';
import { CpuWorkerPool } from './kernel/cpu-pool';
import fs from 'fs';
import path from 'path';

import { Container, setDefaultContainer, getDefaultContainer } from './kernel/container';
import { EventBus, matchesEvent } from './kernel/bus';
import { getErrors, clearErrors } from './kernel/debug-log';
import { readConfig, saveConfig } from './kernel/config';
import { scanCache } from './kernel/scan';
import { validatePackageWiring } from './kernel/package-wiring';
import { emitPackageDeclarations } from './kernel/declaration-events';
import { callPackageEvent } from './kernel/package-event-calls';
export { EventGovernance } from './kernel/event-governance';
export type { EventApprovalChoice, EventApprovalReceipt, EventApprovalScope, EventDeliveryRequest, EventGovernanceOptions } from './kernel/event-governance';
import { resolveLogosDependencies } from './kernel/logos-dependencies';
import { registerPackageFaultRecovery } from './kernel/package-fault-recovery';
import { runAsSystem } from './kernel/authority-context';
import { startPackage as restartPackage, stopPackage as stopFaultyPackage } from './stabilizer/isolation';

import { installExternalModules, externalApi, discoverExternalRuntimeModules } from './kernel/external-modules';
import { isolatedRunnerFor, stopIsolatedRunner } from './core/isolated/bridge';

// The reusable Svelte library is external; the kernel only re-exports its
// public compiler helpers for compatibility.
function loadBuiltinModule(name: string): any {
  const candidates = [
    path.resolve(__dirname, '../../modules', name),
    path.resolve(__dirname, '../../../modules', name),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) return require(candidate);
  }
  throw new Error(`[logos] required built-in module "${name}" was not found`);
}
const svelteModule = loadBuiltinModule('svelte');

import { Stabilizer } from './stabilizer';
import { bootAttempt, bootStable } from './stabilizer/crashguard';

import { registerModules } from './kernel/scan';
import type { BootstrapConfig, LogosInstance } from './types';

const DEFAULT_PORT = 5040;

type PackageActivation = (folder: string, source?: string) => Promise<any>;

/** Only a clean package-view URL can opt into the recovery UI. */
function missingViewTarget(requestPath: string): { pkg: string; path: string } | null {
  const pathOnly = String(requestPath || '').split('?')[0];
  const match = pathOnly.match(/^\/view\/([A-Za-z0-9][A-Za-z0-9._-]*)(?:\/[A-Za-z0-9_-]+)?\/?$/);
  return match ? { pkg: match[1], path: pathOnly } : null;
}

function missingViewPage(target: { pkg: string; path: string }): string {
  // target is derived by missingViewTarget, whose grammar excludes HTML-significant characters.
  const pathJson = JSON.stringify(target.path).replace(/</g, '\\u003c');
  return `<!doctype html>
<html lang="pt-BR" data-theme="dark">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Página indisponível</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&display=swap');
    [data-theme="dark"] { --tk-bg:#111111; --tk-surface:#181818; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888888; --tk-accent:#f5f5f5; --tk-on-accent:#111111; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; }
    [data-theme="light"] { --tk-bg:#ffffff; --tk-surface:#f5f5f5; --tk-border:rgba(0,0,0,.10); --tk-border-hi:rgba(0,0,0,.18); --tk-text:#1a1a1a; --tk-muted:#666666; --tk-accent:#111111; --tk-on-accent:#ffffff; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; }
    * { box-sizing:border-box; } body { margin:0; min-height:100dvh; background:var(--tk-bg); color:var(--tk-text); font-family:var(--tk-font); }
    header { height:64px; display:flex; align-items:center; padding:0 clamp(20px, 5vw, 56px); border-bottom:1px solid var(--tk-border); } .brand { color:var(--tk-text); font-size:15px; font-weight:500; letter-spacing:-.03em; }
    main { width:min(100% - 40px, 520px); min-height:calc(100dvh - 64px); display:flex; flex-direction:column; justify-content:center; padding:80px 0; } .mark { width:34px; height:34px; display:grid; place-items:center; margin-bottom:28px; border:1px solid var(--tk-border-hi); border-radius:50%; color:var(--tk-muted); } .mark svg { width:17px; fill:none; stroke:currentColor; stroke-width:1.5; }
    h1 { margin:0; font-size:clamp(1.7rem, 5vw, 2.3rem); font-weight:400; letter-spacing:-.045em; } p { margin:14px 0 0; color:var(--tk-muted); font-size:14px; line-height:1.6; } .actions { display:flex; align-items:center; gap:14px; margin-top:30px; } button { min-height:42px; padding:0 16px; border:0; border-radius:var(--tk-radius-md); background:var(--tk-accent); color:var(--tk-on-accent); cursor:pointer; font:500 13px/1 var(--tk-font); transition:opacity 220ms ease-out,transform 220ms ease-out; } button:hover:not(:disabled) { opacity:.86; transform:translateY(-1px); } button:disabled { cursor:wait; opacity:.55; } #status { min-height:1.6em; margin:0; font-size:13px; } .attempts { color:var(--tk-muted); font-size:11px; } .final #status { color:var(--tk-text); font-size:15px; } .final .attempts { display:none; }
    @media (prefers-reduced-motion:reduce) { button { transition:none; } }
  </style>
</head>
<body>
  <header><span class="brand">ThinkIac</span></header>
  <main aria-labelledby="title">
    <div class="mark" aria-hidden="true"><svg viewBox="0 0 24 24"><path d="M12 7v5m0 4h.01M5.1 19h13.8a1.8 1.8 0 0 0 1.56-2.7L13.56 4.4a1.8 1.8 0 0 0-3.12 0L3.54 16.3A1.8 1.8 0 0 0 5.1 19Z"/></svg></div>
    <h1 id="title">Esta página não está disponível.</h1>
    <p>Vamos tentar encontrá-la novamente.</p>
    <div class="actions"><button type="button" id="retry">Tentar novamente</button><span class="attempts" id="attempts"></span></div>
    <p id="status" role="status" aria-live="polite"></p>
  </main>
  <script>
    (() => {
      const path = ${pathJson};
      const button = document.getElementById('retry');
      const status = document.getElementById('status');
      const attempts = document.getElementById('attempts');
      const maxAttempts = 3;
      let count = 0;
      try { document.documentElement.dataset.theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark'; } catch (_) {}
      async function recover() {
        count += 1;
        button.disabled = true;
        status.textContent = 'Procurando a página…';
        attempts.textContent = count < maxAttempts ? count + ' de ' + maxAttempts : '';
        try {
          const response = await fetch('/_logos/view-recovery', { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify({ path }) });
          const result = await response.json();
          if (response.ok && result.ok) return location.assign(result.redirect);
        } catch (_) {
          // O estado de ausência é intencionalmente neutro: não revelar detalhes internos.
        }
        if (count >= maxAttempts) {
          document.querySelector('main').classList.add('final');
          button.remove();
          status.textContent = 'Parece que não há nada por aqui.';
          return;
        }
        status.textContent = 'Ainda não foi possível abrir esta página.';
        button.disabled = false;
      }
      button.addEventListener('click', recover);
      // A primeira abertura de um pacote que acabou de ser criado não deve
      // exigir uma interação extra. A recuperação continua limitada e o botão
      // permanece disponível para novas tentativas caso a ativação falhe.
      void recover();
    })();
  </script>
</body>
</html>`;
}

/** Browser-session bypass for routes discovered with an explicit @public tag. */
export function isPublicRoute(requestPath: string, requestMethod = 'GET'): boolean {
  return externalApi<any>(getDefaultContainer(), 'http').isRegisteredPublicRoute(requestPath, requestMethod);
}

function capability<T = any>(container: Container, name: string): T {
  return externalApi<T>(container, name);
}

function getHub(container: Container): any {
  return capability<any>(container, 'ws').getHub();
}

/** Browser-session bypass for clean URLs backed by a .public.svelte/.svx view. */
export function isPublicView(requestPath: string): boolean {
  return capability<any>(getDefaultContainer(), 'views').isRegisteredPublicView(requestPath);
}

// Built-in modules, in registration order. Workspace modules override by name.
function builtinModules() { return []; }

function warnDeprecated(config: BootstrapConfig): void {
  if (config.atomic !== undefined) {
    console.warn('[logos] "atomic" was removed in v2 and is ignored. See MIGRATION.md.');
  }
  if (config.docker !== undefined) {
    console.warn('[logos] "docker" was removed in v2 and is ignored. See MIGRATION.md.');
  }
}

/**
 * Registra um module-package (runtime.role = "module") no container. Não
 * instala: quem instala é installPhase(), que o boot chama em ordem e o
 * caminho de pacote novo chama de novo para as duas fases.
 */
async function registerModulePackage(container: Container, pkg: any): Promise<boolean> {
  const runtime = pkg.runtime?.runtime;
  if (runtime && runtime !== 'node') {
    capability<any>(container, 'proc').start(pkg);
    container.log(`[logos] process-module "${pkg.folder}" (${runtime}) registered`);
    return true;
  }
  try {
    const mods = await registerModules(pkg.folder);
    for (const meta of mods) {
      container.use({
        name: meta.name,
        phase: meta.phase,
        after: meta.after,
        swappable: meta.swappable,
        install: (c: Container) => meta.install(c),
      }, `workspace:${pkg.folder}`);
    }
    return true;
  } catch (err: any) {
    console.warn(`[logos] failed loading module-package "${pkg.folder}": ${err.message}`);
    return false;
  }
}

export async function bootstrap(config: BootstrapConfig = {}): Promise<LogosInstance> {
  warnDeprecated(config);

  const container = new Container(config);
  setDefaultContainer(container);
  // Installed before the 404 tail; assigned once isolated activation is ready.
  let activatePackage: PackageActivation | null = null;

  // ── Crash-loop guard (may restore the workspace before we wire anything) ──
  const stabilizer = new Stabilizer(container);
  // The auto-repository deploys through the runtime's existing stabilizer.
  // It is kept in container state so the optional module never reaches into
  // bootstrap globals.
  container.state('runtime').set('stabilizer', stabilizer);
  bootAttempt(container.workspace, stabilizer.checkpoints);

  // ── Express app ───────────────────────────────────────────────────────────
  const app = express();
  container.app = app;
  const httpPerformance = config.http?.performance === false ? null : new HttpPerformance();
  const workers = config.workers === false ? null : new CpuWorkerPool(config.workers);
  container.state('runtime').set('workers', workers);
  if (httpPerformance) app.use(httpPerformance.middleware);
  container.state('http').set('performance', httpPerformance);

  // Integrações assinadas (por exemplo, Meta Webhooks) precisam verificar os
  // bytes recebidos, não uma nova serialização de req.body. O conteúdo segue
  // não sendo logado e continua disponível normalmente em req.body.
  app.use(express.json({
    limit: '50mb',
    verify: (req, _res, buffer) => { (req as any).rawBody = buffer.toString('utf8'); },
  }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  if (config.cors) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const cors = require('cors');
      app.use(cors(typeof config.cors === 'object' ? config.cors : undefined));
    } catch {
      console.warn('[logos] cors requested but "cors" is not installed — skipping');
    }
  }
  for (const mw of config.middleware || []) app.use((req, res, next) => {
    const start = performance.now();
    let ended = false;
    const finish = () => { if (!ended) { ended = true; recordPhase(req, 'globalMiddleware', start); } };
    res.once('finish', finish);
    res.once('close', finish);
    const proceed = (err?: any) => { finish(); res.removeListener('finish', finish); res.removeListener('close', finish); next(err); };
    try { Promise.resolve(mw(req, res, proceed)).catch(proceed); } catch (error) { proceed(error); }
  });

  // Protected by the same global gate as existing debug endpoints.
  app.get('/__debug/performance', (_req, res) => res.set('Cache-Control', 'no-store').json({
    ...(httpPerformance?.snapshot() ?? { enabled: false }), workers: workers?.snapshot() ?? { enabled: false },
  }));

  // Debug + health endpoints (v1 parity).
  app.get('/__debug/errors', (_req, res) => res.json(getErrors()));
  app.get('/__ready', (_req, res) => {
    const readiness = container.state('views').get('readiness') ?? { ready: false };
    res.status(readiness.ready ? 200 : 503).set('Cache-Control', 'no-store').json(readiness);
  });
  app.get('/__health', (_req, res) => res.json({
    ok: true, runtime: 'logos', packages: container.registry.snapshot(),
  }));

  // ── Register modules: built-ins first, then external capabilities ─────────
  for (const mod of builtinModules()) container.use(mod, 'builtin');
  installExternalModules(container, config.externalModules ?? discoverExternalRuntimeModules());

  for (const mod of config.modules ?? []) container.use(mod, 'workspace');

  // boot-phase modules install before any package is touched.
  await container.installPhase('boot');

  // Resolve structural Package dependencies before any Package code is loaded.
  const dependencyResolution = await resolveLogosDependencies(container.registry, config.logosDependencies);
  for (const blocked of dependencyResolution.blocked) {
    container.registry.setState(blocked.folder, 'blocked', blocked.error);
    container.log(`[logos:dependencies] "${blocked.folder}" blocked: ${blocked.error}`);
  }
  for (const diagnostic of dependencyResolution.diagnostics) {
    container.log(`[logos:dependencies] optional "${diagnostic.dependency}" for "${diagnostic.package}" unavailable: ${diagnostic.error}`);
  }

  // Resolver output is topologically ordered (providers before consumers).
  const supervisor = container.state('supervisor').get('controller');
  const allPackages = dependencyResolution.packages.filter(pkg => {
    const reason = supervisor?.bootBlock(pkg);
    if (!reason) return true;
    container.registry.setState(pkg.folder, reason === 'stopped' ? 'stopped' : 'blocked', reason);
    return false;
  });
  const modulePackages = allPackages.filter(p => container.registry.isModulePackage(p));
  const normalPackages = allPackages.filter(p => !container.registry.isModulePackage(p));

  // Workspace module-packages: node ones override built-ins by name; non-node
  // ones (python/deno/…) start as process bridges and register on the bus.
  for (const pkg of modulePackages) await registerModulePackage(container, pkg);

  // Re-install boot-phase for any workspace boot module that overrode a builtin.
  await container.installPhase('boot');
  // wire-phase modules (http, ws, tools, views, hooks, …).
  await container.installPhase('wire');

  // ── HTTP + WebSocket servers ──────────────────────────────────────────────
  // Created *before* packages are wired: @stream routes register themselves
  // onto the hub during 'package:wiring' below, and mountStreamRoutes() is a
  // no-op while hub.wss is still null (see modules/ws.ts). Creating the hub
  // here — instead of after the wiring loop — means a package's @stream
  // routes actually work on a cold boot, not just after the first hot-reload.
  const server = http.createServer(app);
  container.server = server;

  const hub = getHub(container);
  hub.create(server, { path: '/ws', authorize: config.ws?.authorize });

  // ── Wire each normal package through the bus ──────────────────────────────
  for (const pkg of normalPackages) {
    container.registry.setState(pkg.folder, 'wiring');
    try {
      await isolatedRunnerFor(container, pkg);
      const wiring = await validatePackageWiring(container, pkg);
      container.services.configureOwner(pkg.folder, {
        provides: wiring.contract.contract.provides.services,
        requires: wiring.contract.contract.requires.services,
      });
      container.eventContracts.replaceOwner(pkg.folder, wiring.contract.contract.provides.eventSchemas);
      await container.bus.emit('package:wiring', { pkg });
      await emitPackageDeclarations(container, pkg);
      container.registry.setActiveContract(pkg.folder, wiring.contract);
      container.registry.setState(pkg.folder, 'active');
    } catch (err: any) {
      await stopIsolatedRunner(container, pkg.folder, 'wiring_failed');
      container.services.removeOwner(pkg.folder);
      container.eventContracts.removeOwner(pkg.folder);
      container.registry.setState(pkg.folder, 'denied_contract', err.message);
    }
  }

  await container.bus.emit('runtime:packages_wired', { count: normalPackages.length });

  // A view can belong to a package created after boot. Give only those URLs a
  // recovery path; ordinary API and asset 404s retain their JSON contract.
  app.post('/_logos/view-recovery', async (req, res) => {
    const target = missingViewTarget(req.body?.path);
    if (!target) return res.status(400).json({ ok: false, error: 'A valid view address is required.' });
    if (!activatePackage) return res.status(503).json({ ok: false, error: 'Package recovery is not ready yet. Please try again.' });
    const result = await activatePackage(target.pkg, 'view-recovery');
    if (!result?.ok) return res.status(404).json({ ok: false, error: result?.error || 'This package could not be restored.' });
    return res.json({ ok: true, redirect: target.path, package: target.pkg, activated: Boolean(result.activated) });
  });

  // 404 + error handler last.
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    const target = missingViewTarget(req.path);
    if (target) return res.status(404).type('html').send(missingViewPage(target));
    return next();
  });
  app.use((req, res) => res.status(404).json({ error: 'Not found', path: req.path }));
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: any, _req: any, res: any, next: any) => {
    // A downstream handler may have completed the response before reporting an
    // asynchronous error. Express cannot write a second response in that case.
    if (res.headersSent) return next(err);
    res.status(err.status || 500).json({ error: err.message || 'Internal error' });
  });

  const readiness = await capability<any>(container, 'views').prewarm();
  container.state('views').set('readiness', readiness);

  const port = config.port === false ? null : (config.port ?? DEFAULT_PORT);
  if (port !== null) {
    await new Promise<void>(resolve => server.listen(port, config.host, () => {
      container.log(`\n⬢ Lógos runtime listening on http://localhost:${port}`);
      resolve();
    }));
  }

  // ── MCP transport (optional) ──────────────────────────────────────────────
  let mcp: any = await externalApi<any>(container, 'mcp').bootstrapMcp(container.workspace);
  if (config.mcp?.http) {
    try { await externalApi<any>(container, 'mcp').createMcpHttpServer({ ...config.mcp, workspace: container.workspace }); }
    catch (err: any) { console.warn(`[logos] MCP HTTP transport failed: ${err.message}`); }
  }

  // ── Stabilizer: discover packages always; watch edits only when enabled ───
  // Production can disable source hot reload without losing the supported
  // lifecycle operation of adding a package. Serializing activation also makes
  // manual recovery and watcher discovery safe to run concurrently.
  const activating = new Map<string, Promise<any>>();
  activatePackage = async (folder: string, source = 'manual'): Promise<any> => {
    // Package locators mirror the registry's intentionally small discovery
    // topology: direct packages, `modules/<name>`, and `<owner>/mcp`.
    // Accepting arbitrary nested paths here would bypass that topology during
    // a hot-add and turn application internals into runtime packages.
    const segment = '[a-zA-Z0-9][a-zA-Z0-9._-]*';
    const locator = new RegExp(`^(?:${segment}|modules/${segment}|${segment}/mcp)$`);
    if (!locator.test(folder)) {
      return { ok: false, pkg: folder, error: 'Invalid package folder name.' };
    }
    if (!fs.existsSync(path.join(container.workspace, folder, 'package.json'))) {
      return { ok: false, pkg: folder, error: 'package.json was not found.' };
    }
    const blocked = supervisor?.bootBlock(container.registry.getPackage(folder));
    if (blocked) return { ok: false, pkg: folder, error: blocked };
    const current = container.registry.getState(folder);
    if (current?.state === 'active') return { ok: true, pkg: folder, activated: false, state: 'active' };
    const pending = activating.get(folder);
    if (pending) return pending;

    const activation = (async () => {
      const pkg = container.registry.getPackage(folder);
      container.log(`[stabilizer] ${source} package activation: "${folder}"`);
      try {
        await stabilizer.ensureDeps(folder);
        // Deliberately a no-op when hot reload is disabled: discovery itself
        // remains live while ongoing source watching does not.
        stabilizer.watchPackage(folder);
        container.registry.setState(folder, 'wiring');
        await isolatedRunnerFor(container, pkg);
        const wiring = await validatePackageWiring(container, pkg);
        container.services.configureOwner(folder, {
          provides: wiring.contract.contract.provides.services,
          requires: wiring.contract.contract.requires.services,
        });
        container.eventContracts.replaceOwner(folder, wiring.contract.contract.provides.eventSchemas);
        if (container.registry.isModulePackage(pkg)) {
          await registerModulePackage(container, pkg);
          await container.installPhase('boot');
          await container.installPhase('wire');
        }
        await container.bus.emit('package:wiring', { pkg });
        await emitPackageDeclarations(container, pkg);
        container.registry.setActiveContract(folder, wiring.contract);
        container.registry.setState(folder, 'active');
        await container.bus.emit('package:added', { pkg: folder, package: pkg });
        stabilizer.checkpoints.commitStable(folder, 'new-package');
        return { ok: true, pkg: folder, activated: true, state: 'active' };
      } catch (err: any) {
        await stopIsolatedRunner(container, folder, 'wiring_failed');
        container.services.removeOwner(folder);
        container.eventContracts.removeOwner(folder);
        container.registry.setState(folder, 'denied_contract', err.message);
        container.log(`[stabilizer] activation of "${folder}" failed: ${err.message}`);
        return { ok: false, pkg: folder, state: 'denied_contract', error: err.message };
      } finally {
        activating.delete(folder);
      }
    })();
    activating.set(folder, activation);
    return activation;
  };
  const packageRecoveryJobs = new Map<string, Promise<void>>();
  const packageFaultTimes = new Map<string, number[]>();
  const removePackageFaultRecovery = registerPackageFaultRecovery(container.authority, (folder, error, source) => {
    if (packageRecoveryJobs.has(folder)) return;
    const now = Date.now();
    const times = (packageFaultTimes.get(folder) || []).filter(at => now - at < 60_000);
    times.push(now);
    packageFaultTimes.set(folder, times);
    const quarantine = times.length >= 3;
    const detail = error instanceof Error ? error.message : String(error);
    container.log('[recovery] ' + source + ' in package "' + folder + '": ' + detail);

    const job = (async () => {
      await new Promise<void>(resolve => setImmediate(resolve));
      try {
        const result = await runAsSystem(container.authority, () => quarantine
          ? stopFaultyPackage(container, folder, { force: true })
          : restartPackage(container, folder));
        if (!result?.ok) throw new Error(result?.error || 'package recovery failed');
        container.log(quarantine
          ? '[recovery] "' + folder + '" stopped after repeated failures; runtime remains active'
          : '[recovery] "' + folder + '" restarted; runtime remains active');
      } catch (recoveryError: any) {
        container.log('[recovery] could not recover "' + folder + '": ' + (recoveryError?.message || recoveryError));
        if (!quarantine) {
          try {
            await runAsSystem(container.authority, () => stopFaultyPackage(container, folder, { force: true }));
            container.log('[recovery] "' + folder + '" stopped after restart failed; runtime remains active');
          } catch (stopError: any) {
            container.log('[recovery] could not stop "' + folder + '": ' + (stopError?.message || stopError));
          }
        }
      }
    })();
    packageRecoveryJobs.set(folder, job);
    void job.finally(() => packageRecoveryJobs.delete(folder)).catch(() => {});
  });
  container.state('runtime').set('removePackageFaultRecovery', removePackageFaultRecovery);
    container.state('runtime').set('activatePackage', activatePackage);
  container.state('runtime').set('packageDiagnostics', (folder?: string) => stabilizer.diagnostics(folder));

  if (stabilizer.enabled()) {
    for (const pkg of [...normalPackages, ...modulePackages]) stabilizer.watchPackage(pkg.folder);
  }
  // Package discovery is a supported lifecycle operation even when source
  // hot reload is disabled. Only per-package edit watchers are conditional.
  stabilizer.watchWorkspace(allPackages.map(p => p.folder), folder => activatePackage(folder, 'watcher'));

  stabilizer.checkpoints.commitStable(null, 'boot');
  bootStable(container.workspace);
  await container.bus.emit('runtime:ready', { port });

  const instance: LogosInstance = {
    app, server, container, stabilizer, mcp, bus: container.bus, workers,
    workspace: container.workspace,
    async close() {
      removePackageFaultRecovery();
      container.state('supervisor').get('controller')?.close();
      await capability<any>(container, 'repo').close();
      await stabilizer.close();
      for (const pkg of modulePackages) await capability<any>(container, 'proc').stop(pkg.folder);
      for (const pkg of normalPackages) await stopIsolatedRunner(container, pkg.folder, 'runtime_closed');
      await container.disposeAllScopes('runtime_closed');
      // Os watchers do stabilizer não pertencem ao servidor HTTP: sem fechá-los
      // aqui, um runtime encerrado continua vigiando o workspace.
      httpPerformance?.close();
      await workers?.close();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
  return instance;
}

// ── v1-compatible loose exports (facades over the default container) ────────
//
// These let existing packages keep doing `const { $, broadcast } = require('logos')`.

export function dispatchEvent(event: string, payload?: any, ctx?: any): Promise<any> {
  return getDefaultContainer().bus.pipeline(event, payload, ctx);
}

/** The famous `$` — dispatch an event (crosses process-module bridges too). */
export function $(event: string, payload?: any, ctx?: any): Promise<any> {
  return callPackageEvent(getDefaultContainer(), event, payload, ctx);
}

export function emit(event: string, payload?: any, ctx?: any): Promise<void> {
  return getDefaultContainer().bus.emit(event, payload, ctx);
}

export function on(event: string, handler: any, opts?: any): () => void {
  return getDefaultContainer().bus.on(event, handler, opts);
}

export function pushToSession(sessionId: string, payload: any): number {
  return getHub(getDefaultContainer()).pushToSession(sessionId, payload);
}

export function broadcast(payload: any): void {
  return getHub(getDefaultContainer()).broadcast(payload);
}

export function isConnected(sessionId: string): boolean {
  return getHub(getDefaultContainer()).isConnected(sessionId);
}

export function onMessage(type: string, handler: Function): () => void {
  return getHub(getDefaultContainer()).onMessage(type, handler);
}

export const getWebSocketRequest = (ws: object) => getHub(getDefaultContainer()).getRequest(ws);
export const ScribaRooms = loadBuiltinModule('scriba-rooms').ScribaRooms;

// Views helpers bound to the default container.
export const setGlobalViewData = (data: Record<string, any>) => capability<any>(getDefaultContainer(), 'views').setGlobalData(data);
export const getGlobalViewData = () => capability<any>(getDefaultContainer(), 'views').getGlobalData();
export const setViewTheme = (theme: Record<string, string>) => capability<any>(getDefaultContainer(), 'views').setTheme(theme);
/** Toggles the Tailwind v4 CDN runtime for every view at runtime (pushes a live reload). */
export const setViewTailwind = (enabled: boolean) => capability<any>(getDefaultContainer(), 'views').setTailwind(enabled);
export const rebuildWidgets = () => capability<any>(getDefaultContainer(), 'views').rebuildWidgets();

// Database facades.
const dbApi = () => externalApi<any>(getDefaultContainer(), 'db');
export const scriba = { get instance() { return dbApi().getScriba(); } };
export const getProxy = (tenant: string) => dbApi().getProxy(tenant);
export const getDocuments = (tenant: string) => dbApi().getDocuments(getDefaultContainer(), tenant);

// Storage facade. Existing packages do not need it; packages that need an
// explicit lifecycle control can opt into this without knowing a provider.
export const storage = { get instance() { return capability<any>(getDefaultContainer(), 'storage').getStorage(); } };
/** Compatibility facade; the implementation is supplied by module-storage. */
export const getStorage = (container = getDefaultContainer()) => capability<any>(container, 'storage').getStorage();
// Type-only compatibility for consumers compiled against Logos v1/v2. Runtime
// storage classes are deliberately owned by the external capability above.
export type { StorageProvider, StorageRecord, StorageState, StorageMeshOptions } from './modules/storage';
export type { S3StorageOptions } from './modules/storage-s3';

// Command facade.
export function command(name: string, args?: any, ctx?: any) {
  return capability<any>(getDefaultContainer(), 'commands').run(
    getDefaultContainer().workspace, name, args, ctx,
  );
}

/** Catálogo MCP para runtimes de agente externos. Logos não executa agentes. */
export function getMcpTools() {
  const container = getDefaultContainer();
  return capability<any>(container, 'tools').loadMcpTools(container.workspace);
}
export { resolveTemplate } from './kernel/template';
export { CpuWorkerPool, CpuQueueFullError, CpuTaskTimeoutError } from './kernel/cpu-pool';
export type { CpuPoolOptions, CpuTaskOptions } from './kernel/cpu-pool';

// Re-exports (register* API, config, bus utils, MCP, types).
export {
  registerTools, registerCommands, registerHooks, registerRoutes,
  registerPredicates, registerMiddlewares, registerModules,
} from './kernel/scan';
export { generateManifest, writeManifest } from './kernel/manifest';
export { AccessController, AuthorityDeniedError, compilePackageGrants } from './kernel/access-controller';
export type {
  AuthorityExpansionApproval,
  AuthorityCheck, AuthorityDecision, AuthorityOperation, AuthorityPrincipal,
  AuthorityReport, AuthoritySurface, CompiledPackageGrants,
  PlatformAuthorityGrants,
} from './kernel/access-controller';
export {
  currentAuthority, runAsPackage, runAsPrincipal, runAsSystem, SYSTEM_PRINCIPAL,
} from './kernel/authority-context';
export { PackageContext } from './kernel/package-context';
export { callPackageEvent, EventPermissionRequiredError } from './kernel/package-event-calls';
export { EffectScope, EffectScopeClosedError, EffectScopeRegistry } from './kernel/effects';
export type {
  EffectAcquire, EffectDisposer, EffectDisposeError, EffectDisposeReport,
  EffectMetadata, EffectResourceSnapshot, EffectScopeOptions, EffectScopeSnapshot,
  EffectScopeState,
} from './kernel/effects';
export {
  ServiceGraph, ServiceAmbiguityError, ServiceCycleError, ServiceUnavailableError,
  satisfiesServiceVersion,
} from './kernel/services';
export type {
  ServiceGraphSnapshot, ServiceOwnerConfiguration, ServiceProviderDeclaration,
  ServiceRequirementDeclaration, ServiceRequirementInput, ServiceResolution,
  ServiceResolutionStatus,
} from './kernel/services';
export { ReactiveLifecycle } from './kernel/lifecycle';
export type {
  ReactiveActivationContext, ReactiveLifecycleSnapshot, ReactivePackageDefinition,
  ReactivePackageState, ReconcileReport,
} from './kernel/lifecycle';
export { validatePackageWiring } from './kernel/package-wiring';
export { EventContractRegistry, EventSchemaValidationError } from './kernel/event-contracts';
export type { PackageManifest } from './kernel/manifest';
export {
  PACKAGE_CONTRACT_VERSION,
  PACKAGE_MODES,
  diffPackageAuthority,
  normalizePackageContract,
  stableStringify,
  validatePackageContract,
} from './kernel/package-contract';
export type {
  AuthorityDiff,
  ContractValidation,
  EffectivePackageContract,
  FileAccess,
  DataClassification,
  EventContractDefinition,
  ProcessSpawnGrant,
  EventSemantic,
  PackageContractV1,
  PackageMode,
  ServiceRequirement,
} from './kernel/package-contract';
// Compatibility isolation facade; stabilization is moving to an external module.
export {
  requestReboot, rebootImpact, criticalPackages, isCritical, packageIsolation,
  stopPackage, startPackage, recoverIsolatedPackage,
} from './stabilizer/isolation';
export type {
  PackageIsolation, RebootImpact, RebootVerdict, StopResult,
} from './stabilizer/isolation';
// Repository hosting is provided by the external repo capability. Helpers are
// loaded from its transport package so importing `logos` never loads an
// internal repository implementation.
const repoTransport = loadBuiltinModule('repo/transport');
export const repoPaths = repoTransport.repoPaths;
export const slugify = repoTransport.slugify;
export const normalizeRepoConfig = repoTransport.normalizeConfig;
export type { RepoState, RepoRuntimeConfig, BranchInstance } from './modules/repo';
export const getRepoState = (container = getDefaultContainer()) => capability<any>(container, 'repo').getState();
// Hot-reload and offline helpers are supplied by the external Svelte capability.
export const resolveHotReloadMode = (pkg: string, query?: any) => capability<any>(getDefaultContainer(), 'views').resolveHotReloadMode(pkg, query);
export const { HOT_RELOAD_MODES, isHotReloadMode, hmrClientScript } = svelteModule;
export type HotReloadMode = 'always' | 'auto' | 'prompt' | 'manual';
export interface RenderOptions { hotReloadMode?: HotReloadMode; hotReloadBadge?: boolean; offlineClient?: string; clientScripts?: string[]; }
// Reconhecedor de pacotes offline: política por pacote (runtime.offline) e por
// rota (@offline), o manifesto que o módulo externo de views consome.
export const {
  resolveOfflinePolicy, buildOfflineManifest, routePatternToRegex,
  serviceWorkerScript, offlineClientScript, OFFLINE_MODES, DEFAULT_OFFLINE_POLICY,
} = svelteModule;
export type OfflineMode = 'off' | 'shell';
export type OfflineReload = 'prompt' | 'manual';
export type OfflineViews = 'all' | 'visited' | string[];
export interface OfflinePolicy { mode: OfflineMode; badge: boolean; views: OfflineViews; reload: OfflineReload; }
export interface OfflineManifest { generatedAt: string; packages: Record<string, unknown>; }
export { OFFLINE_POLICIES, parseOffline } from './kernel/parsers';
export { readConfig, saveConfig };
export { getErrors, clearErrors, scanCache, matchesEvent, EventBus };
export { resolveLogosDependencies, parseLogosDependencies, selectRegistryVersion, DEFAULT_LOGOS_REGISTRY } from './kernel/logos-dependencies';
export type { LogosDependencySpec, DependencyDiagnostic, DependencyResolution } from './kernel/logos-dependencies';
export const bootstrapMcp = (workspace: string, container = getDefaultContainer()) => externalApi<any>(container, 'mcp').bootstrapMcp(workspace);
export const createMcpHttpServer = (options: any = {}) => externalApi<any>(options.container ?? getDefaultContainer(), 'mcp').createMcpHttpServer(options);
export { Container, getDefaultContainer };
export * from './types';

// View engine — exposed so callers can pre-warm .svelte-cache (build SSR+DOM
// bundles ahead of time, e.g. during a Docker image build) without booting
// the full app.
export const { SvelteEngine } = svelteModule;

export default bootstrap;
