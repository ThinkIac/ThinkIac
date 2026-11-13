import { describe, expect, it } from 'vitest';
import { Container } from '../src/kernel/container';
import { validatePackageWiring } from '../src/kernel/package-wiring';
import { makeWorkspace } from './helpers';

function strictManifest(name: string, tools: string[] = [], transforms: string[] = []) {
  return {
    name, version: '1.0.0',
    runtime: {
      contractVersion: 1, mode: 'strict',
      provides: { services: {}, tools, events: [] }, requires: { services: {} },
      permissions: {
        tools: { invoke: [], exposeToAgents: [], administer: [] },
        events: { publish: [], subscribe: [], transform: transforms, veto: [], request: [] },
        data: { database: [], files: [], secrets: [] }, network: [], process: { spawn: [] }, ui: [],
      },
    },
  };
}

describe('package wiring preflight', () => {
  it('rejects a discovered tool missing from strict provides before wiring', async () => {
    const ws = makeWorkspace('logos-wiring-contract-');
    try {
      ws.pkg('pilot', {
        'package.json': JSON.stringify(strictManifest('pilot')),
        'tools.js': '/** @register_tool hidden */\nexports.hidden = function hidden() { return 1; };',
      });
      const container = new Container({ workspace: ws.root });
      await expect(validatePackageWiring(container, container.registry.getPackage('pilot')))
        .rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    } finally { ws.cleanup(); }
  });

  it('rejects a transforming hook missing from the strict transform grant', async () => {
    const ws = makeWorkspace('logos-wiring-hook-contract-');
    try {
      ws.pkg('pilot', {
        'package.json': JSON.stringify(strictManifest('pilot')),
        'hooks.js': '/** @register_hook pilot:change */\nexports.change = function change(value) { return value; };',
      });
      const container = new Container({ workspace: ws.root });
      await expect(validatePackageWiring(container, container.registry.getPackage('pilot')))
        .rejects.toMatchObject({ code: 'AUTHORITY_DENIED' });
    } finally { ws.cleanup(); }
  });
});
