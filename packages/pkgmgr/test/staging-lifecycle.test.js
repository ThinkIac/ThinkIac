import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createEnvironmentStore } from '../environment.js';
import { createEnvironmentOperations } from '../environment-operations.js';
import { createPackageRuntime } from '../runtime.js';
import { createStagingLifecycle } from '../staging-lifecycle.js';

function packageSource(root, name, version) {
  const source = join(root, `${name}-${version}`);
  mkdirSync(source);
  writeFileSync(join(source, 'package.json'), JSON.stringify({ name, version }));
  return source;
}

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-staging-lifecycle-'));
  const runtime = createPackageRuntime({ root: join(root, 'runtime') });
  runtime.initialize();
  const environments = createEnvironmentStore({ root, idFactory: () => 'staging_1' });
  const calls = [];
  const operations = createEnvironmentOperations({
    root,
    store: environments,
    driver: {
      provision: async input => calls.push(['provision', input]),
      start: async input => calls.push(['start', input]),
      remove: async input => calls.push(['remove', input]),
    },
  });
  return { root, runtime, environments, operations, calls, lifecycle: createStagingLifecycle({ root, runtime, environments, operations }) };
}

test('migrates an isolated staging tenant durably and restores its prior release on rollback', async () => {
  const subject = fixture();
  try {
    const v1 = packageSource(subject.root, 'tasks', '1.0.0');
    const v2 = packageSource(subject.root, 'tasks', '1.1.0');
    subject.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {
      tasks: { version: '1.0.0', source: 'legacy' },
    } });
    subject.runtime.reconcile({ resolveRelease: () => ({ source: v1 }) });

    const migrated = await subject.lifecycle.migrate({
      environment: { id: 'staging_1', tenantId: 'tenant_staging', domain: 'staging.example.test' },
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.1.0', source: 'store' } } },
      idempotencyKey: 'staging-migration-1',
      resolveRelease: ({ version }) => ({ source: version === '1.1.0' ? v2 : v1 }),
    });

    assert.equal(migrated.status, 'succeeded');
    assert.equal(subject.environments.get('staging_1').state, 'running');
    assert.equal(subject.runtime.readLockfile().packages.tasks.version, '1.1.0');
    assert.deepEqual(subject.calls.map(([name]) => name), ['provision', 'start']);

    const repeated = await subject.lifecycle.migrate({
      environment: { id: 'staging_1', tenantId: 'tenant_staging' },
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.1.0', source: 'store' } } },
      idempotencyKey: 'staging-migration-1',
      resolveRelease: () => { throw new Error('completed migrations must not execute twice'); },
    });
    assert.equal(repeated.id, migrated.id);

    const rolledBack = subject.lifecycle.rollback({
      migrationId: migrated.id,
      resolveRelease: ({ version }) => ({ source: version === '1.0.0' ? v1 : v2 }),
    });
    assert.equal(rolledBack.status, 'rolled_back');
    assert.equal(subject.runtime.readLockfile().packages.tasks.version, '1.0.0');
    assert.equal(subject.lifecycle.get(migrated.id).status, 'rolled_back');
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('resets staging through the official teardown operation and leaves no applied package state', async () => {
  const subject = fixture();
  try {
    const source = packageSource(subject.root, 'tasks', '1.0.0');
    await subject.lifecycle.migrate({
      environment: { id: 'staging_1', tenantId: 'tenant_staging' },
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'store' } } },
      idempotencyKey: 'staging-migration-1',
      resolveRelease: () => ({ source }),
    });

    const reset = await subject.lifecycle.reset({ environmentId: 'staging_1', idempotencyKey: 'staging-reset-1', purge: true });
    assert.equal(reset.status, 'succeeded');
    assert.equal(subject.environments.get('staging_1').state, 'deleted');
    assert.deepEqual(subject.runtime.readManifest().packages, {});
    assert.deepEqual(subject.runtime.readLockfile().packages, {});
    assert.equal(existsSync(join(subject.runtime.paths.active, 'tasks')), false);
    assert.equal(subject.calls.find(([name]) => name === 'remove')[1].purge, true);

    const repeated = await subject.lifecycle.reset({ environmentId: 'staging_1', idempotencyKey: 'staging-reset-1', purge: true });
    assert.equal(repeated.id, reset.id);
    assert.equal(subject.calls.filter(([name]) => name === 'remove').length, 1);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('retries a failed staging reset through the same durable teardown request', async () => {
  const subject = fixture();
  try {
    const source = packageSource(subject.root, 'tasks', '1.0.0');
    await subject.lifecycle.migrate({
      environment: { id: 'staging_1', tenantId: 'tenant_staging' },
      manifest: { schemaVersion: 1, runtimeChannel: 'stable', packages: { tasks: { version: '1.0.0', source: 'store' } } },
      idempotencyKey: 'staging-migration-1',
      resolveRelease: () => ({ source }),
    });
    let interrupted = true;
    subject.operations.driver.remove = async input => {
      subject.calls.push(['remove', input]);
      if (interrupted) { interrupted = false; throw new Error('temporary driver failure'); }
    };

    await assert.rejects(subject.lifecycle.reset({ environmentId: 'staging_1', idempotencyKey: 'staging-reset-1' }), /temporary driver failure/);
    const resumed = await subject.lifecycle.reset({ environmentId: 'staging_1', idempotencyKey: 'staging-reset-1' });
    assert.equal(resumed.status, 'succeeded');
    assert.equal(subject.environments.get('staging_1').state, 'deleted');
    assert.equal(subject.calls.filter(([name]) => name === 'remove').length, 2);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});
