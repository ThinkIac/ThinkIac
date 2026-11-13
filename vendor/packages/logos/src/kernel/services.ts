// kernel/services.ts — capability-first service resolution.
//
// Declarations describe topology; bind() attaches a live implementation only
// while its owner is active. Snapshots intentionally never expose values.

'use strict';

export interface ServiceProviderDeclaration {
  service: string;
  version: string;
  owner: string;
}

export interface ServiceRequirementDeclaration {
  service: string;
  range: string;
  optional: boolean;
  consumer: string;
  provider?: string;
}

export type ServiceRequirementInput = string | {
  range: string;
  optional?: boolean;
  provider?: string;
};

export interface ServiceOwnerConfiguration {
  provides?: Record<string, string>;
  requires?: Record<string, ServiceRequirementInput>;
}

export type ServiceResolutionStatus = 'resolved' | 'missing' | 'ambiguous' | 'incompatible' | 'unbound';

export interface ServiceResolution<T = unknown> {
  status: ServiceResolutionStatus;
  service: string;
  consumer: string;
  range: string;
  optional: boolean;
  provider?: string;
  version?: string;
  value?: T;
  candidates: ReadonlyArray<{ owner: string; version: string; bound: boolean }>;
}

export interface ServiceGraphSnapshot {
  providers: ReadonlyArray<{ service: string; version: string; owner: string; bound: boolean }>;
  requirements: ReadonlyArray<{ service: string; range: string; optional: boolean; consumer: string; provider?: string }>;
  selections: Readonly<Record<string, string>>;
  resolutions: ReadonlyArray<{ service: string; consumer: string; status: ServiceResolutionStatus; provider?: string; version?: string }>;
}

interface ProviderEntry extends ServiceProviderDeclaration {
  bound: boolean;
  value?: unknown;
}

const IDENTITY = /^[a-z0-9][a-z0-9._-]*$/;

function assertIdentity(value: string, label: string): void {
  if (typeof value !== 'string' || !IDENTITY.test(value)) throw new TypeError(`${label} must be a qualified lowercase identifier`);
}

function parseVersion(input: string): [number, number, number] | null {
  const match = String(input).trim().match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?(?:-[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return [Number(match[1]), /^\d+$/.test(match[2] ?? '') ? Number(match[2]) : 0, /^\d+$/.test(match[3] ?? '') ? Number(match[3]) : 0];
}

function compare(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < 3; index += 1) {
    if (left[index] !== right[index]) return left[index] - right[index];
  }
  return 0;
}

function comparator(version: [number, number, number], expression: string): boolean {
  const match = expression.match(/^(>=|<=|>|<|=)?\s*(v?\d+(?:\.\d+){0,2})$/);
  if (!match) return false;
  const target = parseVersion(match[2]);
  if (!target) return false;
  const order = compare(version, target);
  switch (match[1] ?? '=') {
    case '>': return order > 0;
    case '>=': return order >= 0;
    case '<': return order < 0;
    case '<=': return order <= 0;
    default: return order === 0;
  }
}

/** A deliberately small semver matcher for service contracts, without runtime dependencies. */
export function satisfiesServiceVersion(versionInput: string, rangeInput: string): boolean {
  const version = parseVersion(versionInput);
  const range = String(rangeInput).trim();
  if (!version || !range) return false;
  if (range === '*' || /^x$/i.test(range)) return true;

  if (range.includes(' ')) {
    const parts = range.split(/\s+/).filter(Boolean);
    if (parts.every(part => /^(?:>=|<=|>|<|=)/.test(part))) return parts.every(part => comparator(version, part));
  }

  if (range.startsWith('^') || range.startsWith('~')) {
    const base = parseVersion(range.slice(1));
    if (!base || compare(version, base) < 0) return false;
    const upper: [number, number, number] = range[0] === '~'
      ? [base[0], base[1] + 1, 0]
      : base[0] > 0 ? [base[0] + 1, 0, 0] : base[1] > 0 ? [0, base[1] + 1, 0] : [0, 0, base[2] + 1];
    return compare(version, upper) < 0;
  }

  const wildcard = range.match(/^v?(\d+)(?:\.(\d+|x|\*))?(?:\.(\d+|x|\*))?$/i);
  if (wildcard) {
    if (version[0] !== Number(wildcard[1])) return false;
    if (wildcard[2] === undefined || /^(x|\*)$/i.test(wildcard[2])) return true;
    if (version[1] !== Number(wildcard[2])) return false;
    if (wildcard[3] === undefined || /^(x|\*)$/i.test(wildcard[3])) return true;
    return version[2] === Number(wildcard[3]);
  }
  return false;
}

export class ServiceUnavailableError extends Error {
  readonly code: string = 'SERVICE_UNAVAILABLE';
  constructor(readonly resolution: ServiceResolution) {
    super(`Service ${resolution.service}@${resolution.range} is ${resolution.status} for ${resolution.consumer}`);
    this.name = 'ServiceUnavailableError';
  }
}

export class ServiceAmbiguityError extends ServiceUnavailableError {
  readonly code = 'SERVICE_AMBIGUOUS';
  constructor(resolution: ServiceResolution) {
    super(resolution);
    this.name = 'ServiceAmbiguityError';
    this.message = `Service ${resolution.service}@${resolution.range} has multiple providers for ${resolution.consumer}; select one explicitly`;
  }
}

export class ServiceCycleError extends Error {
  readonly code = 'SERVICE_DEPENDENCY_CYCLE';
  constructor(readonly cycle: string[]) {
    super(`Service dependency cycle: ${cycle.join(' -> ')}`);
    this.name = 'ServiceCycleError';
  }
}

function normalizeRequirement(consumer: string, service: string, input: ServiceRequirementInput): ServiceRequirementDeclaration {
  const source = typeof input === 'string' ? { range: input } : input;
  if (!source || typeof source.range !== 'string' || !source.range.trim()) throw new TypeError(`Service requirement ${consumer}:${service} needs a version range`);
  if (source.provider !== undefined) assertIdentity(source.provider, 'Service provider selection');
  return { consumer, service, range: source.range.trim(), optional: source.optional === true, ...(source.provider ? { provider: source.provider } : {}) };
}

export class ServiceGraph {
  private providers = new Map<string, ProviderEntry>();
  private requirements = new Map<string, ServiceRequirementDeclaration>();
  private selections = new Map<string, string>();

  constructor(options: { selections?: Record<string, string> } = {}) {
    for (const [service, owner] of Object.entries(options.selections ?? {})) this.select(service, owner);
  }

  configureOwner(owner: string, configuration: ServiceOwnerConfiguration = {}): void {
    assertIdentity(owner, 'Service owner');
    const nextProviders: ProviderEntry[] = [];
    const nextRequirements: ServiceRequirementDeclaration[] = [];
    for (const [service, version] of Object.entries(configuration.provides ?? {})) {
      assertIdentity(service, 'Service name');
      if (typeof version !== 'string' || !parseVersion(version)) throw new TypeError(`Service ${service} has invalid version ${version}`);
      const previous = this.providers.get(`${owner}\0${service}`);
      nextProviders.push({ owner, service, version, bound: previous?.version === version && previous.bound === true, ...(previous?.version === version && previous.bound ? { value: previous.value } : {}) });
    }
    for (const [service, input] of Object.entries(configuration.requires ?? {})) {
      assertIdentity(service, 'Service name');
      nextRequirements.push(normalizeRequirement(owner, service, input));
    }

    for (const [key, provider] of this.providers) if (provider.owner === owner) this.providers.delete(key);
    for (const [key, requirement] of this.requirements) if (requirement.consumer === owner) this.requirements.delete(key);
    for (const provider of nextProviders) this.providers.set(`${owner}\0${provider.service}`, provider);
    for (const requirement of nextRequirements) this.requirements.set(`${owner}\0${requirement.service}`, requirement);
  }

  removeOwner(owner: string): void {
    for (const [key, provider] of this.providers) if (provider.owner === owner) this.providers.delete(key);
    for (const [key, requirement] of this.requirements) if (requirement.consumer === owner) this.requirements.delete(key);
    for (const [service, selected] of this.selections) if (selected === owner) this.selections.delete(service);
  }

  bind<T>(owner: string, service: string, value: T): () => void {
    const provider = this.providers.get(`${owner}\0${service}`);
    if (!provider) throw new ServiceUnavailableError({ status: 'missing', owner, service, consumer: owner, range: 'declared provider', optional: false, candidates: [] } as any);
    provider.value = value;
    provider.bound = true;
    let active = true;
    return () => {
      if (!active) return;
      active = false;
      if (this.providers.get(`${owner}\0${service}`) === provider) {
        provider.bound = false;
        delete provider.value;
      }
    };
  }

  unbindOwner(owner: string): void {
    for (const provider of this.providers.values()) if (provider.owner === owner) {
      provider.bound = false;
      delete provider.value;
    }
  }

  select(service: string, owner: string | null): void {
    assertIdentity(service, 'Service name');
    if (owner === null) this.selections.delete(service);
    else {
      assertIdentity(owner, 'Service provider selection');
      this.selections.set(service, owner);
    }
  }

  requirementsOf(owner: string): ReadonlyArray<ServiceRequirementDeclaration> {
    return [...this.requirements.values()].filter(item => item.consumer === owner).sort((a, b) => a.service.localeCompare(b.service));
  }

  providersOf(service: string): ReadonlyArray<ServiceProviderDeclaration & { bound: boolean }> {
    return [...this.providers.values()].filter(item => item.service === service)
      .sort((a, b) => a.owner.localeCompare(b.owner))
      .map(({ owner, service: name, version, bound }) => ({ owner, service: name, version, bound }));
  }

  resolve<T = unknown>(consumer: string, service: string): ServiceResolution<T> {
    const requirement = this.requirements.get(`${consumer}\0${service}`);
    if (!requirement) return { status: 'missing', service, consumer, range: 'undeclared', optional: false, candidates: [] };
    const candidates = [...this.providers.values()].filter(item => item.service === service)
      .sort((a, b) => a.owner.localeCompare(b.owner));
    const compatible = candidates.filter(item => satisfiesServiceVersion(item.version, requirement.range));
    const selected = requirement.provider ?? this.selections.get(service);
    let provider: ProviderEntry | undefined;
    let status: ServiceResolutionStatus;
    if (selected) {
      provider = compatible.find(item => item.owner === selected);
      status = provider ? (provider.bound ? 'resolved' : 'unbound') : (candidates.some(item => item.owner === selected) ? 'incompatible' : 'missing');
    } else if (compatible.length === 1) {
      provider = compatible[0];
      status = provider.bound ? 'resolved' : 'unbound';
    } else if (compatible.length > 1) status = 'ambiguous';
    else status = candidates.length ? 'incompatible' : 'missing';
    return {
      status, service, consumer, range: requirement.range, optional: requirement.optional,
      ...(provider ? { provider: provider.owner, version: provider.version, ...(provider.bound ? { value: provider.value as T } : {}) } : {}),
      candidates: Object.freeze(candidates.map(item => Object.freeze({ owner: item.owner, version: item.version, bound: item.bound }))),
    };
  }

  inject<T = unknown>(consumer: string, service: string): T | undefined {
    const resolution = this.resolve<T>(consumer, service);
    if (resolution.status === 'resolved') return resolution.value;
    if (resolution.optional && ['missing', 'incompatible', 'unbound'].includes(resolution.status)) return undefined;
    if (resolution.status === 'ambiguous') throw new ServiceAmbiguityError(resolution);
    throw new ServiceUnavailableError(resolution);
  }

  dependencyMap(options: { includeUnbound?: boolean } = {}): Map<string, Map<string, string>> {
    const dependencies = new Map<string, Map<string, string>>();
    for (const requirement of this.requirements.values()) {
      const resolution = this.resolve(requirement.consumer, requirement.service);
      if (resolution.provider && (resolution.status === 'resolved' || options.includeUnbound)) {
        let ownerDependencies = dependencies.get(requirement.consumer);
        if (!ownerDependencies) dependencies.set(requirement.consumer, ownerDependencies = new Map());
        ownerDependencies.set(requirement.service, resolution.provider);
      }
    }
    return dependencies;
  }

  assertAcyclic(): void {
    const dependencies = this.dependencyMap({ includeUnbound: true });
    const visited = new Set<string>();
    const visiting = new Set<string>();
    const stack: string[] = [];
    const owners = new Set([...this.providers.values()].map(item => item.owner).concat([...this.requirements.values()].map(item => item.consumer))).values();
    const walk = (owner: string): void => {
      if (visited.has(owner)) return;
      if (visiting.has(owner)) {
        const start = stack.indexOf(owner);
        throw new ServiceCycleError([...stack.slice(start), owner]);
      }
      visiting.add(owner); stack.push(owner);
      const providers = [...(dependencies.get(owner)?.values() ?? [])].sort();
      for (const provider of providers) walk(provider);
      stack.pop(); visiting.delete(owner); visited.add(owner);
    };
    for (const owner of [...owners].sort()) walk(owner);
  }

  snapshot(): ServiceGraphSnapshot {
    const providers = [...this.providers.values()].map(({ service, version, owner, bound }) => Object.freeze({ service, version, owner, bound }))
      .sort((a, b) => `${a.service}:${a.owner}`.localeCompare(`${b.service}:${b.owner}`));
    const requirements = [...this.requirements.values()].map(item => Object.freeze({ ...item }))
      .sort((a, b) => `${a.consumer}:${a.service}`.localeCompare(`${b.consumer}:${b.service}`));
    const resolutions = requirements.map(item => {
      const resolution = this.resolve(item.consumer, item.service);
      return Object.freeze({ service: item.service, consumer: item.consumer, status: resolution.status, ...(resolution.provider ? { provider: resolution.provider, version: resolution.version } : {}) });
    });
    return Object.freeze({
      providers: Object.freeze(providers), requirements: Object.freeze(requirements),
      selections: Object.freeze(Object.fromEntries([...this.selections].sort(([a], [b]) => a.localeCompare(b)))),
      resolutions: Object.freeze(resolutions),
    });
  }
}
