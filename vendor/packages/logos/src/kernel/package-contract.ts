import { createHash } from 'node:crypto';

export const PACKAGE_CONTRACT_VERSION = 1 as const;
export const PACKAGE_MODES = ['legacy', 'observe', 'warn', 'strict', 'isolated'] as const;

export type PackageMode = typeof PACKAGE_MODES[number];
export type FileAccess = 'read' | 'write' | 'read-write';
export type EventSemantic = 'signal' | 'pipeline' | 'veto' | 'request';
export type DataClassification = 'public' | 'internal' | 'confidential' | 'restricted';
export type DatabaseVisibility = 'shared' | 'private';

export interface ProcessSpawnGrant {
  executable: string;
  args: string[];
  cwd: string[];
  env: string[];
}

export interface EventContractDefinition {
  schemaVersion: number;
  semantic: EventSemantic;
  dataClassification: DataClassification;
  payloadSchema: Record<string, any>;
}

export interface ServiceRequirement {
  range: string;
  optional: boolean;
  provider?: string;
}

export interface PackageContractV1 {
  contractVersion: 1;
  package: { name: string; version: string | null };
  mode: PackageMode;
  /** True when this package must be hosted outside the main Lógos process. */
  isolated: boolean;
  /** Database ownership policy. Private tenants are never available cross-package. */
  database: { visibility: DatabaseVisibility };
  /** Optional, opt-in declaration for calls made through `$()`. */
  eventCalls: string[] | '*' | null;
  provides: {
    services: Record<string, string>;
    tools: string[];
    events: string[];
    eventSchemas: Record<string, EventContractDefinition>;
  };
  requires: { services: Record<string, ServiceRequirement> };
  permissions: {
    tools: { invoke: string[]; exposeToAgents: string[]; administer: string[] };
    events: { publish: string[]; subscribe: string[]; transform: string[]; veto: string[]; request: string[] };
    data: {
      database: string[];
      files: { root: string; access: FileAccess }[];
      secrets: string[];
    };
    network: { origin: string; methods: string[] }[];
    process: { spawn: ProcessSpawnGrant[] };
    ui: string[];
  };
}

export interface EffectivePackageContract {
  contract: Readonly<PackageContractV1>;
  hash: string;
}

export interface ContractValidation {
  ok: boolean;
  errors: string[];
}

export interface AuthorityDiff {
  expanded: string[];
  reduced: string[];
  unchanged: string[];
}

const NAME = /^[a-z0-9][a-z0-9._-]*$/;
const EVENT = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._*-]*$/;
const LOCAL_EVENT_CALL = /^[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$/;
const QUALIFIED_EVENT_CALL = /^[a-z0-9][a-z0-9._-]*::[a-z0-9][a-z0-9._-]*:[a-z0-9][a-z0-9._:-]*$/;
const RESERVED_EVENT_NAMESPACES = new Set([
  'agent', 'credential', 'db', 'http', 'package', 'proc', 'reload', 'route', 'runtime', 'tool', 'views',
]);
const HTTP_METHODS = new Set(['DELETE', 'GET', 'HEAD', 'OPTIONS', 'PATCH', 'POST', 'PUT']);

function isRecord(value: unknown): value is Record<string, any> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function strings(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === 'string').map(item => item.trim()).filter(Boolean))].sort();
}

function eventCalls(value: unknown): string[] | '*' | null {
  if (value === undefined) return null;
  if (value === '*') return '*';
  return strings(value);
}

function eventCallRequestGrants(packageName: string, value: string[] | '*' | null): string[] {
  if (value === null) return [];
  if (value === '*') return ['*'];
  return [
    `${packageName}::*`,
    ...value.map(event => event.includes('::') ? event : `${packageName}::${event}`),
  ];
}

function stringSequence(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && Boolean(item.trim()));
}

function sortedRecord<T>(input: Record<string, T>): Record<string, T> {
  return Object.fromEntries(Object.entries(input).sort(([a], [b]) => a.localeCompare(b)));
}

function serviceVersions(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value)
    .filter(([name, version]) => NAME.test(name) && typeof version === 'string' && version.trim())
    .map(([name, version]) => [name, String(version).trim()]);
  return sortedRecord(Object.fromEntries(entries));
}

function serviceRequirements(value: unknown): Record<string, ServiceRequirement> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([name, requirement]) => {
    if (!NAME.test(name)) return [];
    if (typeof requirement === 'string' && requirement.trim()) {
      return [[name, { range: requirement.trim(), optional: false }] as const];
    }
    if (!isRecord(requirement) || typeof requirement.range !== 'string' || !requirement.range.trim()) return [];
    return [[name, {
      range: requirement.range.trim(), optional: requirement.optional === true,
      ...(typeof requirement.provider === 'string' && requirement.provider.trim() ? { provider: requirement.provider.trim() } : {}),
    }] as const];
  });
  return sortedRecord(Object.fromEntries(entries));
}

function files(value: unknown): { root: string; access: FileAccess }[] {
  if (!Array.isArray(value)) return [];
  const accepted = new Set<FileAccess>(['read', 'write', 'read-write']);
  const normalized = value.flatMap(item => {
    if (!isRecord(item) || typeof item.root !== 'string' || !item.root.trim() || !accepted.has(item.access)) return [];
    return [{ root: item.root.trim(), access: item.access as FileAccess }];
  });
  const unique = new Map(normalized.map(item => [`${item.root}\0${item.access}`, item]));
  return [...unique.values()].sort((a, b) => `${a.root}:${a.access}`.localeCompare(`${b.root}:${b.access}`));
}

function network(value: unknown): { origin: string; methods: string[] }[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap(item => {
    if (!isRecord(item) || typeof item.origin !== 'string') return [];
    let origin: string;
    try { origin = new URL(item.origin).origin; } catch { return []; }
    const methods = strings(item.methods).map(method => method.toUpperCase());
    return [{ origin, methods: [...new Set(methods)].sort() }];
  });
  const unique = new Map(normalized.map(item => [`${item.origin}\0${item.methods.join(',')}`, item]));
  return [...unique.values()].sort((a, b) => a.origin.localeCompare(b.origin));
}

function processSpawn(value: unknown): ProcessSpawnGrant[] {
  if (!Array.isArray(value)) return [];
  const normalized = value.flatMap(item => {
    if (typeof item === 'string' && item.trim()) {
      return [{ executable: item.trim(), args: [], cwd: [], env: [] }];
    }
    if (!isRecord(item) || typeof item.executable !== 'string' || !item.executable.trim()) return [];
    return [{
      executable: item.executable.trim(),
      args: stringSequence(item.args),
      cwd: strings(item.cwd),
      env: strings(item.env),
    }];
  });
  const unique = new Map(normalized.map(item => [stableStringify(item), item]));
  return [...unique.values()].sort((a, b) => stableStringify(a).localeCompare(stableStringify(b)));
}

function eventSchemas(value: unknown): Record<string, EventContractDefinition> {
  if (!isRecord(value)) return {};
  const entries = Object.entries(value).flatMap(([event, definition]) => {
    if (!EVENT.test(event) || !isRecord(definition) || !isRecord(definition.payloadSchema)) return [];
    return [[event, {
      schemaVersion: definition.schemaVersion,
      semantic: definition.semantic,
      dataClassification: definition.dataClassification,
      payloadSchema: definition.payloadSchema,
    } as EventContractDefinition] as const];
  });
  return sortedRecord(Object.fromEntries(entries));
}

export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value as Record<string, unknown>)) deepFreeze(child);
  }
  return value;
}

export function validatePackageContract(packageJson: unknown): ContractValidation {
  const errors: string[] = [];
  if (!isRecord(packageJson)) return { ok: false, errors: ['package.json must be an object'] };
  if (typeof packageJson.name !== 'string' || !NAME.test(packageJson.name)) errors.push('package name must be a qualified lowercase identifier');
  if (packageJson.$ !== undefined) {
    if (packageJson.$ !== '*' && (!Array.isArray(packageJson.$) || packageJson.$.some(item => typeof item !== 'string' || !item.trim()))) {
      errors.push('$ must be "*" or an array of non-empty event names');
    } else if (Array.isArray(packageJson.$)) {
      for (const event of packageJson.$) {
        if (typeof event === 'string' && !LOCAL_EVENT_CALL.test(event) && !QUALIFIED_EVENT_CALL.test(event)) {
          errors.push(`$ event ${event} must use local action:name or package::action:name syntax`);
        }
      }
    }
  }
  const runtime = isRecord(packageJson.runtime) ? packageJson.runtime : {};
  if (runtime.contractVersion !== undefined && runtime.contractVersion !== PACKAGE_CONTRACT_VERSION) errors.push('runtime.contractVersion must be 1');
  if (runtime.mode !== undefined && !PACKAGE_MODES.includes(runtime.mode)) errors.push(`runtime.mode must be one of ${PACKAGE_MODES.join(', ')}`);
  if (runtime.isolated !== undefined) errors.push('runtime.isolated is deprecated; use top-level isolated');
  if (runtime.database !== undefined) errors.push('runtime.database is deprecated; use top-level database');
  if (packageJson.isolated !== undefined && typeof packageJson.isolated !== 'boolean') errors.push('isolated must be a boolean');
  if (packageJson.isolated === true && runtime.mode !== undefined && runtime.mode !== 'isolated') {
    errors.push('isolated: true requires runtime.mode to be omitted or "isolated"');
  }
  if (packageJson.database !== undefined && packageJson.database !== 'shared' && packageJson.database !== 'private') {
    errors.push('database must be "shared" or "private"');
  }
  if (packageJson.database === 'private' && packageJson.isolated !== true) {
    errors.push('database "private" requires isolated: true');
  }

  const strict = packageJson.isolated === true || runtime.mode === 'strict' || runtime.mode === 'isolated'
    || (runtime.contractVersion === 1 && runtime.mode === undefined);
  const provides = isRecord(runtime.provides) ? runtime.provides : {};
  const requires = isRecord(runtime.requires) ? runtime.requires : {};
  const declaredEventSchemas = isRecord(provides.eventSchemas) ? provides.eventSchemas : {};
  const permissions = isRecord(runtime.permissions) ? runtime.permissions : {};
  const toolPermissions = isRecord(permissions.tools) ? permissions.tools : {};
  const eventPermissions = isRecord(permissions.events) ? permissions.events : {};
  const dataPermissions = isRecord(permissions.data) ? permissions.data : {};

  if (packageJson.database === 'private' && dataPermissions.database !== undefined) {
    const requested = strings(dataPermissions.database);
    if (requested.length !== 1 || requested[0] !== 'self') {
      errors.push('database "private" only permits runtime.permissions.data.database: ["self"]');
    }
  }

  if (isRecord(requires.services)) for (const [service, requirement] of Object.entries(requires.services)) {
    if (!NAME.test(service)) errors.push(`required service ${service} must be a qualified lowercase identifier`);
    if (isRecord(requirement) && requirement.provider !== undefined && (typeof requirement.provider !== 'string' || !NAME.test(requirement.provider))) {
      errors.push(`required service ${service} provider must be a qualified lowercase identifier`);
    }
  }

  const lists: [string, unknown][] = [
    ['runtime.provides.tools', provides.tools], ['runtime.provides.events', provides.events],
    ['runtime.permissions.tools.invoke', toolPermissions.invoke],
    ['runtime.permissions.tools.exposeToAgents', toolPermissions.exposeToAgents],
    ['runtime.permissions.tools.administer', toolPermissions.administer],
    ['runtime.permissions.events.publish', eventPermissions.publish],
    ['runtime.permissions.events.subscribe', eventPermissions.subscribe],
    ['runtime.permissions.events.transform', eventPermissions.transform],
    ['runtime.permissions.events.veto', eventPermissions.veto],
    ['runtime.permissions.events.request', eventPermissions.request],
    ['runtime.permissions.data.database', dataPermissions.database],
    ['runtime.permissions.data.secrets', dataPermissions.secrets],
  ];
  for (const [path, list] of lists) {
    if (list !== undefined && (!Array.isArray(list) || list.some(item => typeof item !== 'string' || !item.trim()))) errors.push(`${path} must be an array of non-empty strings`);
    if (strict && Array.isArray(list) && list.some(item => typeof item === 'string' && item.includes('*'))) errors.push(`${path} cannot contain wildcards in strict contracts`);
  }

  if (strict && Array.isArray(provides.tools)) {
    for (const tool of provides.tools) {
      if (typeof tool === 'string' && packageJson.name && !tool.startsWith(`${packageJson.name}.`)) errors.push(`provided tool ${tool} must be qualified with ${packageJson.name}.`);
    }
  }
  for (const operation of ['publish', 'subscribe', 'transform', 'veto', 'request']) {
    const list = eventPermissions[operation];
    if (!Array.isArray(list)) continue;
    for (const event of list) {
      if (typeof event === 'string' && !EVENT.test(event)) {
        errors.push(`runtime.permissions.events.${operation} event ${event} must use namespace:action`);
      }
    }
  }
  if (strict) {
    for (const operation of ['publish', 'subscribe', 'transform', 'veto', 'request']) {
      const list = eventPermissions[operation];
      if (!Array.isArray(list)) continue;
      for (const event of list) {
        if (typeof event !== 'string') continue;
        const namespace = event.split(':', 1)[0];
        if (RESERVED_EVENT_NAMESPACES.has(namespace)) {
          errors.push(`runtime.permissions.events.${operation} cannot grant reserved event ${event} in a strict contract`);
        }
      }
    }
  }
  if (Array.isArray(provides.events)) for (const event of provides.events) if (typeof event === 'string' && !EVENT.test(event)) errors.push(`provided event ${event} must use namespace:action`);
  const providedEvents = new Set(strings(provides.events));
  const eventSemantics = new Set(['signal', 'pipeline', 'veto', 'request']);
  const classifications = new Set(['public', 'internal', 'confidential', 'restricted']);
  for (const [event, definition] of Object.entries(declaredEventSchemas)) {
    if (!EVENT.test(event)) errors.push(`event schema ${event} must use namespace:action`);
    if (!providedEvents.has(event)) errors.push(`event schema ${event} must correspond to runtime.provides.events`);
    if (!isRecord(definition)) { errors.push(`event schema ${event} must be an object`); continue; }
    if (!Number.isInteger(definition.schemaVersion) || definition.schemaVersion < 1) errors.push(`event schema ${event} requires a positive schemaVersion`);
    if (!eventSemantics.has(definition.semantic)) errors.push(`event schema ${event} has invalid semantic`);
    if (!classifications.has(definition.dataClassification)) errors.push(`event schema ${event} has invalid dataClassification`);
    if (!isRecord(definition.payloadSchema) || definition.payloadSchema.type !== 'object') errors.push(`event schema ${event} payloadSchema must be an object JSON schema`);
  }
  if (strict) {
    for (const event of providedEvents) {
      if (!event.startsWith(`${packageJson.name}:`)) errors.push(`provided event ${event} must use the package namespace ${packageJson.name}:`);
      if (!Object.prototype.hasOwnProperty.call(declaredEventSchemas, event)) errors.push(`provided event ${event} requires an event schema in a strict contract`);
    }
  }
  if (Array.isArray(dataPermissions.files)) for (const file of dataPermissions.files) {
    if (!isRecord(file) || typeof file.root !== 'string' || !['read', 'write', 'read-write'].includes(file.access)) errors.push('file grants require root and read, write, or read-write access');
    else if (file.root.startsWith('/') || file.root.split(/[\\/]+/).includes('..')) errors.push(`file root ${file.root} must be relative and cannot escape the package`);
  }
  if (Array.isArray(permissions.network)) for (const grant of permissions.network) {
    if (!isRecord(grant)) { errors.push('network grants must be objects'); continue; }
    try { if (new URL(grant.origin).origin !== grant.origin) errors.push(`network origin ${grant.origin} must contain only scheme and authority`); } catch { errors.push(`network origin ${grant.origin} is invalid`); }
    if (!Array.isArray(grant.methods) || grant.methods.some((method: unknown) => typeof method !== 'string' || !HTTP_METHODS.has(method.toUpperCase()))) errors.push(`network methods for ${grant.origin} are invalid`);
  }
  if (isRecord(permissions.process) && permissions.process.spawn !== undefined) {
    if (!Array.isArray(permissions.process.spawn)) errors.push('process spawn grants must be an array');
    else for (const grant of permissions.process.spawn) {
      if (typeof grant === 'string') {
        if (!grant.trim()) errors.push('process executable must be a non-empty string');
        continue;
      }
      if (!isRecord(grant) || typeof grant.executable !== 'string' || !grant.executable.trim()) {
        errors.push('process spawn grants require an executable');
        continue;
      }
      for (const field of ['args', 'cwd', 'env']) {
        if (grant[field] !== undefined && (!Array.isArray(grant[field]) || grant[field].some((item: unknown) => typeof item !== 'string' || !item.trim()))) {
          errors.push(`process spawn ${field} must be an array of non-empty strings`);
        }
      }
      if (Array.isArray(grant.cwd) && grant.cwd.some((root: unknown) => typeof root === 'string' && (root.startsWith('/') || root.split(/[\\/]+/).includes('..')))) {
        errors.push('process spawn cwd roots must be relative and cannot escape the package');
      }
    }
  }
  return { ok: errors.length === 0, errors };
}

export function normalizePackageContract(packageJson: any): EffectivePackageContract {
  const validation = validatePackageContract(packageJson);
  if (!validation.ok) throw new TypeError(`Invalid package contract:\n${validation.errors.join('\n')}`);
  const runtime = isRecord(packageJson.runtime) ? packageJson.runtime : {};
  const provides = isRecord(runtime.provides) ? runtime.provides : {};
  const requires = isRecord(runtime.requires) ? runtime.requires : {};
  const permissions = isRecord(runtime.permissions) ? runtime.permissions : {};
  const tools = isRecord(permissions.tools) ? permissions.tools : {};
  const events = isRecord(permissions.events) ? permissions.events : {};
  const data = isRecord(permissions.data) ? permissions.data : {};
  const processPermissions = isRecord(permissions.process) ? permissions.process : {};
  const declaredEventCalls = eventCalls(packageJson.$);
  const isolated = packageJson.isolated === true || runtime.mode === 'isolated';
  const databaseVisibility: DatabaseVisibility = packageJson.database === 'private' ? 'private' : 'shared';
  const contract: PackageContractV1 = {
    contractVersion: PACKAGE_CONTRACT_VERSION,
    package: { name: packageJson.name, version: typeof packageJson.version === 'string' ? packageJson.version : null },
    mode: isolated ? 'isolated' : (runtime.contractVersion === undefined ? 'legacy' : (runtime.mode ?? 'strict')),
    isolated,
    database: { visibility: databaseVisibility },
    eventCalls: declaredEventCalls,
    provides: {
      services: serviceVersions(provides.services),
      tools: strings(provides.tools),
      events: strings(provides.events),
      eventSchemas: eventSchemas(provides.eventSchemas),
    },
    requires: { services: serviceRequirements(requires.services) },
    permissions: {
      tools: { invoke: strings(tools.invoke), exposeToAgents: strings(tools.exposeToAgents), administer: strings(tools.administer) },
      events: {
        publish: strings(events.publish), subscribe: strings(events.subscribe), transform: strings(events.transform),
        veto: strings(events.veto), request: strings([
          ...strings(events.request),
          ...eventCallRequestGrants(packageJson.name, declaredEventCalls),
        ]),
      },
      data: {
        database: databaseVisibility === 'private' ? ['self'] : strings(data.database),
        files: files(data.files), secrets: strings(data.secrets),
      },
      network: network(permissions.network), process: { spawn: processSpawn(processPermissions.spawn) }, ui: strings(permissions.ui),
    },
  };
  deepFreeze(contract);
  return { contract, hash: createHash('sha256').update(stableStringify(contract)).digest('hex') };
}

function authorityEntries(contract: PackageContractV1): string[] {
  const entries: string[] = [];
  const add = (prefix: string, values: string[]) => values.forEach(value => entries.push(`${prefix}:${value}`));
  add('provides.tools', contract.provides.tools); add('provides.events', contract.provides.events);
  if (contract.isolated) entries.push('isolated:true');
  if (contract.database.visibility === 'private') entries.push('database:private');
  if (contract.eventCalls === '*') entries.push('eventCalls:*');
  else if (contract.eventCalls) add('eventCalls', contract.eventCalls);
  add('permissions.tools.invoke', contract.permissions.tools.invoke);
  add('permissions.tools.exposeToAgents', contract.permissions.tools.exposeToAgents);
  add('permissions.tools.administer', contract.permissions.tools.administer);
  for (const operation of ['publish', 'subscribe', 'transform', 'veto', 'request'] as const) {
    const values = operation === 'request' && contract.eventCalls !== null
      ? contract.permissions.events.request.filter(value => !eventCallRequestGrants(contract.package.name, contract.eventCalls).includes(value))
      : contract.permissions.events[operation];
    add(`permissions.events.${operation}`, values);
  }
  add('permissions.data.database', contract.permissions.data.database); add('permissions.data.secrets', contract.permissions.data.secrets);
  contract.permissions.process.spawn.forEach(grant => entries.push(`permissions.process.spawn:${stableStringify(grant)}`));
  add('permissions.ui', contract.permissions.ui);
  contract.permissions.data.files.forEach(grant => entries.push(`permissions.data.files:${grant.root}:${grant.access}`));
  contract.permissions.network.forEach(grant => grant.methods.forEach(method => entries.push(`permissions.network:${grant.origin}:${method}`)));
  return entries.sort();
}

export function diffPackageAuthority(before: PackageContractV1, after: PackageContractV1): AuthorityDiff {
  const left = new Set(authorityEntries(before));
  const right = new Set(authorityEntries(after));
  return {
    expanded: [...right].filter(item => !left.has(item)).sort(),
    reduced: [...left].filter(item => !right.has(item)).sort(),
    unchanged: [...left].filter(item => right.has(item)).sort(),
  };
}
