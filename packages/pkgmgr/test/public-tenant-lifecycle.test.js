import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createEnvironmentStore } from '../environment.js';
import { createEnvironmentOperations } from '../environment-operations.js';
import { createOperationalHealthcheck } from '../health.js';
import { createPackageRuntime } from '../runtime.js';
import { createPublicTenantLifecycle } from '../public-tenant-lifecycle.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-public-tenant-'));
  const runtime = createPackageRuntime({ root: join(root, 'runtime') });
  runtime.initialize();
  const environments = createEnvironmentStore({ root, idFactory: () => 'env_public_1' });
  const calls = [];
  const operations = createEnvironmentOperations({ root, store: environments, driver: {
    provision: async input => calls.push(['provision', input]),
    start: async input => calls.push(['start', input]),
    remove: async input => calls.push(['remove', input]),
  } });
  const health = createOperationalHealthcheck({ environments, runtime, driver: { health: async () => ({ ok: true }) } });
  return { root, runtime, environments, operations, health, calls };
}

function source(root, name = 'tasks', version = '1.0.0') {
  const directory = join(root, `${name}-${version}`);
  mkdirSync(directory);
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name, version }));
  return directory;
}

const integrity = 'sha512-YQ==';
const contract = { packageName: 'tasks', version: '1.0.0', integrity, channel: 'stable' };

test('creates a first public tenant end-to-end from only stable, compatible releases', async () => {
  const subject = fixture();
  try {
    const packageSource = source(subject.root);
    const lifecycle = createPublicTenantLifecycle({ ...subject, root: subject.root });
    const request = {
      tenantId: 'tenant_public_1', domain: 'first.example.test', idempotencyKey: 'signup-1', runtimeVersion: '1.0.0',
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'registry', integrity } } },
      resolveRelease: () => ({ ...contract, source: packageSource }),
    };
    const created = await lifecycle.create(request);
    assert.equal(created.status, 'succeeded');
    assert.equal(subject.environments.get(created.environmentId).state, 'running');
    assert.equal(subject.runtime.readLockfile().packages.tasks.version, '1.0.0');
    assert.equal(created.health.status, 'healthy');
    assert.deepEqual(subject.calls.map(([name]) => name), ['provision', 'start']);

    const repeated = await lifecycle.create({ ...request, resolveRelease: () => { throw new Error('must be idempotent'); } });
    assert.equal(repeated.id, created.id);
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});

test('rejects a release for another channel before provisioning anything', async () => {
  const subject = fixture();
  try {
    const lifecycle = createPublicTenantLifecycle({ ...subject, root: subject.root });
    await assert.rejects(lifecycle.create({
      tenantId: 'tenant_public_1', environmentId: 'env_public_1', idempotencyKey: 'signup-1', runtimeVersion: '1.0.0',
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'registry', integrity } } },
      resolveRelease: () => ({ ...contract, channel: 'canary', source: source(subject.root) }),
    }), /not eligible/);
    assert.deepEqual(subject.environments.list(), []);
    assert.deepEqual(subject.calls, []);
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});

test('tears down a newly created public tenant when post-start health is degraded', async () => {
  const subject = fixture();
  try {
    const unhealthy = { check: async () => ({ status: 'degraded', ok: false }) };
    const lifecycle = createPublicTenantLifecycle({ ...subject, root: subject.root, health: unhealthy });
    await assert.rejects(lifecycle.create({
      tenantId: 'tenant_public_1', environmentId: 'env_public_1', idempotencyKey: 'signup-1', runtimeVersion: '1.0.0',
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'registry', integrity } } },
      resolveRelease: () => ({ ...contract, source: source(subject.root) }),
    }), /health check failed/);
    assert.equal(subject.environments.get('env_public_1').state, 'deleted');
    assert.deepEqual(subject.calls.map(([name]) => name), ['provision', 'start', 'remove']);
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});

test('rejects an integrity mismatch before creating an Environment', async () => {
  const subject = fixture();
  try {
    const lifecycle = createPublicTenantLifecycle({ ...subject, root: subject.root });
    await assert.rejects(lifecycle.create({
      tenantId: 'tenant_public_1', idempotencyKey: 'signup-1', runtimeVersion: '1.0.0',
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'registry', integrity } } },
      resolveRelease: () => ({ ...contract, integrity: 'sha512-Yg==', source: source(subject.root) }),
    }), /integrity does not match/);
    assert.deepEqual(subject.environments.list(), []);
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});
