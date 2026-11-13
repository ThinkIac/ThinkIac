import { describe, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { runAsPackage } from '../src/kernel/authority-context';
import { normalizePackageContract } from '../src/kernel/package-contract';
import { makeWorkspace } from './helpers';

function manifest() {
  return {
    name: 'pilot', version: '1.0.0',
    runtime: {
      contractVersion: 1, mode: 'strict',
      provides: {
        services: {}, tools: [], events: ['pilot:created'],
        eventSchemas: {
          'pilot:created': {
            schemaVersion: 1, semantic: 'signal', dataClassification: 'internal',
            payloadSchema: {
              type: 'object', properties: { id: { type: 'string' } }, required: ['id'], additionalProperties: false,
            },
          },
        },
      },
      requires: { services: {} },
      permissions: {
        tools: { invoke: [], exposeToAgents: [], administer: [] },
        events: { publish: ['pilot:created'], subscribe: [], transform: [], veto: [], request: [] },
        data: { database: [], files: [], secrets: [] }, network: [], process: { spawn: [] }, ui: [],
      },
    },
  };
}

describe('event contracts', () => {
  it('rejects an invalid payload before delivering a public event', async () => {
    const ws = makeWorkspace('logos-event-contract-');
    try {
      const packageJson = manifest();
      ws.pkg('pilot', { 'package.json': JSON.stringify(packageJson) });
      const container = new Container({ workspace: ws.root });
      const effective = normalizePackageContract(packageJson);
      container.eventContracts.replaceOwner('pilot', effective.contract.provides.eventSchemas);
      let calls = 0;
      container.bus.on('pilot:created', () => { calls += 1; }, { owner: 'system' });

      await expect(runAsPackage(container.authority, 'pilot', () =>
        container.bus.emit('pilot:created', { id: 42 }))).rejects.toMatchObject({ code: 'EVENT_SCHEMA_INVALID' });
      expect(calls).toBe(0);

      await runAsPackage(container.authority, 'pilot', () =>
        container.bus.emit('pilot:created', { id: 'evt-1' }));
      expect(calls).toBe(1);
    } finally { ws.cleanup(); }
  });
});
