import { describe, expect, it } from 'vitest';
import {
  diffPackageAuthority,
  normalizePackageContract,
  validatePackageContract,
} from '../src/kernel/package-contract';

const strictPackage = {
  name: 'agenda',
  version: '2.0.0',
  runtime: {
    contractVersion: 1,
    mode: 'strict',
    provides: {
      services: { 'agenda.calendar': '1.x' },
      tools: ['agenda.list', 'agenda.create', 'agenda.list'],
      events: ['agenda:event-created'],
      eventSchemas: {
        'agenda:event-created': {
          schemaVersion: 1,
          semantic: 'signal',
          dataClassification: 'internal',
          payloadSchema: {
            type: 'object',
            properties: { id: { type: 'string' } },
            required: ['id'],
            additionalProperties: false,
          },
        },
      },
    },
    requires: {
      services: {
        'notifications.push': { range: '1.x', optional: false, provider: 'ntfy' },
      },
    },
    permissions: {
      tools: { invoke: ['ntfy.send'], exposeToAgents: ['agenda.list'] },
      events: { publish: ['agenda:event-created'], subscribe: ['agenda:calendar-ready'] },
      data: { database: ['self'], files: [{ root: 'data', access: 'read-write' }], secrets: ['NTFY_TOPIC'] },
      network: [{ origin: 'https://ntfy.sh', methods: ['POST'] }],
      process: { spawn: [] },
      ui: ['view', 'menu'],
    },
  },
};

describe('package contract v1', () => {
  it('normalizes an explicit strict contract into stable effective configuration', () => {
    const first = normalizePackageContract(strictPackage);
    const reordered = normalizePackageContract({
      ...strictPackage,
      runtime: {
        ...strictPackage.runtime,
        provides: {
          ...strictPackage.runtime.provides,
          tools: ['agenda.create', 'agenda.list'],
        },
        permissions: {
          ...strictPackage.runtime.permissions,
          ui: ['menu', 'view'],
        },
      },
    });

    expect(first.contract).toEqual(reordered.contract);
    expect(first.hash).toBe(reordered.hash);
    expect(first.contract.provides.tools).toEqual(['agenda.create', 'agenda.list']);
    expect(first.contract.requires.services['notifications.push'].provider).toBe('ntfy');
    expect(Object.isFrozen(first.contract)).toBe(true);
  });

  it('keeps packages without contractVersion in legacy mode', () => {
    const effective = normalizePackageContract({ name: 'old-app', version: '1.0.0' });
    expect(effective.contract.mode).toBe('legacy');
    expect(effective.contract.contractVersion).toBe(1);
    expect(effective.contract.eventCalls).toBeNull();
  });

  it('normalizes the optional $ event-call declaration without enabling it for legacy packages by default', () => {
    const declared = normalizePackageContract({
      name: 'agenda', version: '1.0.0', $: ['agent::llm:call', 'task:created', 'agent::llm:call'],
    });
    const root = normalizePackageContract({ name: 'agent', version: '1.0.0', $: '*' });

    expect(declared.contract.eventCalls).toEqual(['agent::llm:call', 'task:created']);
    expect(root.contract.eventCalls).toBe('*');
  });

  it('rejects malformed optional $ declarations', () => {
    expect(validatePackageContract({ name: 'agenda', $: 'agent::llm:call' }).errors)
      .toContain('$ must be "*" or an array of non-empty event names');
    expect(validatePackageContract({ name: 'agenda', $: ['bad event'] }).errors)
      .toContain('$ event bad event must use local action:name or package::action:name syntax');
  });

  it('normalizes an isolated private database into an owner-only contract', () => {
    const effective = normalizePackageContract({
      name: 'wallet', version: '1.0.0',
      isolated: true, database: 'private',
    });

    expect(effective.contract.mode).toBe('isolated');
    expect(effective.contract.isolated).toBe(true);
    expect(effective.contract.database.visibility).toBe('private');
    expect(effective.contract.permissions.data.database).toEqual(['self']);
  });

  it('rejects private databases without a dedicated isolated runtime', () => {
    const result = validatePackageContract({
      name: 'wallet', database: 'private', runtime: { contractVersion: 1 },
    });
    expect(result.errors).toContain('database "private" requires isolated: true');
  });

  it('rejects contradictory isolated declarations and external database grants', () => {
    expect(validatePackageContract({
      name: 'wallet', isolated: true, runtime: { contractVersion: 1, mode: 'strict' },
    }).errors).toContain('isolated: true requires runtime.mode to be omitted or "isolated"');
    expect(validatePackageContract({
      name: 'wallet', isolated: true, database: 'private', runtime: {
        contractVersion: 1,
        permissions: { data: { database: ['other-package'] } },
      },
    }).errors).toContain('database "private" only permits runtime.permissions.data.database: ["self"]');
  });

  it('requires isolation declarations to live at the package.json top level', () => {
    const result = validatePackageContract({
      name: 'wallet',
      runtime: { contractVersion: 1, isolated: true, database: 'private' },
    });

    expect(result.errors).toContain('runtime.isolated is deprecated; use top-level isolated');
    expect(result.errors).toContain('runtime.database is deprecated; use top-level database');
  });

  it('rejects wildcards and unqualified provided tools in strict mode', () => {
    const invalid = structuredClone(strictPackage);
    invalid.runtime.provides.tools = ['create', '*'];
    const result = validatePackageContract(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors.join('\n')).toMatch(/qualified|wildcard/i);
  });

  it('rejects package-authored grants for reserved event namespaces in strict mode', () => {
    const invalid = structuredClone(strictPackage);
    invalid.runtime.permissions.events.subscribe = ['runtime:ready'];
    const result = validatePackageContract(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('runtime.permissions.events.subscribe cannot grant reserved event runtime:ready in a strict contract');
  });

  it('requires every public strict event to have a versioned payload schema', () => {
    const invalid = structuredClone(strictPackage);
    delete invalid.runtime.provides.eventSchemas['agenda:event-created'];
    const result = validatePackageContract(invalid);
    expect(result.ok).toBe(false);
    expect(result.errors).toContain('provided event agenda:event-created requires an event schema in a strict contract');
  });

  it('reports authority expansion separately from reduction', () => {
    const before = normalizePackageContract(strictPackage).contract;
    const changed = structuredClone(strictPackage);
    changed.runtime.permissions.tools.invoke.push('email.send');
    changed.runtime.permissions.events.subscribe = [];
    const after = normalizePackageContract(changed).contract;
    const diff = diffPackageAuthority(before, after);
    expect(diff.expanded).toContain('permissions.tools.invoke:email.send');
    expect(diff.reduced).toContain('permissions.events.subscribe:agenda:calendar-ready');
  });

  it('includes $ additions and root access in authority expansion diffs', () => {
    const before = normalizePackageContract({ name: 'agenda', version: '1.0.0', $: ['agent::llm:call'] }).contract;
    const expanded = normalizePackageContract({ name: 'agenda', version: '1.0.0', $: ['agent::llm:call', 'ntfy::notification:send'] }).contract;
    const root = normalizePackageContract({ name: 'agenda', version: '1.0.0', $: '*' }).contract;

    expect(diffPackageAuthority(before, expanded).expanded).toEqual(['eventCalls:ntfy::notification:send']);
    expect(diffPackageAuthority(expanded, root).expanded).toEqual(['eventCalls:*']);
  });

  it('normalizes process grants without changing argument order', () => {
    const input = structuredClone(strictPackage);
    input.runtime.permissions.process.spawn = [{
      executable: '/usr/bin/node', args: ['-e', '*'], cwd: ['data'], env: ['SAFE_VALUE'],
    }] as any;
    const contract = normalizePackageContract(input).contract;
    expect(contract.permissions.process.spawn).toEqual([{
      executable: '/usr/bin/node', args: ['-e', '*'], cwd: ['data'], env: ['SAFE_VALUE'],
    }]);
  });
});
