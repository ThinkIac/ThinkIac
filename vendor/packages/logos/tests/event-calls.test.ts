import { describe, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { normalizePackageContract } from '../src/kernel/package-contract';
import { runAsPackage } from '../src/kernel/authority-context';
import { callPackageEvent } from '../src/kernel/package-event-calls';
import { makeWorkspace } from './helpers';
import { emitPackageDeclarations } from '../src/kernel/declaration-events';
import type { ResourceReference } from '../src/kernel/resource-identity';

describe('optional package $ event-call policy', () => {
  it('preserves legacy event names and behavior when $ is absent', async () => {
    const ws = makeWorkspace('logos-event-calls-legacy-');
    try {
      ws.pkg('legacy', { 'package.json': JSON.stringify({ name: 'legacy', version: '1.0.0' }) });
      const container = new Container({ workspace: ws.root });
      container.bus.on('plain:event', payload => ({ ...payload, handled: true }), { owner: 'system' });

      await expect(runAsPackage(container.authority, 'legacy', () =>
        callPackageEvent(container, 'plain:event', { handled: false })))
        .resolves.toEqual({ handled: true });
    } finally { ws.cleanup(); }
  });

  it('normalizes local calls and blocks undeclared external calls when $ is present', async () => {
    const ws = makeWorkspace('logos-event-calls-opt-in-');
    try {
      const manifest = { name: 'agenda', version: '1.0.0', $: ['agent::llm:call'] };
      ws.pkg('agenda-folder', { 'package.json': JSON.stringify(manifest) });
      const container = new Container({ workspace: ws.root });
      container.registry.setActiveContract('agenda-folder', normalizePackageContract(manifest));
      container.bus.on('agenda::task:created', payload => ({ ...payload, local: true }), { owner: 'system' });
      container.bus.on('agent::llm:call', payload => ({ ...payload, external: true }), { owner: 'system' });

      await expect(runAsPackage(container.authority, 'agenda-folder', () =>
        callPackageEvent(container, 'task:created', {}))).resolves.toEqual({ local: true });
      await expect(runAsPackage(container.authority, 'agenda-folder', () =>
        callPackageEvent(container, 'agent::llm:call', {}))).resolves.toEqual({ external: true });
      await expect(runAsPackage(container.authority, 'agenda-folder', () =>
        callPackageEvent(container, 'ntfy::notification:send', {}))).rejects.toMatchObject({
          code: 'EVENT_PERMISSION_REQUIRED', package: 'agenda', event: 'ntfy::notification:send',
        });
    } finally { ws.cleanup(); }
  });

  it('uses the approved active contract instead of a modified package.json', async () => {
    const ws = makeWorkspace('logos-event-calls-active-contract-');
    try {
      const approved = { name: 'agenda', version: '1.0.0', $: ['agent::llm:call'] };
      ws.pkg('agenda', { 'package.json': JSON.stringify({ ...approved, $: ['agent::llm:call', 'ntfy::notification:send'] }) });
      const container = new Container({ workspace: ws.root });
      container.registry.setActiveContract('agenda', normalizePackageContract(approved));

      await expect(runAsPackage(container.authority, 'agenda', () =>
        callPackageEvent(container, 'ntfy::notification:send', {}))).rejects.toMatchObject({ code: 'EVENT_PERMISSION_REQUIRED' });
    } finally { ws.cleanup(); }
  });

  it('allows any external call for an approved $ root contract', async () => {
    const ws = makeWorkspace('logos-event-calls-root-');
    try {
      const manifest = { name: 'agent', version: '1.0.0', $: '*' };
      ws.pkg('agent', { 'package.json': JSON.stringify(manifest) });
      const container = new Container({ workspace: ws.root });
      container.registry.setActiveContract('agent', normalizePackageContract(manifest));
      container.bus.on('anything::can:run', () => ({ ok: true }), { owner: 'system' });

      await expect(runAsPackage(container.authority, 'agent', () =>
        callPackageEvent(container, 'anything::can:run', {}))).resolves.toEqual({ ok: true });
    } finally { ws.cleanup(); }
  });

  it('composes with strict authority instead of bypassing it', async () => {
    const ws = makeWorkspace('logos-event-calls-strict-');
    try {
      const manifest = {
        name: 'agenda', version: '1.0.0', $: ['agent::llm:call'],
        runtime: { contractVersion: 1, mode: 'strict' },
      };
      ws.pkg('agenda', { 'package.json': JSON.stringify(manifest) });
      const container = new Container({ workspace: ws.root });
      container.registry.setActiveContract('agenda', normalizePackageContract(manifest));
      container.bus.on('agent::llm:call', () => ({ ok: true }), { owner: 'system' });

      await expect(runAsPackage(container.authority, 'agenda', () =>
        callPackageEvent(container, 'agent::llm:call', {}))).resolves.toEqual({ ok: true });
      expect(container.authority.report('agenda').operations).toContainEqual(expect.objectContaining({
        surface: 'events', operation: 'request', resource: 'agent::llm:call', allowed: true,
      }));
    } finally { ws.cleanup(); }
  });
});

describe('canonical resource resolution', () => {
  it.each([undefined, []])('scopes abbreviated names to the manifest package with $ = %j', async policy => {
    const ws = makeWorkspace('logos-resource-resolution-');
    const container = new Container({ workspace: ws.root });
    const source = (kind: string, name: string) =>
      `exports.handler = function handler() { /**\n * @register ${kind} ${name}\n */ return 1; };`;
    try {
      const manifest = { name: 'agenda', $: policy };
      ws.pkg('agenda-folder', {
        'package.json': JSON.stringify(manifest),
        'one.js': source('task', 'open'),
        'nested/two.js': source('query', 'open'),
      });
      ws.pkg('remote-folder', {
        'package.json': '{"name":"remote"}',
        'one.js': source('task', 'remoteOnly'),
      });
      container.registry.setActiveContract('agenda-folder', normalizePackageContract(manifest));
      container.bus.on('register:task', () => {});
      container.bus.on('register:query', () => {});
      await emitPackageDeclarations(container, { folder: 'agenda-folder' });
      await emitPackageDeclarations(container, { folder: 'remote-folder' });

      const resolve = (reference: ResourceReference) => container.resolveResource('agenda-folder', reference);
      expect(resolve({ kind: 'query', name: 'open' })).toEqual({ package: 'agenda', kind: 'query', name: 'open' });
      expect(resolve({ package: 'remote', kind: 'task', name: 'remoteOnly' })).toEqual({
        package: 'remote', kind: 'task', name: 'remoteOnly',
      });
      expect(() => resolve({ name: 'open' })).toThrow(expect.objectContaining({ code: 'RESOURCE_AMBIGUOUS' }));
      expect(() => resolve({ name: 'remoteOnly' })).toThrow(expect.objectContaining({ code: 'RESOURCE_NOT_FOUND' }));

      await expect(container.resourceTransactions.prepare('agenda-folder', [
        { declaration: { type: 'query', name: 'open' }, file: 'first.js' },
        { declaration: { type: 'query', name: 'open' }, file: 'second.js' },
      ])).rejects.toMatchObject({ code: 'RESOURCE_COLLISION' });
      expect(resolve({ kind: 'query', name: 'open' }).package).toBe('agenda');
    } finally {
      await container.resourceTransactions.close();
      ws.cleanup();
    }
  });
});
