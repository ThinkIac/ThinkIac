import { describe, expect, it, vi } from 'vitest';
import { Container } from '../src/kernel/container';
import { normalizePackageContract } from '../src/kernel/package-contract';
import { runAsPackage } from '../src/kernel/authority-context';
import { callPackageEvent, requestPackageResponse } from '../src/kernel/package-event-calls';
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

  it('applies active call policy before prompting for a typed response delivery', async () => {
    const ws = makeWorkspace('logos-response-policy-');
    const prompt = vi.fn(() => 'package' as const);
    try {
      const approved = { name: 'agenda', $: ['agent::prompt:get'] };
      ws.pkg('agenda', { 'package.json': JSON.stringify({ ...approved, $: '*' }) });
      const container = new Container({ workspace: ws.root, eventGovernance: { enabled: true, prompt } });
      container.registry.setActiveContract('agenda', normalizePackageContract(approved));
      const isText = (value: unknown): value is string => typeof value === 'string';
      for (const event of ['agent::prompt:get', 'agent::prompt:private']) {
        container.bus.provide(event, { input: isText, output: isText }, text => text, { owner: 'agent' });
      }
      const call = (event: string) => runAsPackage(container.authority, 'agenda',
        () => requestPackageResponse(container, event, 'hello'));
      await expect(call('agent::prompt:private')).rejects.toMatchObject({ code: 'EVENT_PERMISSION_REQUIRED' });
      await expect(runAsPackage(container.authority, 'agenda', () =>
        container.bus.request('agent::prompt:private', 'hello'))).rejects.toMatchObject({ code: 'EVENT_PERMISSION_REQUIRED' });
      expect(prompt).not.toHaveBeenCalled();
      await expect(call('agent::prompt:get')).resolves.toBe('hello');
      expect(prompt).toHaveBeenCalledOnce();
      expect(prompt).toHaveBeenCalledWith(expect.objectContaining({
        source: 'agenda', target: 'agent', operation: 'request', event: 'agent::prompt:get',
      }));
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

it('limits explicit host grants to their sender, recipient and operation', async () => {
  const ws = makeWorkspace('logos-event-grants-');
  try {
    const container = new Container({ workspace: ws.root, eventGovernance: {
      enabled: true,
      grants: [{ source: 'source', target: 'target', operation: 'extension-before', event: '*' }],
    } });
    const permits = (changes: Partial<import('../src/kernel/event-governance').EventDeliveryRequest> = {}) =>
      container.eventGovernance.authorize(container.eventGovernance.createRequest({
        source: 'source', target: 'target', event: 'target::response:read',
        operation: 'extension-before', flowId: null, sourceIntegrity: 'test', payload: null, ...changes,
      }));
    expect(await permits()).toBe(true);
    expect(await permits({ event: 'target::response:other' })).toBe(true);
    expect(await permits({ operation: 'extension-transform' })).toBe(false);
    expect(await permits({ operation: 'request' })).toBe(false);
    expect(await permits({ target: 'another' })).toBe(false);
    expect(await permits({ source: 'another' })).toBe(false);
    expect(container.eventGovernance.list()).toEqual([]);
  } finally { ws.cleanup(); }
});

it('delivers only the hook phase granted by the host', async () => {
  const ws = makeWorkspace('logos-event-operations-');
  try {
    const event = 'provider::response:compose';
    const prompt = vi.fn(() => 'deny' as const);
    const container = new Container({ workspace: ws.root, eventGovernance: {
      enabled: true, prompt,
      grants: [{ source: 'provider', target: 'extension', operation: 'extension-before', event }],
    } });
    const isText = (value: unknown): value is string => typeof value === 'string';
    container.bus.provide(event, { input: isText, output: isText, extensions: ['before', 'transform'] },
      value => value, { owner: 'provider' });
    const observe = vi.fn();
    const transform = vi.fn(() => 'changed');
    container.bus.hook(event, 'before', observe, { owner: 'extension' });
    container.bus.hook(event, 'transform', transform, { owner: 'extension' });
    await expect(container.bus.request(event, 'original')).resolves.toBe('original');
    expect(observe).toHaveBeenCalledOnce();
    expect(transform).not.toHaveBeenCalled();
    expect(prompt).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({
      source: 'provider', target: 'extension', event, operation: 'extension-transform',
    }));
  } finally { ws.cleanup(); }
});
