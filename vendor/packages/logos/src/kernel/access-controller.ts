import {
  normalizePackageContract,
  type PackageContractV1,
  type PackageMode,
  type FileAccess,
  type ProcessSpawnGrant,
} from './package-contract';

export type AuthoritySurface = 'events' | 'tools' | 'database' | 'filesystem' | 'secrets' | 'network' | 'process';
export type EventAuthorityOperation = 'publish' | 'subscribe' | 'transform' | 'veto' | 'request';
export type ToolAuthorityOperation = 'provide' | 'invoke' | 'expose' | 'administer';
export type DatabaseAuthorityOperation = 'access';
export type AuthorityOperation = EventAuthorityOperation | ToolAuthorityOperation | DatabaseAuthorityOperation
  | 'read' | 'write' | 'request' | 'spawn';

export interface AuthorityPrincipal {
  kind: 'system' | 'package';
  id: string;
}

export interface AuthorityCheck {
  principal: AuthorityPrincipal;
  surface: AuthoritySurface;
  operation: AuthorityOperation;
  resource: string;
  metadata?: Record<string, any>;
}

export interface AuthorityDecision extends AuthorityCheck {
  caller: string;
  mode: PackageMode | 'system';
  declared: boolean;
  allowed: boolean;
  reason: string | null;
  timestamp: number;
}

export interface AuthorityReport {
  package: string | null;
  operations: ReadonlyArray<AuthorityDecision>;
  violations: ReadonlyArray<AuthorityDecision>;
}

export interface AuthorityExpansionApproval {
  decisionId: string;
  package: string;
  beforeHash: string;
  afterHash: string;
  expanded: ReadonlyArray<string>;
}

export class AuthorityDeniedError extends Error {
  readonly code = 'AUTHORITY_DENIED';
  readonly decision: AuthorityDecision;

  constructor(decision: AuthorityDecision) {
    super(decision.reason ?? `Authority denied for ${decision.caller}`);
    this.name = 'AuthorityDeniedError';
    this.decision = decision;
  }
}

export interface CompiledPackageGrants {
  mode: PackageMode;
  events: Record<EventAuthorityOperation, ReadonlySet<string>>;
  tools: Record<ToolAuthorityOperation, ReadonlySet<string>>;
  database: ReadonlySet<string>;
  files: ReadonlyArray<{ root: string; access: FileAccess }>;
  secrets: ReadonlySet<string>;
  network: ReadonlyArray<{ origin: string; methods: ReadonlySet<string> }>;
  process: ReadonlyArray<ProcessSpawnGrant>;
}

export interface PlatformAuthorityGrants {
  events?: Partial<Record<EventAuthorityOperation, ReadonlyArray<string>>>;
  tools?: Partial<Record<ToolAuthorityOperation, ReadonlyArray<string>>>;
  database?: ReadonlyArray<string>;
  files?: ReadonlyArray<{ root: string; access: FileAccess }>;
  secrets?: ReadonlyArray<string>;
  network?: ReadonlyArray<{ origin: string; methods: ReadonlyArray<string> }>;
  process?: ReadonlyArray<ProcessSpawnGrant>;
}

const SYSTEM_PRINCIPAL: AuthorityPrincipal = Object.freeze({ kind: 'system', id: 'system' });

function emptyContract(name: string): any {
  return { name, version: null };
}

export function compilePackageGrants(contract: PackageContractV1): CompiledPackageGrants {
  return {
    mode: contract.mode,
    events: {
      publish: new Set(contract.permissions.events.publish),
      subscribe: new Set(contract.permissions.events.subscribe),
      transform: new Set(contract.permissions.events.transform),
      veto: new Set(contract.permissions.events.veto),
      request: new Set(contract.permissions.events.request),
    },
    tools: {
      provide: new Set(contract.provides.tools),
      invoke: new Set(contract.permissions.tools.invoke),
      expose: new Set(contract.permissions.tools.exposeToAgents),
      administer: new Set(contract.permissions.tools.administer),
    },
    database: new Set(contract.permissions.data.database),
    files: contract.permissions.data.files.map(grant => ({ ...grant })),
    secrets: new Set(contract.permissions.data.secrets),
    network: contract.permissions.network.map(grant => ({ origin: grant.origin, methods: new Set(grant.methods) })),
    process: contract.permissions.process.spawn.map(grant => ({ ...grant, args: [...grant.args], cwd: [...grant.cwd], env: [...grant.env] })),
  };
}

export class AccessController {
  private operations: AuthorityDecision[] = [];
  private expansionApprovals = new Map<string, Readonly<AuthorityExpansionApproval>>();

  constructor(
    private resolveManifest: (packageName: string) => unknown,
    private log: (message: string) => void = console.warn,
    private maxEntries = 10_000,
    private resolvePlatformGrants: (packageName: string) => PlatformAuthorityGrants | null = () => null,
  ) {}

  private record(decision: AuthorityDecision): AuthorityDecision {
    this.operations.push(decision);
    if (this.operations.length > this.maxEntries) {
      this.operations.splice(0, this.operations.length - this.maxEntries);
    }
    return decision;
  }

  grantsFor(packageName: string): CompiledPackageGrants {
    const manifest = this.resolveManifest(packageName) ?? emptyContract(packageName);
    const grants = compilePackageGrants(normalizePackageContract(manifest).contract as PackageContractV1);
    const platform = this.resolvePlatformGrants(packageName);
    if (!platform) return grants;
    for (const operation of Object.keys(grants.events) as EventAuthorityOperation[]) {
      for (const resource of platform.events?.[operation] ?? []) (grants.events[operation] as Set<string>).add(resource);
    }
    for (const operation of Object.keys(grants.tools) as ToolAuthorityOperation[]) {
      for (const resource of platform.tools?.[operation] ?? []) (grants.tools[operation] as Set<string>).add(resource);
    }
    for (const resource of platform.database ?? []) (grants.database as Set<string>).add(resource);
    for (const grant of platform.files ?? []) (grants.files as any[]).push({ ...grant });
    for (const resource of platform.secrets ?? []) (grants.secrets as Set<string>).add(resource);
    for (const grant of platform.network ?? []) (grants.network as any[]).push({ origin: grant.origin, methods: new Set(grant.methods.map(method => method.toUpperCase())) });
    for (const grant of platform.process ?? []) (grants.process as any[]).push({ ...grant, args: [...grant.args], cwd: [...grant.cwd], env: [...grant.env] });
    return grants;
  }

  /** Effective immutable contract used by mediated adapters; never includes secret values. */
  contractFor(packageName: string): PackageContractV1 {
    const manifest = this.resolveManifest(packageName) ?? emptyContract(packageName);
    return normalizePackageContract(manifest).contract as PackageContractV1;
  }

  private eventGrantMatches(grants: ReadonlySet<string>, resource: string): boolean {
    if (grants.has(resource) || grants.has('*')) return true;
    for (const pattern of grants) {
      if (pattern.endsWith(':*') && resource.startsWith(`${pattern.slice(0, -2)}:`)) return true;
      if (pattern.startsWith('*:') && resource.endsWith(`:${pattern.slice(2)}`)) return true;
    }
    return false;
  }

  private isDeclared(check: AuthorityCheck, grants: CompiledPackageGrants): boolean {
    if (check.surface === 'events') {
      const operation = check.operation as EventAuthorityOperation;
      return grants.events[operation] ? this.eventGrantMatches(grants.events[operation], check.resource) : false;
    }
    if (check.surface === 'tools') {
      const operation = check.operation as ToolAuthorityOperation;
      return grants.tools[operation]?.has(check.resource) ?? false;
    }
    if (check.surface === 'database') {
      return grants.database.has(check.resource)
        || (grants.database.has('self') && check.resource === check.principal.id);
    }
    if (check.surface === 'filesystem') {
      const operation = check.operation as 'read' | 'write';
      return grants.files.some(grant => {
        const withinRoot = check.resource === grant.root || check.resource.startsWith(`${grant.root}/`);
        const permits = operation === 'read' ? grant.access !== 'write' : grant.access !== 'read';
        return withinRoot && permits;
      });
    }
    if (check.surface === 'secrets') return grants.secrets.has(check.resource);
    if (check.surface === 'network') {
      const method = String(check.metadata?.method ?? 'GET').toUpperCase();
      return grants.network.some(grant => grant.origin === check.resource && grant.methods.has(method));
    }
    if (check.surface === 'process') return grants.process.some(grant => grant.executable === check.resource);
    return false;
  }

  /** Private tenants are an owner-only capability, never a grant another package can request. */
  private isExternalPrivateDatabaseAccess(check: AuthorityCheck): boolean {
    if (check.surface !== 'database' || check.principal.kind !== 'package' || check.principal.id === check.resource) return false;
    try {
      return this.contractFor(check.resource).database.visibility === 'private';
    } catch {
      return false;
    }
  }

  check(check: AuthorityCheck): AuthorityDecision {
    if (check.principal.kind === 'system') {
      const decision = Object.freeze({
        ...check,
        principal: SYSTEM_PRINCIPAL,
        caller: SYSTEM_PRINCIPAL.id,
        mode: 'system' as const,
        declared: true,
        allowed: true,
        reason: null,
        timestamp: Date.now(),
      });
      return this.record(decision);
    }

    let grants: CompiledPackageGrants;
    let contractError: string | null = null;
    try {
      grants = this.grantsFor(check.principal.id);
    } catch (error: any) {
      contractError = error?.message ?? String(error);
      grants = compilePackageGrants(normalizePackageContract(emptyContract(check.principal.id)).contract as PackageContractV1);
    }

    const privateDatabaseDenied = this.isExternalPrivateDatabaseAccess(check);
    const declared = !privateDatabaseDenied && contractError === null && this.isDeclared(check, grants);
    const enforcing = grants.mode === 'strict' || grants.mode === 'isolated';
    const allowed = !privateDatabaseDenied && (declared || !enforcing);
    const reason = privateDatabaseDenied
      ? `database tenant ${check.resource} is private and can only be accessed by its owning package`
      : declared
      ? null
      : contractError ?? `${check.surface}.${check.operation} is not declared for ${check.principal.id}: ${check.resource}`;
    const decision = Object.freeze({
      ...check,
      principal: Object.freeze({ ...check.principal }),
      caller: check.principal.id,
      mode: grants.mode,
      declared,
      allowed,
      reason,
      timestamp: Date.now(),
    });
    if (!declared && grants.mode === 'warn') this.log(`[authority] ${reason}`);
    return this.record(decision);
  }

  enforce(check: AuthorityCheck): AuthorityDecision {
    const decision = this.check(check);
    if (!decision.allowed) throw new AuthorityDeniedError(decision);
    return decision;
  }

  approveExpansion(approval: AuthorityExpansionApproval): void {
    if (!approval.decisionId || !approval.package || !approval.beforeHash || !approval.afterHash) {
      throw new TypeError('Authority expansion approval requires decisionId, package, beforeHash and afterHash');
    }
    const normalized = Object.freeze({
      ...approval,
      expanded: Object.freeze([...new Set(approval.expanded)].sort()),
    });
    this.expansionApprovals.set(`${approval.package}\0${approval.beforeHash}\0${approval.afterHash}`, normalized);
  }

  consumeExpansionApproval(input: Omit<AuthorityExpansionApproval, 'decisionId'>): Readonly<AuthorityExpansionApproval> | null {
    const key = `${input.package}\0${input.beforeHash}\0${input.afterHash}`;
    const approval = this.expansionApprovals.get(key);
    if (!approval) return null;
    const expected = [...new Set(input.expanded)].sort();
    if (approval.expanded.length !== expected.length || approval.expanded.some((item, index) => item !== expected[index])) {
      return null;
    }
    this.expansionApprovals.delete(key);
    return approval;
  }

  report(packageName?: string): AuthorityReport {
    const operations = this.operations.filter(item => !packageName || item.caller === packageName);
    return Object.freeze({
      package: packageName ?? null,
      operations: Object.freeze([...operations]),
      violations: Object.freeze(operations.filter(item => item.principal.kind === 'package' && !item.declared)),
    });
  }

  clear(): void {
    this.operations.length = 0;
  }
}
