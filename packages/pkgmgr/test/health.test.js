import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createEnvironmentStore } from '../environment.js';
import { createPackageRuntime } from '../runtime.js';
import { createOperationalHealthcheck } from '../health.js';

test('composite health reports lifecycle, runtime, materialization, and driver checks', async () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-health-'));
  try {
    const environments = createEnvironmentStore({ root, idFactory: () => 'env_1' });
    environments.create({ tenantId: 'tenant_1' });
    for (const state of ['provisioning', 'ready', 'starting', 'running']) environments.transition('env_1', state);
    const runtime = createPackageRuntime({ root: join(root, 'runtime') });
    runtime.initialize();
    const source = join(root, 'source-tasks');
    mkdirSync(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'tasks', version: '1.0.0' }));
    runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'store' } } });
    runtime.reconcile({ resolveRelease: () => ({ source }) });

    const health = createOperationalHealthcheck({
      environments,
      runtime,
      driver: { health: async () => ({ ok: true, capacity: 'available' }) },
    });
    const result = await health.check({ environmentId: 'env_1' });
    assert.equal(result.ok, true);
    assert.deepEqual(result.checks.map(check => check.name), ['environment', 'runtime-lockfile', 'active-releases', 'driver']);
    assert.equal(result.environment.state, 'running');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('composite health is degraded when an active release or driver is unhealthy', async () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-health-'));
  try {
    const environments = createEnvironmentStore({ root, idFactory: () => 'env_1' });
    environments.create({ tenantId: 'tenant_1' });
    const runtime = createPackageRuntime({ root: join(root, 'runtime') });
    runtime.initialize();
    runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {} });
    const health = createOperationalHealthcheck({ environments, runtime, driver: { health: async () => ({ ok: false, reason: 'host unavailable' }) } });
    const result = await health.check({ environmentId: 'env_1' });
    assert.equal(result.ok, false);
    assert.equal(result.status, 'degraded');
    assert.equal(result.checks.at(-1).detail.reason, 'host unavailable');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
