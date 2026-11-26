import { registerModelRuntime } from './model-bindings';
// kernel/container.ts — the Lógos container.
//
// One container = one runtime. All state that was module-level in v1
// (routers, WS connections, tool registries, caches) now lives here, which
// makes multiple runtimes per process — and therefore isolated tests —
// possible. A default container backs the v1-compatible loose exports.

'use strict';

import { EventBus } from './bus';
import { ResourceTransactions, ResourceConsumer } from './resource-transactions';
import type { ResourceReference } from './resource-identity';
import { runtimeEvent } from './runtime-protocol';
import { PackageRegistry } from './registry';
import { resolveWorkspace } from './utils';
import { AccessController } from './access-controller';
import { PackageContext } from './package-context';
import { EventContractRegistry } from './event-contracts';
import {
  EffectDisposeReport,
  EffectScope,
  EffectScopeOptions,
  EffectScopeRegistry,
  EffectScopeSnapshot,
} from './effects';
import { ServiceGraph } from './services';
import { ReactiveLifecycle } from './lifecycle';
import { EventGovernance } from './event-governance';

export interface LogosModule {
  name: string;
  version?: string;
  api?: Record<string, any>;
  resources?: Record<string, ResourceConsumer>;
  /** Serializable argument tuples and result types for generic resource handlers. */
  contracts?: Record<string, import('./resource-types').ResourceContract>;
  /** Mediated requests from isolated packages, interpreted by their provider. */
  capabilities?: Record<string, (request: any, context: Readonly<{ package: string }>) => any>;
  prepare?(): void | Promise<void>;
  start?(): void | Promise<void>;
  close?(): void | Promise<void>;
  /** Both phases precede package wiring; boot installs before wire. */
  phase: 'boot' | 'wire';
  after?: string[];
  /** Required modules, which must be present and installed first. */
  requires?: string[];
  /** false = replacing this module only takes effect on next boot. */
  swappable?: boolean;
  install(container: Container): void | Promise<void>;
}

export class Container {
  readonly resourceTransactions = new ResourceTransactions(this);

  /** Resolve metadata relative to the caller's package directory. */
  resolveResource(callerFolder: string, reference: ResourceReference) {
    return this.resourceTransactions.resolve(callerFolder, reference);
  }

  bus: EventBus;
  registry: PackageRegistry;
  authority: AccessController;
  eventContracts: EventContractRegistry;
  eventGovernance: EventGovernance;
  services: ServiceGraph;
  lifecycle: ReactiveLifecycle;
  config: Record<string, any>;
  private moduleCatalog = new Map<string, LogosModule>();
  get modules(): ReadonlyMap<string, LogosModule> { return new Map(this.moduleCatalog); }
  /** Installed names persist across phase calls so wire can depend on boot.
   * The complete catalog is collected and sealed before installation.
   */
  private installedModules = new Set<string>();
  private installationOrder: LogosModule[] = [];
  private sealed = false;
  private closing: Promise<void> | null = null;
  get modulesSealed(): boolean { return this.sealed; }

  /** Validate the complete graph before acquiring resources. */
  sealModules(): ReadonlyArray<Readonly<LogosModule>> {
    if (!this.sealed) {
      this.planPhase('boot', new Set());
      this.planPhase('wire', new Set([...this.moduleCatalog.values()].filter(m => m.phase === 'boot').map(m => m.name)));
      const types = new Map<string, string>();
      const capabilities = new Map<string, string>();
      for (const mod of this.moduleCatalog.values()) {
        for (const name of Object.keys(mod.capabilities || {})) {
          if (capabilities.has(name)) throw new Error(`[logos] capability "${name}" claimed by both "${capabilities.get(name)}" and "${mod.name}"`);
          capabilities.set(name, mod.name);
        }
        for (const type of Object.keys(mod.resources || {})) {
          if (types.has(type)) throw new Error(`[logos] resource type "${type}" claimed by both "${types.get(type)}" and "${mod.name}"`);
          types.set(type, mod.name);
        }
      }
      for (const [name, mod] of this.moduleCatalog) this.moduleCatalog.set(name, Object.freeze({
        ...mod, after: Object.freeze([...(mod.after || [])]) as any,
        requires: Object.freeze([...(mod.requires || [])]) as any,
        resources: Object.freeze(Object.fromEntries(Object.entries(mod.resources || {}).map(([type, consumer]) => [
          type, typeof consumer === 'function' ? consumer : Object.freeze({ prepare: consumer.prepare.bind(consumer) }),
        ]))),
        capabilities: Object.freeze({ ...mod.capabilities }),
      }));
      this.sealed = true;
    }
    return Object.freeze([...this.moduleCatalog.values()]);
  }

  async prepareModules(): Promise<void> {
    for (const mod of this.installationOrder) await mod.prepare?.();
  }

  async startModules(): Promise<void> {
    for (const mod of this.installationOrder) await mod.start?.();
  }

  /** Reverse acquisition order and attempt every disposer, including partial installs. */
  closeModules(): Promise<void> {
    if (this.closing) return this.closing;
    this.closing = (async () => {
      const errors: unknown[] = [];
      try { await this.resourceTransactions.close(); } catch (error) { errors.push(error); }
      for (const mod of [...this.installationOrder].reverse()) {
        try { await mod.close?.(); } catch (error) { errors.push(error); }
        this.bus.removeOwner(`module:${mod.name}`);
        this.state('external-api').delete(mod.name);
        for (const name of Object.keys(mod.capabilities || {})) this.state('runtime:capabilities').delete(name);
        this.installedModules.delete(mod.name);
      }
      this.installationOrder = [];
      if (errors.length) throw new AggregateError(errors, 'Module shutdown failed');
    })();
    return this.closing;
  }
  /** Namespaced state buckets — modules keep their state here, not in globals. */
  private buckets = new Map<string, Map<string, any>>();
  private effects = new EffectScopeRegistry();
  private packageScopes = new Map<string, EffectScope>();
  log: (...args: any[]) => void = console.log;
  app: any = null;
  server: any = null;

  constructor(config: Record<string, any> = {}) {
    this.config = config;
    const workspace = resolveWorkspace(config.workspace);
    process.env.PACKAGES_PATH = workspace; // v1 modules & packages read this
    this.registry = new PackageRegistry(workspace);
    this.eventContracts = new EventContractRegistry();
    this.eventGovernance = new EventGovernance(config.eventGovernance ?? {}, workspace, source => this.registry.getPackage(source));
    this.services = new ServiceGraph({ selections: config?.services?.selections });
    this.lifecycle = new ReactiveLifecycle({
      services: this.services,
      createScope: (owner, generation) => this.createScope({ owner, generation, kind: 'package-service-lifecycle' }),
    });
    this.authority = new AccessController(
      packageName => this.registry.getPackage(packageName),
      message => this.log(message),
      10_000,
      packageName => this.config?.authority?.grants?.[packageName] ?? null,
    );
    registerModelRuntime(this);
    this.bus = new EventBus(msg => this.log(msg), this.authority, this.eventContracts, this.eventGovernance);
  }

  get workspace(): string {
    return this.registry.workspace;
  }

  /** Gets (creating if needed) a named state bucket. */
  state(namespace: string): Map<string, any> {
    let bucket = this.buckets.get(namespace);
    if (!bucket) {
      bucket = new Map();
      this.buckets.set(namespace, bucket);
    }
    return bucket;
  }

  /** Creates a package-owned, authority-aware facade over runtime services. */
  packageContext(packageName: string): PackageContext {
    return new PackageContext(this, packageName);
  }

  /** Creates an owned resource scope tracked by the runtime inventory. */
  createScope(options: EffectScopeOptions): EffectScope {
    return this.effects.create(options);
  }

  /** Creates and selects the current scope for one package generation. */
  createPackageScope(owner: string, generation = 'default'): EffectScope {
    const current = this.packageScopes.get(owner);
    if (current && current.state !== 'disposed') {
      throw new Error(`Package "${owner}" already has an active EffectScope (${current.id})`);
    }
    const scope = this.createScope({ owner, generation, kind: 'package' });
    this.packageScopes.set(owner, scope);
    return scope;
  }

  getPackageScope(owner: string): EffectScope | undefined {
    return this.packageScopes.get(owner);
  }

  /** Read-only snapshot: arbitrary resource values and disposer closures never escape. */
  effectInventory(): ReadonlyArray<EffectScopeSnapshot> {
    return this.effects.inventory();
  }

  async disposePackageScope(owner: string, reason = 'package_disposed'): Promise<EffectDisposeReport | null> {
    const scope = this.packageScopes.get(owner);
    if (!scope) return null;
    this.packageScopes.delete(owner);
    return scope.dispose(reason);
  }

  async disposeAllScopes(reason = 'runtime_disposed'): Promise<ReadonlyArray<EffectDisposeReport>> {
    this.packageScopes.clear();
    return this.effects.disposeAll(reason);
  }

  /** Registers a module. A later registration with the same name overrides. */
  use(mod: LogosModule, source = 'builtin'): void {
    if (this.sealed) throw new Error(`[logos] module catalog is sealed; cannot register "${mod.name}" until next boot`);
    if (!mod || typeof mod.name !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(mod.name) ||
        !['boot', 'wire'].includes(mod.phase) || typeof mod.install !== 'function') {
      throw new TypeError('[logos] module requires a valid name, boot/wire phase and install function');
    }
    for (const field of ['after', 'requires'] as const) {
      if (mod[field] !== undefined && (!Array.isArray(mod[field]) || mod[field].some(name => typeof name !== 'string'))) {
        throw new TypeError(`[logos] module "${mod.name}" ${field} must be an array of module names`);
      }
    }
    for (const [type, consumer] of Object.entries(mod.resources || {})) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/.test(type) || (typeof consumer !== 'function' && typeof consumer?.prepare !== 'function')) {
        throw new TypeError(`[logos] module "${mod.name}" has an invalid resource consumer "${type}"`);
      }
    }
    for (const [name, provider] of Object.entries(mod.capabilities || {})) {
      if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(name) || typeof provider !== 'function') {
        throw new TypeError(`[logos] module "${mod.name}" has invalid capability "${name}"`);
      }
    }
    const existing = this.moduleCatalog.get(mod.name);
    if (existing) {
      this.log(`[logos] module "${mod.name}" overridden by ${source}`);
      // The previous implementation was installed under this name; the
      // replacement has not run yet, so it must be treated as pending again
      // (this is what lets a workspace module override a built-in, per
      // docs/modules.md, even though the built-in already installed once).
      this.installedModules.delete(mod.name);
    }
    this.moduleCatalog.set(mod.name, mod);
    if (mod.api) this.state('external-api').set(mod.name, Object.freeze({ ...mod.api }));
    else if (existing) this.state('external-api').delete(mod.name);
  }

  /** Installs registered modules of a phase, ordered by @after dependencies. */
  private planPhase(phase: 'boot' | 'wire', installed = this.installedModules): LogosModule[] {
    const mods = [...this.moduleCatalog.values()].filter(m => m.phase === phase);
    let remaining = mods.filter(m => !installed.has(m.name));
    for (const mod of remaining) {
      for (const dep of mod.requires || []) {
        if (!this.moduleCatalog.has(dep)) throw new Error(`[logos] module "${mod.name}" requires missing module "${dep}"`);
      }
      for (const dep of [...(mod.requires || []), ...(mod.after || [])]) {
        const dependency = this.moduleCatalog.get(dep);
        if (dependency && dependency.phase !== phase && !installed.has(dep)) {
          throw new Error(`[logos] module "${mod.name}" depends on uninstalled module "${dep}" in phase "${dependency.phase}"`);
        }
      }
    }
    // Plan the entire phase before invoking installers. Otherwise an unrelated
    // module can acquire resources before a later cycle is discovered.
    const planned = new Set(installed);
    const ordered: LogosModule[] = [];
    while (remaining.length) {
      const ready = remaining.filter(m =>
        (m.after || []).every(dep => planned.has(dep) || !this.moduleCatalog.has(dep)) &&
        (m.requires || []).every(dep => planned.has(dep)));
      if (!ready.length) {
        throw new Error(`[logos] module dependency cycle among: ${remaining.map(m => m.name).join(', ')}`);
      }
      for (const mod of ready) {
        planned.add(mod.name);
        ordered.push(mod);
      }
      remaining = remaining.filter(m => !planned.has(m.name));
    }
    return ordered;
  }

  async installPhase(phase: 'boot' | 'wire'): Promise<void> {
    for (const mod of this.planPhase(phase)) {
      this.installationOrder.push(mod);
      try {
        await runtimeEvent(this, 'logos:module:installing', phase, { module: mod.name, moduleVersion: mod.version || '0.0.0' });
        await mod.install(this);
        for (const [name, provider] of Object.entries(mod.capabilities || {})) this.state('runtime:capabilities').set(name, provider);
        for (const [type, handler] of Object.entries(mod.resources || {})) {
          if (typeof handler === 'function') this.bus.on(`register:${type}`, handler, { owner: `module:${mod.name}` });
        }
        this.installedModules.add(mod.name);
        await runtimeEvent(this, 'logos:module:installed', phase, { module: mod.name, moduleVersion: mod.version || '0.0.0' });
        await this.bus.emit('runtime:module_installed', { name: mod.name, phase });
      } catch (error) {
        await runtimeEvent(this, 'logos:module:failed', phase, { module: mod.name, error }, false);
        throw error;
      }
    }
  }
}

// ── Default container (backs v1-compatible loose exports) ───────────────────

let _default: Container | null = null;

export function setDefaultContainer(c: Container): void {
  _default = c;
}

export function getDefaultContainer(): Container {
  if (!_default) _default = new Container();
  return _default;
}
