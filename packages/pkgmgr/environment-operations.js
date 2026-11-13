// Administrative Environment lifecycle orchestration. The driver is injected
// because this control-plane state must remain independent from the execution
// backend (systemd today, another driver tomorrow).

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const OPERATIONS_FILE = 'environment-operations.json';
const INITIAL_JOURNAL = Object.freeze({ schemaVersion: 1, operations: {}, idempotency: {} });
const TYPES = new Set(['provision', 'start', 'suspend', 'teardown']);

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function readJson(path) {
  if (!existsSync(path)) return clone(INITIAL_JOURNAL);
  const value = JSON.parse(readFileSync(path, 'utf8'));
  if (value.schemaVersion !== 1 || !value.operations || !value.idempotency) throw new Error('Unsupported Environment operations journal');
  return value;
}

function text(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`);
  return value.trim();
}

function requestFingerprint({ environmentId, type, purge }) {
  return JSON.stringify({ environmentId, type, purge: Boolean(purge) });
}

const ACTIONS = {
  provision: {
    before: 'provisioning', success: 'ready', failure: 'failed', method: 'provision',
    allowed: new Set(['requested', 'failed']),
  },
  start: {
    before: 'starting', success: 'running', failure: 'failed', method: 'start',
    allowed: new Set(['ready', 'suspended']),
  },
  suspend: {
    before: 'suspending', success: 'suspended', failure: 'failed', method: 'stop',
    allowed: new Set(['running']),
  },
  teardown: {
    before: 'deleting', success: 'deleted', failure: 'failed', method: 'remove',
    allowed: new Set(['requested', 'provisioning', 'ready', 'starting', 'running', 'suspending', 'suspended', 'failed', 'deleting']),
  },
};

/**
 * Executes durable, idempotent lifecycle requests. Drivers must treat the
 * supplied operationId as their own idempotency key: if a process dies while a
 * backend call is in flight, the same journal entry is deliberately replayed.
 */
export function createEnvironmentOperations({ root, store, driver = {}, now = () => new Date().toISOString(), idFactory = () => randomUUID() } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('An Environment operations root is required');
  if (!store || typeof store.get !== 'function' || typeof store.transition !== 'function') throw new Error('An Environment store is required');
  const path = join(resolve(root), 'state', OPERATIONS_FILE);

  function journal() { return readJson(path); }
  function persist(value) { writeJson(path, value); return value; }
  function updateOperation(operation) {
    const current = journal();
    current.operations[operation.id] = operation;
    persist(current);
    return clone(operation);
  }

  const api = {
    path,
    driver,
    list({ environmentId = null } = {}) {
      return Object.values(journal().operations)
        .filter(operation => !environmentId || operation.environmentId === environmentId)
        .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
        .map(clone);
    },
    get(id) {
      const operation = journal().operations[text(id, 'operation id')];
      if (!operation) throw new Error(`Unknown Environment operation "${id}"`);
      return clone(operation);
    },
    async execute({ environmentId, type, idempotencyKey, purge = false } = {}) {
      const id = text(environmentId, 'Environment id');
      const operationType = text(type, 'operation type');
      const key = text(idempotencyKey, 'idempotency key');
      if (!TYPES.has(operationType)) throw new Error(`Unsupported Environment operation "${operationType}"`);
      const fingerprint = requestFingerprint({ environmentId: id, type: operationType, purge });
      const current = journal();
      const existingId = current.idempotency[key];
      let operation;
      if (existingId) {
        operation = current.operations[existingId];
        if (!operation || operation.fingerprint !== fingerprint) throw new Error(`Idempotency key "${key}" already belongs to a different operation`);
        if (operation.status === 'succeeded') return clone(operation);
      } else {
        operation = {
          id: idFactory(), environmentId: id, type: operationType, purge: Boolean(purge), fingerprint,
          status: 'pending', attempts: 0, createdAt: now(), updatedAt: now(), events: [],
        };
        current.operations[operation.id] = operation;
        current.idempotency[key] = operation.id;
        persist(current);
      }

      const action = ACTIONS[operation.type];
      const environment = store.get(operation.environmentId);
      if (environment.state === action.success) {
        return updateOperation({ ...operation, status: 'succeeded', updatedAt: now(), completedAt: now(), events: [...operation.events, { at: now(), event: 'already-applied' }] });
      }
      if (!action.allowed.has(environment.state)) {
        throw new Error(`Cannot ${operation.type} Environment "${operation.environmentId}" from ${environment.state}`);
      }
      if (environment.state !== action.before) store.transition(operation.environmentId, action.before, { reason: `operation:${operation.id}` });
      operation = updateOperation({ ...operation, status: 'running', attempts: operation.attempts + 1, updatedAt: now(), startedAt: now(), events: [...operation.events, { at: now(), event: 'driver-started' }] });

      try {
        const method = api.driver[action.method];
        if (typeof method !== 'function') throw new Error(`Environment driver does not implement ${action.method}`);
        await method({ environment: store.get(operation.environmentId), operationId: operation.id, purge: operation.purge });
        const after = store.get(operation.environmentId);
        if (after.state !== action.success) store.transition(operation.environmentId, action.success, { reason: `operation:${operation.id}` });
        return updateOperation({ ...operation, status: 'succeeded', updatedAt: now(), completedAt: now(), events: [...operation.events, { at: now(), event: 'driver-succeeded' }] });
      } catch (error) {
        const after = store.get(operation.environmentId);
        if (after.state !== action.failure && after.state !== 'deleted') store.transition(operation.environmentId, action.failure, { reason: `operation:${operation.id}:failed` });
        updateOperation({ ...operation, status: 'failed', updatedAt: now(), failedAt: now(), error: error instanceof Error ? error.message : String(error), events: [...operation.events, { at: now(), event: 'driver-failed' }] });
        throw error;
      }
    },
  };
  return api;
}
