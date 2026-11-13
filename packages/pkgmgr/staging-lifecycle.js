// Staging migration and reset orchestration. It composes the durable package
// runtime and Environment lifecycle instead of bypassing either one.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const INITIAL_STATE = Object.freeze({ schemaVersion: 1, migrations: {}, resets: {} });

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`);
  return value.trim();
}

function readJson(path) {
  if (!existsSync(path)) return clone(INITIAL_STATE);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.schemaVersion !== 1 || !value.migrations || !value.resets) throw new Error('Unsupported staging lifecycle state');
  return value;
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function fingerprint(environment, manifest) {
  return JSON.stringify({ environmentId: environment.id, tenantId: environment.tenantId, manifest });
}

/**
 * Provides the two safe staging procedures used before a public tenant can be
 * created: migration with a durable pre-change snapshot, then a lifecycle-led
 * reset. The caller supplies release resolution so this module never reaches
 * into a Store or a workspace directly.
 */
export function createStagingLifecycle({ root, runtime, environments, operations, now = () => new Date().toISOString(), idFactory = () => randomUUID() } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('A staging lifecycle root is required');
  if (!runtime || typeof runtime.readManifest !== 'function' || typeof runtime.reconcile !== 'function') throw new Error('A Package Runtime is required');
  if (!environments || typeof environments.create !== 'function' || typeof environments.get !== 'function') throw new Error('An Environment store is required');
  if (!operations || typeof operations.execute !== 'function') throw new Error('Environment operations are required');
  const path = join(resolve(root), 'state', 'staging-lifecycle.json');

  function state() { return readJson(path); }
  function persist(next) { writeJson(path, next); return next; }
  function saveMigration(migration) {
    const current = state();
    current.migrations[migration.id] = migration;
    persist(current);
    return clone(migration);
  }
  function saveReset(reset) {
    const current = state();
    current.resets[reset.idempotencyKey] = reset;
    persist(current);
    return clone(reset);
  }

  return {
    path,
    get(id) {
      const migration = state().migrations[text(id, 'migration id')];
      if (!migration) throw new Error(`Unknown staging migration "${id}"`);
      return clone(migration);
    },
    async migrate({ environment, manifest, idempotencyKey, resolveRelease, workspacePackagesDir = null, reload = null } = {}) {
      const input = environment ?? {};
      const environmentId = text(input.id, 'Environment id');
      const tenantId = text(input.tenantId, 'tenant id');
      const key = text(idempotencyKey, 'idempotency key');
      if (typeof resolveRelease !== 'function') throw new Error('A release resolver is required for staging migration');
      const requestFingerprint = fingerprint({ id: environmentId, tenantId }, manifest);
      const current = state();
      const existing = Object.values(current.migrations).find(entry => entry.idempotencyKey === key);
      if (existing) {
        if (existing.fingerprint !== requestFingerprint) throw new Error(`Idempotency key "${key}" belongs to a different staging migration`);
        return clone(existing);
      }

      let environmentState;
      try { environmentState = environments.get(environmentId); } catch {
        environmentState = environments.create({ id: environmentId, tenantId, plan: input.plan ?? 'free', domain: input.domain ?? null, metadata: input.metadata ?? {} });
      }
      const migration = saveMigration({
        id: idFactory(), idempotencyKey: key, fingerprint: requestFingerprint, environmentId, tenantId,
        status: 'running', createdAt: now(), updatedAt: now(), before: {
          manifest: runtime.readManifest(), lockfile: runtime.readLockfile(), environmentState: environmentState.state,
        },
      });
      try {
        runtime.writeManifest(manifest);
        const reconciliation = runtime.reconcile({ resolveRelease, workspacePackagesDir, reload });
        const afterPackages = environments.get(environmentId);
        if (['requested', 'failed'].includes(afterPackages.state)) await operations.execute({ environmentId, type: 'provision', idempotencyKey: `${key}:provision` });
        const afterProvision = environments.get(environmentId);
        if (['ready', 'suspended'].includes(afterProvision.state)) await operations.execute({ environmentId, type: 'start', idempotencyKey: `${key}:start` });
        return saveMigration({ ...migration, status: 'succeeded', reconciliation, completedAt: now(), updatedAt: now() });
      } catch (error) {
        saveMigration({ ...migration, status: 'failed', failedAt: now(), updatedAt: now(), error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
    rollback({ migrationId, resolveRelease, workspacePackagesDir = null, reload = null } = {}) {
      const migration = this.get(migrationId);
      if (migration.status === 'rolled_back') return migration;
      if (migration.status !== 'succeeded') throw new Error(`Cannot roll back staging migration in ${migration.status}`);
      if (typeof resolveRelease !== 'function') throw new Error('A release resolver is required for staging rollback');
      runtime.writeManifest(migration.before.manifest);
      const current = runtime.readLockfile();
      for (const [packageName, desired] of Object.entries(migration.before.manifest.packages)) {
        if (current.packages[packageName]?.version === desired.version) continue;
        const retained = join(runtime.paths.releases, packageName, desired.version, 'package.json');
        if (existsSync(retained)) runtime.rollbackRelease({ packageName, version: desired.version });
      }
      const reconciliation = runtime.reconcile({ resolveRelease, workspacePackagesDir, reload });
      return saveMigration({ ...migration, status: 'rolled_back', rollback: { reconciliation, at: now() }, updatedAt: now() });
    },
    async reset({ environmentId, idempotencyKey, purge = true, workspacePackagesDir = null, reload = null } = {}) {
      const id = text(environmentId, 'Environment id');
      const key = text(idempotencyKey, 'idempotency key');
      const existing = state().resets[key];
      if (existing) {
        if (existing.environmentId !== id || existing.purge !== Boolean(purge)) throw new Error(`Idempotency key "${key}" belongs to a different staging reset`);
        if (existing.status === 'succeeded') return clone(existing);
      }
      const reset = saveReset(existing
        ? { ...existing, status: 'running', resumedAt: now(), updatedAt: now() }
        : { id: idFactory(), idempotencyKey: key, environmentId: id, purge: Boolean(purge), status: 'running', createdAt: now(), updatedAt: now() });
      try {
        await operations.execute({ environmentId: id, type: 'teardown', idempotencyKey: `${key}:teardown`, purge });
        const manifest = runtime.readManifest();
        runtime.writeManifest({ ...manifest, packages: {} });
        const reconciliation = runtime.reconcile({ workspacePackagesDir, reload });
        return saveReset({ ...reset, status: 'succeeded', reconciliation, completedAt: now(), updatedAt: now() });
      } catch (error) {
        saveReset({ ...reset, status: 'failed', failedAt: now(), updatedAt: now(), error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    },
  };
}
