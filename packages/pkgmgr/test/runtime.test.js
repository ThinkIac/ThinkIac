import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, lstatSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createPackageRuntime } from '../runtime.js';

function makeRuntime() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-runtime-'));
  return {
    root,
    runtime: createPackageRuntime({ root }),
    cleanup() { rmSync(root, { recursive: true, force: true }); },
  };
}

test('initializes the durable runtime layout without treating intent as applied state', () => {
  const fixture = makeRuntime();
  try {
    const state = fixture.runtime.initialize();

    assert.deepEqual(state.manifest, { schemaVersion: 1, runtimeChannel: 'stable', packages: {} });
    assert.equal(state.lockfile.schemaVersion, 1);
    assert.equal(state.lockfile.generation, 0);
    assert.deepEqual(state.lockfile.packages, {});
    assert.match(state.lockfile.fingerprint, /^sha256:[a-f0-9]{64}$/);
    for (const name of ['transactions', 'releases', 'active', 'rollback', 'state']) {
      assert.ok(existsSync(join(fixture.root, name)), `${name} must exist`);
    }
  } finally {
    fixture.cleanup();
  }
});

test('records an install transaction before copying a staged release and promotes only after staging is complete', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const source = join(fixture.root, 'source-terminal');
    fixture.runtime.makeDirectory(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'terminal', version: '1.2.0' }));

    const transaction = fixture.runtime.beginTransaction({ operation: 'install', packageName: 'terminal', version: '1.2.0' });
    const staged = fixture.runtime.stageRelease(transaction.id, source);

    assert.equal(fixture.runtime.readLockfile().generation, 0);
    assert.ok(existsSync(join(staged, 'package.json')));
    assert.equal(fixture.runtime.readTransaction(transaction.id).state, 'staged');

    const result = fixture.runtime.promoteRelease(transaction.id, { checksum: 'sha256:abc' });
    assert.equal(result.packageName, 'terminal');
    assert.equal(fixture.runtime.readTransaction(transaction.id).state, 'promoted');
    assert.ok(existsSync(join(fixture.root, 'releases', 'terminal', '1.2.0', 'package.json')));
    assert.ok(lstatSync(join(fixture.root, 'active', 'terminal')).isSymbolicLink());
    assert.equal(fixture.runtime.readLockfile().packages.terminal.version, '1.2.0');
    assert.equal(fixture.runtime.readLockfile().generation, 1);
  } finally {
    fixture.cleanup();
  }
});

test('recovers an interrupted staged transaction without changing the active release or lockfile', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const transaction = fixture.runtime.beginTransaction({ operation: 'install', packageName: 'tasks', version: '1.0.0' });
    fixture.runtime.makeDirectory(join(fixture.root, 'transactions', transaction.id, 'staging'));
    writeFileSync(join(fixture.root, 'transactions', transaction.id, 'staging', 'package.json'), JSON.stringify({ name: 'tasks', version: '1.0.0' }));

    const recovered = fixture.runtime.recoverTransactions();

    assert.deepEqual(recovered, [{ id: transaction.id, action: 'abandoned' }]);
    assert.equal(fixture.runtime.readTransaction(transaction.id).state, 'abandoned');
    assert.equal(existsSync(join(fixture.root, 'active', 'tasks')), false);
    assert.equal(fixture.runtime.readLockfile().generation, 0);
  } finally {
    fixture.cleanup();
  }
});

test('rolls back a transaction interrupted during activation to its prior active release', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const previous = join(fixture.root, 'releases', 'tasks', '0.9.0');
    fixture.runtime.makeDirectory(previous);
    const active = join(fixture.root, 'active', 'tasks');
    symlinkSync('../releases/tasks/0.9.0', active, 'dir');

    const transaction = fixture.runtime.beginTransaction({ operation: 'update', packageName: 'tasks', version: '1.0.0' });
    const destination = join(fixture.root, 'releases', 'tasks', '1.0.0');
    fixture.runtime.makeDirectory(destination);
    writeFileSync(join(fixture.root, 'transactions', transaction.id, 'transaction.json'), JSON.stringify({
      ...transaction,
      state: 'activating',
      previousActiveTarget: '../releases/tasks/0.9.0',
      destination,
    }));
    rmSync(active);
    symlinkSync('../releases/tasks/1.0.0', active, 'dir');

    fixture.runtime.recoverTransactions();

    assert.equal(existsSync(active), true);
    assert.equal(existsSync(destination), false);
    assert.equal(fixture.runtime.readTransaction(transaction.id).state, 'abandoned');
  } finally {
    fixture.cleanup();
  }
});

test('rejects unsafe package identities before they can affect the runtime filesystem', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    assert.throws(
      () => fixture.runtime.beginTransaction({ operation: 'install', packageName: '../escape', version: '1.0.0' }),
      /valid package name/
    );
    assert.throws(
      () => fixture.runtime.beginTransaction({ operation: 'install', packageName: '@thinkiac/../escape', version: '1.0.0' }),
      /valid package name/
    );
    assert.throws(
      () => fixture.runtime.beginTransaction({ operation: 'install', packageName: 'tasks', version: '../1.0.0' }),
      /valid package version/
    );
  } finally {
    fixture.cleanup();
  }
});

test('installs and materializes scoped packages in safe nested paths', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const workspace = join(fixture.root, 'workspace-packages');
    const source = join(fixture.root, 'source-sandbox');
    fixture.runtime.makeDirectory(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: '@thinkiac/sandbox', version: '1.0.0' }));
    fixture.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {
      '@thinkiac/sandbox': { version: '1.0.0', source: 'registry' },
    } });

    fixture.runtime.reconcile({ workspacePackagesDir: workspace, resolveRelease: () => ({ source }) });

    assert.ok(existsSync(join(fixture.root, 'releases', 'thinkiac', 'sandbox', '1.0.0', 'package.json')));
    assert.ok(lstatSync(join(fixture.root, 'active', 'thinkiac', 'sandbox')).isSymbolicLink());
    assert.ok(lstatSync(join(workspace, 'thinkiac', 'sandbox')).isSymbolicLink());
    assert.equal(fixture.runtime.readLockfile().packages['@thinkiac/sandbox'].version, '1.0.0');
  } finally {
    fixture.cleanup();
  }
});

test('reconciles the desired manifest into an applied lockfile and is idempotent', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const source = join(fixture.root, 'source-tasks');
    fixture.runtime.makeDirectory(source);
    writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'tasks', version: '1.0.0' }));
    fixture.runtime.writeManifest({
      schemaVersion: 1,
      runtimeChannel: 'stable',
      packages: { tasks: { version: '1.0.0', source: 'store', checksum: 'sha256:tasks-v1' } },
    });

    const first = fixture.runtime.reconcile({
      resolveRelease: desired => ({ source, checksum: desired.checksum }),
    });
    assert.deepEqual(first.changed, ['tasks']);
    assert.equal(fixture.runtime.readLockfile().packages.tasks.version, '1.0.0');
    assert.equal(fixture.runtime.readLockfile().packages.tasks.checksum, 'sha256:tasks-v1');

    const second = fixture.runtime.reconcile({
      resolveRelease: () => { throw new Error('an applied release must not be fetched again'); },
    });
    assert.deepEqual(second, { changed: [], removed: [], unchanged: ['tasks'] });
  } finally {
    fixture.cleanup();
  }
});

test('reconciliation updates, removes, and materializes only managed Lógos package links', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const workspace = join(fixture.root, 'workspace-packages');
    fixture.runtime.makeDirectory(workspace);
    const v1 = join(fixture.root, 'source-tasks-v1');
    const v2 = join(fixture.root, 'source-tasks-v2');
    for (const [source, version] of [[v1, '1.0.0'], [v2, '1.1.0']]) {
      fixture.runtime.makeDirectory(source);
      writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'tasks', version }));
    }
    const reloads = [];
    fixture.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {
      tasks: { version: '1.0.0', source: 'store' },
    } });
    fixture.runtime.reconcile({
      workspacePackagesDir: workspace,
      resolveRelease: () => ({ source: v1 }),
      reload: change => reloads.push(change),
    });
    assert.ok(lstatSync(join(workspace, 'tasks')).isSymbolicLink());
    assert.deepEqual(reloads, [{ packageName: 'tasks', action: 'changed' }]);

    fixture.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {
      tasks: { version: '1.1.0', source: 'store' },
    } });
    fixture.runtime.reconcile({ workspacePackagesDir: workspace, resolveRelease: () => ({ source: v2 }), reload: change => reloads.push(change) });
    assert.equal(fixture.runtime.readLockfile().packages.tasks.version, '1.1.0');

    fixture.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {} });
    const removed = fixture.runtime.reconcile({ workspacePackagesDir: workspace, reload: change => reloads.push(change) });
    assert.deepEqual(removed.removed, ['tasks']);
    assert.equal(existsSync(join(workspace, 'tasks')), false);
    assert.equal(fixture.runtime.readLockfile().packages.tasks, undefined);
    assert.deepEqual(reloads.at(-1), { packageName: 'tasks', action: 'removed' });
  } finally {
    fixture.cleanup();
  }
});

test('refuses to replace an unmanaged Lógos package while reconciling', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    const workspace = join(fixture.root, 'workspace-packages');
    fixture.runtime.makeDirectory(join(workspace, 'tasks'));
    writeFileSync(join(workspace, 'tasks', 'package.json'), '{}');
    fixture.runtime.writeManifest({ schemaVersion: 1, runtimeChannel: 'stable', packages: {
      tasks: { version: '1.0.0', source: 'store' },
    } });
    assert.throws(() => fixture.runtime.reconcile({ workspacePackagesDir: workspace, resolveRelease: () => ({ source: workspace }) }), /unmanaged/);
  } finally {
    fixture.cleanup();
  }
});

test('rolls an active package back to a retained release without fetching it again', () => {
  const fixture = makeRuntime();
  try {
    fixture.runtime.initialize();
    for (const version of ['1.0.0', '1.1.0']) {
      const source = join(fixture.root, `source-tasks-${version}`);
      fixture.runtime.makeDirectory(source);
      writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'tasks', version }));
      const transaction = fixture.runtime.beginTransaction({ operation: version === '1.0.0' ? 'install' : 'update', packageName: 'tasks', version });
      fixture.runtime.stageRelease(transaction.id, source);
      fixture.runtime.promoteRelease(transaction.id);
    }

    const rollback = fixture.runtime.rollbackRelease({ packageName: 'tasks', version: '1.0.0' });

    assert.equal(rollback.operation, 'rollback');
    assert.equal(fixture.runtime.readLockfile().packages.tasks.version, '1.0.0');
    assert.equal(fixture.runtime.readTransaction(rollback.id).state, 'rolled_back');
  } finally {
    fixture.cleanup();
  }
});
