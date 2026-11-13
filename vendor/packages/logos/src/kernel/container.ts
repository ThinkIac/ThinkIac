// kernel/container.ts — the Lógos container.
//
// One container = one runtime. All state that was module-level in v1
// (routers, WS connections, tool registries, caches) now lives here, which
// makes multiple runtimes per process — and therefore isolated tests —
// possible. A default container backs the v1-compatible loose exports.

'use strict';

import { EventBus } from './bus';
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
  /** boot = before packages exist (env, db). wire = wiring-time (http, ws…). */
  phase: 'boot' | 'wire';
  after?: string[];
  /** false = replacing this module only takes effect on next boot. */
  swappable?: boolean;
  install(container: Container): void | Promise<void>;
}

export class Container {
  bus: EventBus;
  registry: PackageRegistry;
  authority: AccessController;
  eventContracts: EventContractRegistry;
  eventGovernance: EventGovernance;
  services: ServiceGraph;
  lifecycle: ReactiveLifecycle;
  config: Record<string, any>;
  modules = new Map<string, LogosModule>();
  /**
   * Names of modules that have already run install(). This must survive
   * across installPhase() calls — bootstrap() calls installPhase('boot')
   * and installPhase('wire') separately (and 'boot' can run twice, for
   * workspace overrides discovered after package scanning). A module in
   * the 'wire' phase can legitimately depend (@after) on a module that was
   * installed during the earlier 'boot' phase; if this set were rebuilt on
   * every call, that already-installed dependency would look unsatisfied
   * and installPhase would report a false "dependency cycle".
   */
  private installedModules = new Set<string>();
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
    const existing = this.modules.get(mod.name);
    if (existing) {
      this.log(`[logos] module "${mod.name}" overridden by ${source}`);
      // The previous implementation was installed under this name; the
      // replacement has not run yet, so it must be treated as pending again
      // (this is what lets a workspace module override a built-in, per
      // docs/modules.md, even though the built-in already installed once).
      this.installedModules.delete(mod.name);
    }
    this.modules.set(mod.name, mod);
  }

  /** Installs registered modules of a phase, ordered by @after dependencies. */
  async installPhase(phase: 'boot' | 'wire'): Promise<void> {
    const mods = [...this.modules.values()].filter(m => m.phase === phase);
    let remaining = mods.filter(m => !this.installedModules.has(m.name));
    let guard = mods.length + 1;

    while (remaining.length && guard-- > 0) {
      const ready = remaining.filter(m =>
        (m.after || []).every(dep => this.installedModules.has(dep) || !this.modules.has(dep)));
      if (!ready.length) {
        throw new Error(`[logos] module dependency cycle among: ${remaining.map(m => m.name).join(', ')}`);
      }
      for (const mod of ready) {
        await mod.install(this);
        this.installedModules.add(mod.name);
        await this.bus.emit('runtime:module_installed', { name: mod.name, phase });
      }
      remaining = remaining.filter(m => !this.installedModules.has(m.name));
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
