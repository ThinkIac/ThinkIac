import { describe, expect, it } from 'vitest';
import { AccessController, AuthorityDeniedError } from '../src/kernel/access-controller';
import {
  currentAuthority,
  runAsPackage,
  runAsSystem,
} from '../src/kernel/authority-context';
import { Container } from '../src/kernel/container';
import { PackageContext } from '../src/kernel/package-context';
import { loadMcpTools, toolToMcp, toolsModule } from '../src/modules/tools';
import { makeWorkspace } from './helpers';
import { createDb } from './db-module';

const db = createDb();

function manifest(name: string, mode: 'legacy' | 'observe' | 'warn' | 'strict' = 'observe') {
  return {
    name,
    version: '1.0.0',
    runtime: {
      contractVersion: 1,
      mode,
      provides: { services: {}, tools: [`${name}.own`], events: [] },
      requires: { services: {} },
      permissions: {
        tools: { invoke: ['target.allowed'], exposeToAgents: [], administer: [] },
        events: {
          publish: [`${name}:allowed`],
          subscribe: [`${name}:ready`],
          transform: [`${name}:transform`],
          veto: [`${name}:veto`],
          request: [`${name}:request`],
        },
        data: { database: ['self'], files: [], secrets: [] },
        network: [], process: { spawn: [] }, ui: [],
      },
    },
  };
}

describe('authority context', () => {
  it('uses an explicit system principal outside package execution', () => {
    expect(currentAuthority().principal).toEqual({ kind: 'system', id: 'system' });
  });

  it('propagates the package principal through async work and restores the parent', async () => {
    const access = new AccessController(() => null);
    await runAsPackage(access, 'agenda', async () => {
      await Promise.resolve();
      expect(currentAuthority().principal).toEqual({ kind: 'package', id: 'agenda' });
      await runAsSystem(access, async () => {
        expect(currentAuthority().principal).toEqual({ kind: 'system', id: 'system' });
      });
      expect(currentAuthority().principal).toEqual({ kind: 'package', id: 'agenda' });
    });
  });
});

describe('AccessController', () => {
  it('compiles declared grants and computes strict denials without enforcing them', () => {
    const access = new AccessController(name => name === 'agenda' ? manifest('agenda', 'strict') : null);
    const allowed = access.check({
      principal: { kind: 'package', id: 'agenda' },
      surface: 'events', operation: 'publish', resource: 'agenda:allowed',
    });
    const denied = access.check({
      principal: { kind: 'package', id: 'agenda' },
      surface: 'events', operation: 'publish', resource: 'agenda:undeclared',
    });

    expect(allowed).toMatchObject({ declared: true, allowed: true, mode: 'strict' });
    expect(denied).toMatchObject({ declared: false, allowed: false, mode: 'strict' });
    expect(access.report('agenda').violations).toHaveLength(1);
  });

  it('throws a typed denial for undeclared strict operations', () => {
    const access = new AccessController(name => name === 'agenda' ? manifest('agenda', 'strict') : null);
    expect(() => access.enforce({
      principal: { kind: 'package', id: 'agenda' },
      surface: 'events', operation: 'publish', resource: 'agenda:undeclared',
    })).toThrow(AuthorityDeniedError);
  });

  it('allows reserved namespaces only through explicit platform grants', () => {
    const access = new AccessController(
      name => name === 'agenda' ? manifest('agenda', 'strict') : null,
      () => undefined,
      10_000,
      name => name === 'agenda' ? { events: { subscribe: ['runtime:ready'] } } : null,
    );
    expect(access.enforce({
      principal: { kind: 'package', id: 'agenda' },
      surface: 'events', operation: 'subscribe', resource: 'runtime:ready',
    })).toMatchObject({ allowed: true, declared: true });
  });

  it('reports undeclared legacy/observe access without changing behavior', () => {
    const access = new AccessController(name => name === 'agenda' ? manifest('agenda', 'observe') : null);
    const decision = access.check({
      principal: { kind: 'package', id: 'agenda' },
      surface: 'tools', operation: 'invoke', resource: 'target.undeclared',
    });
    expect(decision).toMatchObject({ declared: false, allowed: true, mode: 'observe' });
    expect(access.report('agenda').violations[0]).toMatchObject({
      caller: 'agenda', surface: 'tools', operation: 'invoke', resource: 'target.undeclared',
    });
  });
});

describe('instrumented legacy surfaces', () => {
  it('denies strict event publication and subscription before handlers are changed or called', async () => {
    const ws = makeWorkspace('logos-authority-strict-events-');
    try {
      ws.pkg('strict-pkg', { 'package.json': JSON.stringify(manifest('strict-pkg', 'strict')) });
      const container = new Container({ workspace: ws.root });
      let calls = 0;
      container.bus.on('strict-pkg:blocked', () => { calls += 1; }, { owner: 'system' });

      await expect(runAsPackage(container.authority, 'strict-pkg', () =>
        container.bus.emit('strict-pkg:blocked'))).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
      expect(calls).toBe(0);

      expect(() => runAsPackage(container.authority, 'strict-pkg', () =>
        container.bus.on('other:event', () => undefined))).toThrow(AuthorityDeniedError);
      expect(container.bus.listeners('other:event')).toHaveLength(0);
    } finally {
      ws.cleanup();
    }
  });

  it('denies strict tool provide, invoke and agent exposure outside separate grants', async () => {
    const ws = makeWorkspace('logos-authority-strict-tools-');
    try {
      ws.pkg('caller', { 'package.json': JSON.stringify(manifest('caller', 'strict')) });
      const targetManifest = manifest('target', 'strict');
      targetManifest.runtime.provides.tools = ['target.allowed'];
      ws.pkg('target', { 'package.json': JSON.stringify(targetManifest) });
      ws.pkg('provider', { 'package.json': JSON.stringify(manifest('provider', 'strict')) });
      const container = new Container({ workspace: ws.root });

      expect(() => toolToMcp(container, { name: 'undeclared', call: () => 1 }, 'provider'))
        .toThrow(AuthorityDeniedError);

      const wrapped = toolToMcp(container, { name: 'allowed', call: () => 1 }, 'target');
      await expect(runAsPackage(container.authority, 'caller', () =>
        wrapped.handler({}))).resolves.toBe(1);

      const denied = toolToMcp(container, { name: 'own', call: () => 1 }, 'provider');
      await expect(runAsPackage(container.authority, 'caller', () => denied.handler({})))
        .rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    } finally {
      ws.cleanup();
    }
  });

  it('does not expose a strict provider tool to agents without an expose grant', async () => {
    const ws = makeWorkspace('logos-authority-tool-expose-');
    try {
      ws.pkg('provider', {
        'package.json': JSON.stringify(manifest('provider', 'strict')),
        'tools.js': '/** @register_tool own */\nexports.own = function own() { return 1; };',
      });
      const container = new Container({ workspace: ws.root });
      await expect(loadMcpTools(container, 'provider')).rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    } finally {
      ws.cleanup();
    }
  });
  it('attributes event publication to the caller and handler work to its owner', async () => {
    const ws = makeWorkspace('logos-authority-');
    try {
      ws.pkg('publisher', { 'package.json': JSON.stringify(manifest('publisher')) });
      ws.pkg('subscriber', { 'package.json': JSON.stringify(manifest('subscriber')) });
      const container = new Container({ workspace: ws.root });

      await runAsPackage(container.authority, 'subscriber', async () => {
        container.bus.on('topic:event', async () => {
          await container.bus.emit('subscriber:nested');
        });
      });
      await runAsPackage(container.authority, 'publisher', () => container.bus.emit('topic:event'));

      expect(container.authority.report('publisher').operations).toContainEqual(
        expect.objectContaining({ surface: 'events', operation: 'publish', resource: 'topic:event' }),
      );
      expect(container.authority.report('subscriber').operations).toEqual(expect.arrayContaining([
        expect.objectContaining({ operation: 'subscribe', resource: 'topic:event' }),
        expect.objectContaining({ operation: 'publish', resource: 'subscriber:nested' }),
      ]));
    } finally {
      ws.cleanup();
    }
  });

  it('attributes tool invocation to the caller and nested work to the provider', async () => {
    const ws = makeWorkspace('logos-authority-tools-');
    try {
      ws.pkg('caller', { 'package.json': JSON.stringify(manifest('caller')) });
      ws.pkg('provider', { 'package.json': JSON.stringify(manifest('provider')) });
      const container = new Container({ workspace: ws.root });
      const tool = toolToMcp(container, {
        name: 'own',
        call: async () => container.bus.emit('provider:nested'),
      }, 'provider');

      await runAsPackage(container.authority, 'caller', () => tool.handler({}));

      expect(container.authority.report('caller').operations).toContainEqual(
        expect.objectContaining({ surface: 'tools', operation: 'invoke', resource: 'provider.own' }),
      );
      expect(container.authority.report('provider').operations).toContainEqual(
        expect.objectContaining({ surface: 'events', operation: 'publish', resource: 'provider:nested' }),
      );
    } finally {
      ws.cleanup();
    }
  });

  it('attributes database proxy access without opening the database', () => {
    const ws = makeWorkspace('logos-authority-db-');
    try {
      ws.pkg('agenda', { 'package.json': JSON.stringify(manifest('agenda')) });
      const container = new Container({ workspace: ws.root });
      runAsPackage(container.authority, 'agenda', () => db.getProxy('other-package'));
      expect(container.authority.report('agenda').violations).toContainEqual(
        expect.objectContaining({ surface: 'database', operation: 'access', resource: 'other-package' }),
      );
    } finally {
      ws.cleanup();
    }
  });

  it('denies every external package proxy access to a private database, even for legacy callers', () => {
    const ws = makeWorkspace('logos-authority-private-db-');
    try {
      ws.pkg('wallet', {
        'package.json': JSON.stringify({
          name: 'wallet', version: '1.0.0',
          isolated: true, database: 'private',
          runtime: { contractVersion: 1 },
        }),
      });
      ws.pkg('reader', { 'package.json': JSON.stringify(manifest('reader', 'legacy')) });
      const container = new Container({ workspace: ws.root });

      expect(() => runAsPackage(container.authority, 'reader', () => db.getProxy('wallet')))
        .toThrowError(expect.objectContaining({ code: 'AUTHORITY_DENIED' }));
      expect(() => runAsPackage(container.authority, 'wallet', () => db.getProxy('wallet'))).not.toThrow();
      expect(container.authority.report('reader').violations).toContainEqual(
        expect.objectContaining({ surface: 'database', operation: 'access', resource: 'wallet' }),
      );
    } finally {
      ws.cleanup();
    }
  });
});

describe('PackageContext', () => {
  it('binds owner and principal instead of trusting package-supplied identity', async () => {
    const ws = makeWorkspace('logos-package-context-');
    try {
      ws.pkg('agenda', { 'package.json': JSON.stringify(manifest('agenda')) });
      const container = new Container({ workspace: ws.root });
      const context = new PackageContext(container, 'agenda');
      let principal: any;
      context.events.subscribe('runtime:ready', () => {
        principal = currentAuthority().principal;
      });
      await runAsSystem(container.authority, () => container.bus.emit('runtime:ready'));
      expect(principal).toEqual({ kind: 'package', id: 'agenda' });
      expect(container.bus.listeners('runtime:ready')[0].owner).toBe('agenda');
    } finally {
      ws.cleanup();
    }
  });

  it('preserves the caller through the system tool bridge', async () => {
    const ws = makeWorkspace('logos-package-context-tool-');
    try {
      ws.pkg('caller', { 'package.json': JSON.stringify(manifest('caller')) });
      ws.pkg('provider', {
        'package.json': JSON.stringify(manifest('provider')),
        'tools.js': [
          '/** @register_tool own */',
          'exports.own = function own(args) { return args.value; };',
        ].join('\n'),
      });
      const container = new Container({ workspace: ws.root });
      toolsModule.install(container);
      const context = new PackageContext(container, 'caller');

      expect(await context.tools.invoke('provider.own', { value: 9 })).toBe(9);
      expect(container.authority.report('caller').operations).toContainEqual(
        expect.objectContaining({ surface: 'tools', operation: 'invoke', resource: 'provider.own' }),
      );
    } finally {
      ws.cleanup();
    }
  });
});
