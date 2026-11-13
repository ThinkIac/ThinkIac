import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { Container } from '../src/kernel/container';
import { normalizePackageContract } from '../src/kernel/package-contract';
import { stagePackage } from '../src/stabilizer/staging';
import { makeWorkspace } from './helpers';

function pkg(name: string, invoke: string[] = []) {
  return {
    name,
    version: '1.0.0',
    runtime: {
      contractVersion: 1,
      mode: 'strict',
      provides: { services: {}, tools: [], events: [] },
      requires: { services: {} },
      permissions: {
        tools: { invoke, exposeToAgents: [], administer: [] },
        events: { publish: [], subscribe: [], transform: [], veto: [], request: [] },
        data: { database: [], files: [], secrets: [] },
        network: [], process: { spawn: [] }, ui: [],
      },
    },
  };
}

describe('stabilizer authority diff', () => {
  it('blocks an authority expansion until an exact hash-bound decision is recorded', async () => {
    const ws = makeWorkspace('logos-staging-authority-');
    try {
      const beforeManifest = pkg('pilot');
      ws.pkg('pilot', { 'package.json': JSON.stringify(beforeManifest) });
      const container = new Container({ workspace: ws.root });
      container.app = express();
      container.registry.setActiveContract('pilot', normalizePackageContract(beforeManifest));

      const afterManifest = pkg('pilot', ['target.new']);
      fs.writeFileSync(path.join(ws.root, 'pilot', 'package.json'), JSON.stringify(afterManifest));

      const denied = await stagePackage(container, 'pilot');
      expect(denied.ok).toBe(false);
      expect(denied.checks).toContainEqual(expect.objectContaining({ name: 'authority:expansion', ok: false }));

      const before = normalizePackageContract(beforeManifest);
      const after = normalizePackageContract(afterManifest);
      container.authority.approveExpansion({
        decisionId: 'decision-1', package: 'pilot', beforeHash: before.hash, afterHash: after.hash,
        expanded: ['permissions.tools.invoke:target.new'],
      });
      const accepted = await stagePackage(container, 'pilot');
      expect(accepted.ok).toBe(true);
      expect(container.registry.getActiveContract('pilot')?.hash).toBe(after.hash);
    } finally {
      ws.cleanup();
    }
  });

  it('treats an added $ event as an approval-gated authority expansion', async () => {
    const ws = makeWorkspace('logos-staging-event-calls-');
    try {
      const beforeManifest = { name: 'pilot', version: '1.0.0', $: ['agent::llm:call'] };
      ws.pkg('pilot', { 'package.json': JSON.stringify(beforeManifest) });
      const container = new Container({ workspace: ws.root });
      container.app = express();
      container.registry.setActiveContract('pilot', normalizePackageContract(beforeManifest));

      const afterManifest = { ...beforeManifest, $: ['agent::llm:call', 'ntfy::notification:send'] };
      fs.writeFileSync(path.join(ws.root, 'pilot', 'package.json'), JSON.stringify(afterManifest));

      const denied = await stagePackage(container, 'pilot');
      expect(denied.ok).toBe(false);
      expect(denied.checks).toContainEqual(expect.objectContaining({ name: 'authority:expansion', ok: false }));
    } finally { ws.cleanup(); }
  });
});
