// src/index.ts — Lógos runtime entry point.
//
// bootstrap(config) composes a sealed catalog and coordinates module lifecycle.
// Optional capabilities come from the host selection; absent return fields are null.
// Every loose v1 export (pushToSession, broadcast, $, dispatchEvent, register*,
// scriba, getProxy, setViewsGlobalData, …) is preserved as a facade over the
// default container, so existing packages and callers do not change.
//
// Marca: Lógos. Superfície pública: o pacote `logos`.

'use strict';

import fs from 'fs';
import path from 'path';

import { Container, setDefaultContainer, getDefaultContainer } from './kernel/container';
import { runtimeEvent } from './kernel/runtime-protocol';
export { RUNTIME_PROTOCOL_VERSION } from './kernel/runtime-protocol';
import { EventBus, matchesEvent } from './kernel/bus';
import { getErrors, clearErrors } from './kernel/debug-log';
import { readConfig, saveConfig } from './kernel/config';
import { scanCache } from './kernel/scan';
import { validatePackageContract } from './kernel/package-wiring';
import { emitPackageDeclarations } from './kernel/declaration-events';
import { callPackageEvent } from './kernel/package-event-calls';
export { EventGovernance } from './kernel/event-governance';
export type { EventApprovalChoice, EventApprovalReceipt, EventApprovalScope, EventDeliveryRequest, EventGovernanceOptions } from './kernel/event-governance';
import { resolveLogosDependencies } from './kernel/logos-dependencies';

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
/** Preserve callable/class exports without importing optional capabilities at boot. */
function lazyExport(module: string, name: string): any {
  const resolve = () => loadBuiltinModule(module)[name];
  return new Proxy(function () {}, {
    apply: (_target, receiver, args) => Reflect.apply(resolve(), receiver, args),
    construct: (_target, args) => Reflect.construct(resolve(), args),
    get: (_target, key) => Reflect.get(resolve(), key),
  });
}


import { registerDeclarations } from './kernel/scan';
import { collectStructuralDeclaration } from './kernel/declarative-catalog';
import type { BootstrapConfig, LogosInstance } from './types';

type PackageActivation = (folder: string, source?: string) => Promise<any>;

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

function warnDeprecated(config: BootstrapConfig): void {
  if (config.atomic !== undefined) {
    console.warn('[logos] "atomic" was removed in v2 and is ignored. See MIGRATION.md.');
  }
  if (config.docker !== undefined) {
    console.warn('[logos] "docker" was removed in v2 and is ignored. See MIGRATION.md.');
  }
}

/**
 * Coleta módulos e tipos de qualquer pacote do workspace. Não
 * instala: installPhase() executa as fases após selar o catálogo. Alterar o
 * catálogo após o boot exige nova composição.
 */
async function registerModulePackage(container: Container, pkg: any): Promise<boolean> {
  const runtime = pkg.runtime?.runtime;
  if (runtime && runtime !== 'node') {
    return true;
  }
  try {
    const entries = await registerDeclarations(pkg.dir, true);
    for (const entry of entries.filter(e => ['module', 'type'].includes(e.declaration.type) && !e.declaration.legacy)) {
      await collectStructuralDeclaration(container, entry, `workspace:${pkg.folder}`);
    }
    // Underscore declarations retain their original installer contract.
    for (const entry of entries.filter(entry => entry.declaration.type === 'module' && entry.declaration.legacy)) {
      const tags = entry.declaration.tags;
      container.use({ name: entry.declaration.name!, phase: (tags.phase?.[0] ?? 'wire') as 'boot' | 'wire',
        after: tags.after?.flatMap(value => value.split(/\s+/)), requires: tags.requires?.flatMap(value => value.split(/\s+/)),
        swappable: tags.swappable?.[0] !== 'false', install: (c: Container) => entry.handler(c),
      }, `workspace:${pkg.folder}`);
    }
    return true;
  } catch (err: any) {
    throw new Error(`[logos] failed loading module-package "${pkg.folder}": ${err.message}`, { cause: err });
  }
}

export async function bootstrap(config: BootstrapConfig = {}): Promise<LogosInstance> {
  warnDeprecated(config);

  const container = new Container(config);
  setDefaultContainer(container);
  let closing: Promise<void> | null = null;
  const close = (): Promise<void> => {
    if (closing) return closing;
    closing = (async () => {
      const errors: unknown[] = [];
      const attempt = async (work: () => any) => { try { await work(); } catch (error) { errors.push(error); } };
      container.state('runtime').set('ready', false);
      await attempt(() => runtimeEvent(container, 'logos:stopping', 'stop'));
      for (const pkg of container.registry.discover()) await attempt(() => stopIsolatedRunner(container, pkg.folder, 'runtime_closed'));
      await attempt(() => container.closeModules());
      await attempt(() => container.disposeAllScopes('runtime_closed'));
      for (const cleanup of container.state('runtime:entrypoints').values()) await attempt(cleanup);
      container.state('runtime:entrypoints').clear();
      await attempt(() => runtimeEvent(container, 'logos:stopped', 'stop'));
      if (errors.length) throw new AggregateError(errors, 'Runtime shutdown failed');
    })();
    return closing;
  };
  try {
    // Installed before the 404 tail; assigned once isolated activation is ready.
    let activatePackage: PackageActivation | null = null;


    // Collect host-selected capabilities; no built-in capability list.
    installExternalModules(container, config.externalModules ?? discoverExternalRuntimeModules());
    for (const mod of config.modules ?? []) {
      container.use(mod, 'workspace');
      container.state('runtime:programmatic-modules').set(mod.name, true);
    }
    await runtimeEvent(container, 'logos:starting', 'discover');
    await runtimeEvent(container, 'logos:modules:register', 'register', {
      register: (mod: any) => container.use(mod, 'event'),
    });

    // Resolve structural Package dependencies before any Package code is loaded.
    const dependencyResolution = await resolveLogosDependencies(container.registry, {
      ...config.logosDependencies,
      // Modules own preparation (including npm installation); the launcher only
      // delivers the package in dependency order before importing its code.
      preparePackage: pkg => runtimeEvent(container, 'logos:package:preparing', 'discover', { pkg, package: pkg.folder }),
    });
    for (const blocked of dependencyResolution.blocked) {
      container.registry.setState(blocked.folder, 'blocked', blocked.error);
      container.log(`[logos:dependencies] "${blocked.folder}" blocked: ${blocked.error}`);
    }
    for (const diagnostic of dependencyResolution.diagnostics) {
      container.log(`[logos:dependencies] optional "${diagnostic.dependency}" for "${diagnostic.package}" unavailable: ${diagnostic.error}`);
    }

    // Resolver output is topologically ordered (providers before consumers).
    let supervisor: any;
    let allPackages = dependencyResolution.packages;
    const allowedBySupervisor = (pkg: any) => {
      const reason = supervisor?.bootBlock(pkg);
      if (!reason) return true;
      container.registry.setState(pkg.folder, reason === 'stopped' ? 'stopped' : 'blocked', reason);
      return false;
    };
    // Every package can provide and consume declarations, regardless of its location.
    const modulePackages = allPackages.filter(p => container.registry.isModulePackage(p));
    let normalPackages = allPackages;
    for (const pkg of allPackages) await registerModulePackage(container, pkg);

    const catalog = container.sealModules();
    await runtimeEvent(container, 'logos:modules:sealed', 'seal', {
      modules: catalog.map(mod => ({ name: mod.name, version: mod.version || '0.0.0', phase: mod.phase,
        requires: mod.requires, after: mod.after, resources: Object.keys(mod.resources || {}),
        capabilities: Object.keys(mod.capabilities || {}) })),
    });
    await container.installPhase('boot');
    // wire-phase modules (http, ws, tools, views, hooks, …).
    await container.installPhase('wire');
    supervisor = container.state('supervisor').get('controller');
    allPackages = allPackages.filter(allowedBySupervisor);
    normalPackages = normalPackages.filter(allowedBySupervisor);
    for (const pkg of modulePackages.filter(allowedBySupervisor)) {
      await container.bus.emitStrict('package:module', { pkg });
    }

    await runtimeEvent(container, 'logos:packages:scanning', 'scan');
    await runtimeEvent(container, 'logos:wiring', 'wire');

    // ── Wire each normal package through the bus ──────────────────────────────
    for (const pkg of normalPackages) {
      container.registry.setState(pkg.folder, 'wiring');
      try {
        await isolatedRunnerFor(container, pkg);
        const wiring = await validatePackageContract(container, pkg);
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


    // Package activation is generic coordination. The external stabilizer owns
    // source watching and may call activation for discovery or recovery.
    // Activation is serialized per package; the module catalog stays sealed.
    const activating = new Map<string, Promise<any>>();
    activatePackage = async (folder: string, source = 'manual'): Promise<any> => {
      // Accept arbitrary depth while rejecting traversal and absolute paths.
      const segment = '[a-zA-Z0-9@][a-zA-Z0-9@._-]*';
      const locator = new RegExp(`^${segment}(?:/${segment})*$`);
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
          await container.bus.emitStrict('package:activating', { pkg, source });
          container.registry.setState(folder, 'wiring');
          await isolatedRunnerFor(container, pkg);
          const wiring = await validatePackageContract(container, pkg);
          container.services.configureOwner(folder, {
            provides: wiring.contract.contract.provides.services,
            requires: wiring.contract.contract.requires.services,
          });
          container.eventContracts.replaceOwner(folder, wiring.contract.contract.provides.eventSchemas);
          const structural = (await registerDeclarations(pkg.dir, true)).filter(entry => ['module', 'type'].includes(entry.declaration.type));
          if (structural.length) {
            await registerModulePackage(container, pkg);
            await container.installPhase('boot');
            await container.installPhase('wire');
            await container.bus.emitStrict('package:module', { pkg });
          }
          await container.bus.emit('package:wiring', { pkg });
          await emitPackageDeclarations(container, pkg);
          container.registry.setActiveContract(folder, wiring.contract);
          container.registry.setState(folder, 'active');
          await container.bus.emit('package:added', { pkg: folder, package: pkg });
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
    container.state('runtime').set('activatePackage', activatePackage);
    await container.prepareModules();
    await container.startModules();
    const port = container.state('runtime').get('port') ?? null;
    container.state('runtime').set('ready', true);
    await runtimeEvent(container, 'logos:ready', 'ready', { port });
    await container.bus.emit('runtime:ready', { port });

    const instance: LogosInstance = {
      app: container.app, server: container.server, container, stabilizer: container.state('runtime').get('stabilizer') ?? null,
      mcp: container.state('runtime').get('mcp') ?? null, bus: container.bus, workers: container.state('runtime').get('workers') ?? null,
      workspace: container.workspace,
      close,
    };
    return instance;
  } catch (error) {
    try { await close(); } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], 'Runtime boot failed and cleanup reported errors');
    }
    throw error;
  }
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
export const ScribaRooms = lazyExport('scriba-rooms', 'ScribaRooms');

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
export const repoPaths = lazyExport('repo/transport', 'repoPaths');
export const slugify = lazyExport('repo/transport', 'slugify');
export const normalizeRepoConfig = lazyExport('repo/transport', 'normalizeConfig');
export type { RepoState, RepoRuntimeConfig, BranchInstance } from './modules/repo';
export const getRepoState = (container = getDefaultContainer()) => capability<any>(container, 'repo').getState();
// Hot-reload and offline helpers are supplied by the external Svelte capability.
export const resolveHotReloadMode = (pkg: string, query?: any) => capability<any>(getDefaultContainer(), 'views').resolveHotReloadMode(pkg, query);
export const HOT_RELOAD_MODES = ['always', 'auto', 'prompt', 'manual'];
export const isHotReloadMode = lazyExport('svelte', 'isHotReloadMode');
export const hmrClientScript = lazyExport('svelte', 'hmrClientScript');
export type HotReloadMode = 'always' | 'auto' | 'prompt' | 'manual';
export interface RenderOptions { hotReloadMode?: HotReloadMode; hotReloadBadge?: boolean; offlineClient?: string; clientScripts?: string[]; }
// Reconhecedor de pacotes offline: política por pacote (runtime.offline) e por
// rota (@offline), o manifesto que o módulo externo de views consome.
export const resolveOfflinePolicy = lazyExport('svelte', 'resolveOfflinePolicy');
export const buildOfflineManifest = lazyExport('svelte', 'buildOfflineManifest');
export const routePatternToRegex = lazyExport('svelte', 'routePatternToRegex');
export const serviceWorkerScript = lazyExport('svelte', 'serviceWorkerScript');
export const offlineClientScript = lazyExport('svelte', 'offlineClientScript');
export const OFFLINE_MODES = ['off', 'shell'];
export const DEFAULT_OFFLINE_POLICY = { mode: 'off', badge: true, views: 'visited', reload: 'prompt' };
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
export type { LogosModule } from './kernel/container';
export type { ModuleContext, ModuleDeclaration } from './kernel/module-context';
export type { ResourceConsumer, TransactionalResourceConsumer, ResourceGeneration } from './kernel/resource-transactions';
export * from './types';

// View engine — exposed so callers can pre-warm .svelte-cache (build SSR+DOM
// bundles ahead of time, e.g. during a Docker image build) without booting
// the full app.
export const SvelteEngine = lazyExport('svelte', 'SvelteEngine');

export default bootstrap;
