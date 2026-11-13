// kernel/lifecycle.ts — reactive package activation over ServiceGraph.

'use strict';

import { EffectDisposer, EffectScope } from './effects';
import {
  ServiceGraph,
  ServiceGraphSnapshot,
  ServiceOwnerConfiguration,
  ServiceRequirementInput,
} from './services';

export type ReactivePackageState = 'registered' | 'waiting_dependencies' | 'activating' | 'active' | 'draining' | 'failed' | 'stopped';

export interface ReactivePackageDefinition {
  owner: string;
  generation?: string;
  provides?: Record<string, string>;
  requires?: Record<string, ServiceRequirementInput>;
  activate(context: ReactiveActivationContext): void | EffectDisposer | Promise<void | EffectDisposer>;
}

export interface ReactiveActivationContext {
  owner: string;
  generation: string;
  scope: EffectScope;
  signal: AbortSignal;
  provide<T>(service: string, value: T): void;
  inject<T = unknown>(service: string): T | undefined;
}

export interface ReconcileReport {
  activated: string[];
  deactivated: string[];
  waiting: string[];
  failed: Array<{ owner: string; error: string }>;
}

export interface ReactiveLifecycleSnapshot {
  packages: ReadonlyArray<{ owner: string; generation: string; state: ReactivePackageState; dependencies: Readonly<Record<string, string>>; error?: string }>;
  services: ServiceGraphSnapshot;
}

interface ActivePackage {
  generation: string;
  scope: EffectScope;
  dependencies: Map<string, string>;
}

function requirementConfiguration(definition: ReactivePackageDefinition): ServiceOwnerConfiguration {
  return { provides: definition.provides ?? {}, requires: definition.requires ?? {} };
}

function sameDependencies(left: Map<string, string> | undefined, right: Map<string, string> | undefined): boolean {
  if (!left || !right || left.size !== right.size) return false;
  for (const [service, owner] of left) if (right.get(service) !== owner) return false;
  return true;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class ReactiveLifecycle {
  readonly services: ServiceGraph;
  private definitions = new Map<string, ReactivePackageDefinition>();
  private states = new Map<string, ReactivePackageState>();
  private errors = new Map<string, string>();
  private active = new Map<string, ActivePackage>();
  private createScope: (owner: string, generation: string) => EffectScope;
  private serial: Promise<unknown> = Promise.resolve();

  constructor(options: {
    services?: ServiceGraph;
    selections?: Record<string, string>;
    createScope?: (owner: string, generation: string) => EffectScope;
  } = {}) {
    this.services = options.services ?? new ServiceGraph({ selections: options.selections });
    this.createScope = options.createScope ?? ((owner, generation) => new EffectScope({ owner, generation, kind: 'package-service-lifecycle' }));
  }

  register(definition: ReactivePackageDefinition): void {
    if (!definition?.owner || typeof definition.activate !== 'function') throw new TypeError('Reactive package owner and activate() are required');
    const normalized = { ...definition, generation: definition.generation ?? 'default' };
    this.services.configureOwner(definition.owner, requirementConfiguration(normalized));
    this.definitions.set(definition.owner, normalized);
    if (!this.active.has(definition.owner)) this.states.set(definition.owner, 'registered');
    this.errors.delete(definition.owner);
  }

  select(service: string, provider: string | null): void {
    this.services.select(service, provider);
  }

  state(owner: string): ReactivePackageState | null {
    return this.states.get(owner) ?? null;
  }

  private desiredDependencies(): Map<string, Map<string, string>> {
    return this.services.dependencyMap({ includeUnbound: true });
  }

  private eligibleOwners(dependencies: Map<string, Map<string, string>>): Set<string> {
    const memo = new Map<string, boolean>();
    const resolving = new Set<string>();
    const eligible = (owner: string): boolean => {
      if (memo.has(owner)) return memo.get(owner)!;
      if (resolving.has(owner)) return false; // assertAcyclic reports the useful path first.
      resolving.add(owner);
      const definition = this.definitions.get(owner);
      let accepted = Boolean(definition);
      if (definition) for (const requirement of this.services.requirementsOf(owner)) {
        const resolution = this.services.resolve(owner, requirement.service);
        if (resolution.status === 'ambiguous') {
          if (!requirement.optional) accepted = false;
          continue;
        }
        if (!resolution.provider) {
          if (!requirement.optional) accepted = false;
          continue;
        }
        if (!requirement.optional && !eligible(resolution.provider)) accepted = false;
      }
      resolving.delete(owner); memo.set(owner, accepted);
      return accepted;
    };
    const result = new Set<string>();
    for (const owner of [...this.definitions.keys()].sort()) if (eligible(owner)) result.add(owner);
    return result;
  }

  private topological(owners: Iterable<string>, dependencies: Map<string, Map<string, string>>): string[] {
    const included = new Set(owners);
    const visited = new Set<string>();
    const result: string[] = [];
    const visit = (owner: string) => {
      if (visited.has(owner)) return;
      visited.add(owner);
      for (const provider of [...(dependencies.get(owner)?.values() ?? [])].sort()) if (included.has(provider)) visit(provider);
      result.push(owner);
    };
    for (const owner of [...included].sort()) visit(owner);
    return result;
  }

  private affectedClosure(roots: Set<string>, previous: Map<string, Map<string, string>>, desired: Map<string, Map<string, string>>): Set<string> {
    const affected = new Set(roots);
    let changed = true;
    while (changed) {
      changed = false;
      for (const [consumer, dependencies] of [...previous, ...desired]) {
        if (affected.has(consumer)) continue;
        if ([...dependencies.values()].some(provider => affected.has(provider))) {
          affected.add(consumer); changed = true;
        }
      }
    }
    return affected;
  }

  reconcile(): Promise<ReconcileReport> {
    const operation = this.serial.then(() => this.performReconcile());
    this.serial = operation.catch(() => undefined);
    return operation;
  }

  private async performReconcile(): Promise<ReconcileReport> {
    this.services.assertAcyclic();
    const desired = this.desiredDependencies();
    const eligible = this.eligibleOwners(desired);
    const previous = new Map([...this.active].map(([owner, item]) => [owner, item.dependencies]));
    const roots = new Set<string>();
    for (const [owner, active] of this.active) {
      const definition = this.definitions.get(owner);
      if (!definition || !eligible.has(owner) || definition.generation !== active.generation || !sameDependencies(active.dependencies, desired.get(owner) ?? new Map())) roots.add(owner);
    }
    const affected = this.affectedClosure(roots, previous, desired);
    const report: ReconcileReport = { activated: [], deactivated: [], waiting: [], failed: [] };

    const previousOrder = this.topological(this.active.keys(), previous).reverse();
    for (const owner of previousOrder) {
      if (!affected.has(owner)) continue;
      const active = this.active.get(owner);
      if (!active) continue;
      this.states.set(owner, 'draining');
      await active.scope.dispose('service_graph_reconciled');
      this.services.unbindOwner(owner);
      this.active.delete(owner);
      this.states.set(owner, this.definitions.has(owner) ? 'registered' : 'stopped');
      report.deactivated.push(owner);
    }

    for (const owner of this.definitions.keys()) if (!eligible.has(owner) && !this.active.has(owner)) {
      this.states.set(owner, 'waiting_dependencies');
      report.waiting.push(owner);
    }

    const activationOrder = this.topological(eligible, desired);
    for (const owner of activationOrder) {
      if (this.active.has(owner)) continue;
      const definition = this.definitions.get(owner)!;
      const unavailable = this.services.requirementsOf(owner).some(requirement => {
        if (requirement.optional) return false;
        return this.services.resolve(owner, requirement.service).status !== 'resolved';
      });
      if (unavailable) {
        this.states.set(owner, 'waiting_dependencies');
        if (!report.waiting.includes(owner)) report.waiting.push(owner);
        continue;
      }
      const generation = definition.generation ?? 'default';
      const scope = this.createScope(owner, generation);
      this.states.set(owner, 'activating');
      try {
        const context: ReactiveActivationContext = Object.freeze({
          owner, generation, scope, signal: scope.signal,
          provide: <T>(service: string, value: T) => {
            const unbind = this.services.bind(owner, service, value);
            scope.defer(unbind, { kind: 'service-provider', label: service });
          },
          inject: <T = unknown>(service: string) => this.services.inject<T>(owner, service),
        });
        const disposer = await definition.activate(context);
        if (typeof disposer === 'function') scope.defer(disposer, { kind: 'package-activation', label: owner });
        for (const service of Object.keys(definition.provides ?? {})) {
          if (!this.services.providersOf(service).some(provider => provider.owner === owner && provider.bound)) {
            throw new Error(`Package ${owner} did not bind declared service ${service}`);
          }
        }
        this.active.set(owner, { generation, scope, dependencies: new Map(desired.get(owner) ?? []) });
        this.states.set(owner, 'active');
        this.errors.delete(owner);
        report.activated.push(owner);
      } catch (error) {
        await scope.dispose('activation_failed');
        this.services.unbindOwner(owner);
        const message = errorMessage(error);
        this.states.set(owner, 'failed');
        this.errors.set(owner, message);
        report.failed.push(Object.freeze({ owner, error: message }));
      }
    }

    report.waiting.sort();
    return report;
  }

  async remove(owner: string): Promise<ReconcileReport> {
    const operation = this.serial.then(async () => {
      const previous = new Map([...this.active].map(([name, item]) => [name, item.dependencies]));
      const affected = this.affectedClosure(new Set([owner]), previous, new Map());
      const deactivated: string[] = [];
      for (const name of this.topological(this.active.keys(), previous).reverse()) if (affected.has(name)) {
        const item = this.active.get(name);
        if (!item) continue;
        this.states.set(name, 'draining');
        await item.scope.dispose('package_removed');
        this.services.unbindOwner(name);
        this.active.delete(name);
        deactivated.push(name);
      }
      this.definitions.delete(owner); this.services.removeOwner(owner); this.states.set(owner, 'stopped');
      const rest = await this.performReconcile();
      return { ...rest, deactivated: [...deactivated, ...rest.deactivated] };
    });
    this.serial = operation.catch(() => undefined);
    return operation;
  }

  snapshot(): ReactiveLifecycleSnapshot {
    const desired = this.desiredDependencies();
    const packages = [...this.definitions.keys()].sort().map(owner => Object.freeze({
      owner,
      generation: this.definitions.get(owner)?.generation ?? 'default',
      state: this.states.get(owner) ?? 'registered',
      dependencies: Object.freeze(Object.fromEntries([...(desired.get(owner) ?? [])].sort(([a], [b]) => a.localeCompare(b)))),
      ...(this.errors.has(owner) ? { error: this.errors.get(owner) } : {}),
    }));
    return Object.freeze({ packages: Object.freeze(packages), services: this.services.snapshot() });
  }
}
