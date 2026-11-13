// Durable logical-tenant lifecycle. Provisioning drivers remain outside this
// module: it only owns identity, legal transitions, and crash-safe state.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const INITIAL_STATE = Object.freeze({ schemaVersion: 1, environments: {} });
const TRANSITIONS = Object.freeze({
  requested: new Set(['provisioning', 'deleting']),
  provisioning: new Set(['ready', 'failed', 'deleting']),
  ready: new Set(['starting', 'deleting']),
  starting: new Set(['running', 'failed', 'deleting']),
  running: new Set(['suspending', 'deleting']),
  suspending: new Set(['suspended', 'failed', 'deleting']),
  suspended: new Set(['starting', 'deleting']),
  failed: new Set(['provisioning', 'deleting']),
  deleting: new Set(['deleted', 'failed']),
  deleted: new Set(),
});

function clone(value) { return JSON.parse(JSON.stringify(value)); }

function readJson(path) {
  if (!existsSync(path)) return clone(INITIAL_STATE);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function assertText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`);
  return value.trim();
}

export function createEnvironmentStore({ root, idFactory = () => randomUUID(), now = () => new Date().toISOString() } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('An Environment storage root is required');
  const path = join(resolve(root), 'state', 'environments.json');

  function state() {
    const current = readJson(path);
    if (current.schemaVersion !== 1 || !current.environments || Array.isArray(current.environments)) {
      throw new Error('Unsupported Environment state schema');
    }
    return current;
  }

  function persist(next) { writeJson(path, next); return next; }

  return {
    path,
    list() { return Object.values(state().environments).map(clone); },
    get(id) {
      const environment = state().environments[assertText(id, 'Environment id')];
      if (!environment) throw new Error(`Unknown Environment "${id}"`);
      return clone(environment);
    },
    create({ id = idFactory(), tenantId, plan = 'free', domain = null, metadata = {} } = {}) {
      const environmentId = assertText(id, 'Environment id');
      const tenant = assertText(tenantId, 'tenant id');
      const current = state();
      if (current.environments[environmentId]) throw new Error(`Environment "${environmentId}" already exists`);
      const timestamp = now();
      const environment = {
        id: environmentId, tenantId: tenant, plan: assertText(plan, 'plan'), domain,
        metadata: clone(metadata), state: 'requested', createdAt: timestamp, updatedAt: timestamp,
        history: [{ from: null, to: 'requested', at: timestamp, reason: 'created' }],
      };
      current.environments[environmentId] = environment;
      persist(current);
      return clone(environment);
    },
    transition(id, nextState, { reason = null } = {}) {
      const environmentId = assertText(id, 'Environment id');
      const target = assertText(nextState, 'Environment state');
      if (!Object.hasOwn(TRANSITIONS, target)) throw new Error(`Unknown Environment state "${target}"`);
      const current = state();
      const environment = current.environments[environmentId];
      if (!environment) throw new Error(`Unknown Environment "${environmentId}"`);
      if (environment.state === target) return clone(environment);
      if (!TRANSITIONS[environment.state]?.has(target)) {
        throw new Error(`Invalid Environment transition ${environment.state} -> ${target}`);
      }
      const timestamp = now();
      environment.history.push({ from: environment.state, to: target, at: timestamp, reason });
      environment.state = target;
      environment.updatedAt = timestamp;
      persist(current);
      return clone(environment);
    },
  };
}

export const ENVIRONMENT_TRANSITIONS = TRANSITIONS;
