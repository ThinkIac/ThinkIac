// Public tenant creation composes the durable runtime, lifecycle operations,
// Verdaccio release contract, and health checks. It is deliberately per-tenant:
// callers provide a runtime rooted in that tenant's isolated data directory.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';
import { parseIntegrity } from './lib/registry-client.js';
import { prepareRegistryReconciliation } from './registry-reconciliation.js';

const INITIAL_STATE = Object.freeze({ schemaVersion: 1, requests: {}, idempotency: {} });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`);
  return value.trim();
}
function readJson(path) {
  if (!existsSync(path)) return clone(INITIAL_STATE);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.schemaVersion !== 1 || !value.requests || !value.idempotency) throw new Error('Unsupported public tenant lifecycle state');
  return value;
}
function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}
function requestFingerprint({ tenantId, environmentId, domain, plan, manifest, runtimeVersion, channel }) {
  return JSON.stringify({ tenantId, environmentId, domain: domain ?? null, plan, manifest, runtimeVersion, channel });
}

function verifiedRegistryRelease(release, desired, { packageName, runtimeVersion, channel }) {
  if (!release?.source || release.packageName !== packageName || release.version !== desired.version) {
    throw new Error(`Release resolver returned an identity mismatch for ${packageName}`);
  }
  if (release.runtimeVersion && release.runtimeVersion !== runtimeVersion) {
    throw new Error(`Release ${packageName}@${desired.version} is incompatible with runtime ${runtimeVersion}`);
  }
  if (release.channel && release.channel !== channel) {
    throw new Error(`Release ${packageName}@${desired.version} is not eligible for public ${channel}`);
  }
  const integrity = String(release.integrity ?? '').trim();
  if (!integrity || integrity !== desired.integrity) {
    throw new Error(`Release ${packageName}@${desired.version} integrity does not match the public manifest`);
  }
  parseIntegrity(integrity);
  return { ...release, integrity };
}

/**
 * The first public path. A release is resolved and vetted before an
 * Environment exists, preventing drafts/revoked releases from consuming
 * capacity. Failures after creation are compensated with the official
 * teardown operation and remain durable for operators to inspect or retry.
 */
export function createPublicTenantLifecycle({ root, runtime, environments, operations, health, now = () => new Date().toISOString(), idFactory = () => randomUUID() } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('A public tenant lifecycle root is required');
  if (!runtime || typeof runtime.writeManifest !== 'function' || typeof runtime.reconcile !== 'function') throw new Error('A Package Runtime is required');
  if (!environments || typeof environments.create !== 'function' || typeof environments.get !== 'function') throw new Error('An Environment store is required');
  if (!operations || typeof operations.execute !== 'function') throw new Error('Environment operations are required');
  if (!health || typeof health.check !== 'function') throw new Error('An operational healthcheck is required');
  const path = join(resolve(root), 'state', 'public-tenant-lifecycle.json');

  function state() { return readJson(path); }
  function save(request) {
    const current = state();
    current.requests[request.id] = request;
    current.idempotency[request.idempotencyKey] = request.id;
    writeJson(path, current);
    return clone(request);
  }

  return {
    path,
    get(id) {
      const request = state().requests[text(id, 'public tenant request id')];
      if (!request) throw new Error(`Unknown public tenant request "${id}"`);
      return clone(request);
    },
    async create({ tenantId, environmentId = null, domain = null, plan = 'free', metadata = {}, manifest, idempotencyKey, runtimeVersion, channel = 'stable', resolveRelease, workspacePackagesDir = null, reload = null } = {}) {
      const tenant = text(tenantId, 'tenant id');
      const key = text(idempotencyKey, 'idempotency key');
      const version = text(runtimeVersion, 'runtime version');
      const selectedChannel = text(channel, 'release channel');
      if (!manifest || manifest.schemaVersion !== 1 || !manifest.packages || Array.isArray(manifest.packages)) throw new Error('Expected a runtime manifest with packages');
      const environment = environmentId ?? `env_${tenant}`;
      const fingerprint = requestFingerprint({ tenantId: tenant, environmentId: environment, domain, plan, manifest, runtimeVersion: version, channel: selectedChannel });
      const current = state();
      const existingId = current.idempotency[key];
      if (existingId) {
        const existing = current.requests[existingId];
        if (!existing || existing.fingerprint !== fingerprint) throw new Error(`Idempotency key "${key}" belongs to a different public tenant request`);
        return clone(existing);
      }

      // Resolve and validate every release before any environment state change.
      // Supplying a resolver remains supported for isolated drivers and tests;
      // production defaults to the trusted Verdaccio client.
      const prepared = typeof resolveRelease === 'function' ? null : await prepareRegistryReconciliation({ manifest });
      const resolver = resolveRelease ?? prepared.resolveRelease;
      const resolved = {};
      try {
        for (const [packageName, desired] of Object.entries(manifest.packages)) {
          if (typeof desired?.integrity !== 'string') throw new Error(`Public manifest requires sha512 integrity for ${packageName}`);
          const release = await resolver({ packageName, ...desired });
          resolved[packageName] = verifiedRegistryRelease(release, desired, {
            packageName, runtimeVersion: version, channel: selectedChannel,
          });
        }

        const request = save({
        id: idFactory(), idempotencyKey: key, fingerprint, tenantId: tenant, environmentId: environment, status: 'running',
        createdAt: now(), updatedAt: now(), releases: Object.fromEntries(Object.entries(resolved).map(([name, release]) => [name, { version: release.version, integrity: release.integrity, channel: release.channel ?? selectedChannel }])),
      });
        let environmentCreated = false;
        try {
        try { environments.get(environment); } catch {
          environments.create({ id: environment, tenantId: tenant, plan, domain, metadata });
          environmentCreated = true;
        }
        runtime.writeManifest(manifest);
        const reconciliation = runtime.reconcile({
          workspacePackagesDir, reload,
          resolveRelease: ({ packageName, version: releaseVersion }) => {
            const release = resolved[packageName];
            if (!release || release.version !== releaseVersion) throw new Error(`No validated release is available for ${packageName}`);
            return { ...release, checksum: release.integrity };
          },
        });
        const currentEnvironment = environments.get(environment);
        if (['requested', 'failed'].includes(currentEnvironment.state)) await operations.execute({ environmentId: environment, type: 'provision', idempotencyKey: `${key}:provision` });
        const provisioned = environments.get(environment);
        if (['ready', 'suspended'].includes(provisioned.state)) await operations.execute({ environmentId: environment, type: 'start', idempotencyKey: `${key}:start` });
        const resultHealth = await health.check({ environmentId: environment });
        if (!resultHealth.ok) throw new Error('Public tenant health check failed after startup');
        return save({ ...request, status: 'succeeded', reconciliation, health: resultHealth, completedAt: now(), updatedAt: now() });
        } catch (error) {
        let compensation = null;
        if (environmentCreated) {
          try {
            compensation = await operations.execute({ environmentId: environment, type: 'teardown', purge: true, idempotencyKey: `${key}:compensate` });
          } catch (cleanupError) {
            compensation = { status: 'failed', error: cleanupError instanceof Error ? cleanupError.message : String(cleanupError) };
          }
        }
        save({ ...request, status: 'failed', error: error instanceof Error ? error.message : String(error), compensation, failedAt: now(), updatedAt: now() });
          throw error;
        }
      } finally {
        prepared?.cleanup();
      }
    },
  };
}
