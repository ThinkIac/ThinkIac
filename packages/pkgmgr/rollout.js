// Durable progressive rollout policy for a newly built tenant base image.
// It owns admission and progression only; deployment is performed by a driver.

import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

const STAGES = Object.freeze([5, 25, 100]);
const REQUIRED_GATES = Object.freeze(['build', 'runtime', 'packageRuntime', 'health']);
const INITIAL_STATE = Object.freeze({ schemaVersion: 1, rollouts: {}, idempotency: {} });

function clone(value) { return JSON.parse(JSON.stringify(value)); }
function text(value, label) { if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`); return value.trim(); }
function stateAt(path) {
  if (!existsSync(path)) return clone(INITIAL_STATE);
  const state = JSON.parse(readFileSync(path, 'utf8'));
  if (state.schemaVersion !== 1 || !state.rollouts || !state.idempotency) throw new Error('Unsupported image rollout state');
  return state;
}
function writeState(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}
function validateCandidate(candidate) {
  if (!candidate || typeof candidate !== 'object') throw new Error('An image candidate is required');
  if (!/^.+@sha256:[a-f0-9]{64}$/i.test(text(candidate.image, 'image digest'))) throw new Error('Image must be pinned by SHA-256 digest');
  text(candidate.runtimeVersion, 'runtime version');
  const failed = REQUIRED_GATES.filter(gate => candidate.checks?.[gate] !== true);
  if (failed.length) throw new Error(`Image release gates did not pass: ${failed.join(', ')}`);
  return { image: candidate.image, runtimeVersion: candidate.runtimeVersion, checks: Object.fromEntries(REQUIRED_GATES.map(gate => [gate, true])) };
}

export function createImageRollout({ root, now = () => new Date().toISOString(), idFactory = () => randomUUID(), minimumHealthyRatio = 1 } = {}) {
  if (typeof root !== 'string' || !root) throw new Error('An image rollout root is required');
  if (typeof minimumHealthyRatio !== 'number' || minimumHealthyRatio <= 0 || minimumHealthyRatio > 1) throw new Error('minimumHealthyRatio must be between 0 and 1');
  const path = join(resolve(root), 'state', 'image-rollouts.json');
  function persist(rollout) {
    const state = stateAt(path);
    state.rollouts[rollout.id] = rollout;
    state.idempotency[rollout.idempotencyKey] = rollout.id;
    writeState(path, state);
    return clone(rollout);
  }
  function get(id) {
    const rollout = stateAt(path).rollouts[text(id, 'rollout id')];
    if (!rollout) throw new Error(`Unknown image rollout "${id}"`);
    return clone(rollout);
  }
  return {
    path, get,
    start({ candidate, idempotencyKey } = {}) {
      const key = text(idempotencyKey, 'idempotency key');
      const normalized = validateCandidate(candidate);
      const state = stateAt(path);
      if (state.idempotency[key]) return get(state.idempotency[key]);
      return persist({ id: idFactory(), idempotencyKey: key, candidate: normalized, status: 'running', stage: { index: 0, percentage: STAGES[0] }, createdAt: now(), updatedAt: now(), history: [{ at: now(), event: 'started', percentage: STAGES[0] }] });
    },
    advance({ rolloutId, healthy, total } = {}) {
      const rollout = get(rolloutId);
      if (rollout.status !== 'running') return rollout;
      if (!Number.isInteger(healthy) || !Number.isInteger(total) || total <= 0 || healthy < 0 || healthy > total) throw new Error('Healthy and total must be valid rollout counts');
      const ratio = healthy / total;
      if (ratio < minimumHealthyRatio) {
        return persist({ ...rollout, status: 'rolled_back', rollback: { at: now(), reason: 'canary-health-below-threshold', healthy, total }, updatedAt: now(), history: [...rollout.history, { at: now(), event: 'rolled-back', healthy, total }] });
      }
      const nextIndex = rollout.stage.index + 1;
      if (nextIndex >= STAGES.length) return persist({ ...rollout, status: 'completed', completedAt: now(), updatedAt: now(), history: [...rollout.history, { at: now(), event: 'completed', healthy, total }] });
      return persist({ ...rollout, stage: { index: nextIndex, percentage: STAGES[nextIndex] }, updatedAt: now(), history: [...rollout.history, { at: now(), event: 'advanced', percentage: STAGES[nextIndex], healthy, total }] });
    },
  };
}
