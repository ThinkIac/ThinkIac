import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createLogosReloadCallback, createManagedPackageRuntime } from '../logos-runtime.js';

test('signals the Lógos stabilizer through its documented commit marker', () => {
  const packages = mkdtempSync(join(tmpdir(), 'thinkiac-logos-packages-'));
  try {
    const packageDir = join(packages, 'tasks');
    mkdirSync(packageDir);
    const reload = createLogosReloadCallback({ packagesDir: packages });
    assert.deepEqual(reload({ packageName: 'tasks', action: 'changed' }), {
      packageName: 'tasks', action: 'changed', requested: true, marker: 'tasks/.commit',
    });
    assert.ok(existsSync(join(packageDir, '.commit')));
    assert.match(readFileSync(join(packageDir, '.commit'), 'utf8'), /^\d{4}-\d{2}-\d{2}T/);
    assert.deepEqual(reload({ packageName: 'tasks', action: 'removed' }), {
      packageName: 'tasks', action: 'removed', requested: false,
    });
  } finally {
    rmSync(packages, { recursive: true, force: true });
  }
});

test('managed runtime recovers first and always binds reconciliation to the Lógos workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-managed-runtime-'));
  try {
    const packages = join(root, 'packages');
    mkdirSync(packages);
    const managed = createManagedPackageRuntime({ root: join(root, 'runtime'), packagesDir: packages });
    assert.deepEqual(managed.recovered, []);
    assert.equal(managed.runtime.paths.root, join(root, 'runtime'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('managed operations install, update, remove and roll back through the Lógos workspace', () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-managed-operations-'));
  try {
    const packages = join(root, 'packages');
    mkdirSync(packages);
    const managed = createManagedPackageRuntime({ root: join(root, 'runtime'), packagesDir: packages });
    const release = (version) => {
      const source = join(root, `tasks-${version}`);
      mkdirSync(source);
      writeFileSync(join(source, 'package.json'), JSON.stringify({ name: 'tasks', version }));
      return { version, source, checksum: `sha256:${version}` };
    };

    assert.deepEqual(managed.install({ packageName: 'tasks', ...release('1.0.0') }).changed, ['tasks']);
    assert.ok(existsSync(join(packages, 'tasks', '.commit')));
    assert.deepEqual(managed.update({ packageName: 'tasks', ...release('1.1.0') }).changed, ['tasks']);
    assert.equal(managed.runtime.readLockfile().packages.tasks.version, '1.1.0');
    assert.equal(managed.rollback({ packageName: 'tasks', version: '1.0.0' }).version, '1.0.0');
    assert.equal(managed.runtime.readLockfile().packages.tasks.version, '1.0.0');
    assert.deepEqual(managed.remove({ packageName: 'tasks' }).removed, ['tasks']);
    assert.equal(existsSync(join(packages, 'tasks')), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
