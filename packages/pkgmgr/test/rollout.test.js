import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createImageRollout } from '../rollout.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-rollout-'));
  return { root, rollout: createImageRollout({ root, idFactory: () => 'rollout_1' }) };
}

const candidate = { image: 'registry.example/thinkiac@sha256:' + 'a'.repeat(64), runtimeVersion: '1.0.0', checks: { build: true, runtime: true, packageRuntime: true, health: true } };

test('starts a progressive image rollout only after all release gates pass', () => {
  const subject = fixture();
  try {
    const created = subject.rollout.start({ candidate, idempotencyKey: 'image-1' });
    assert.equal(created.status, 'running');
    assert.equal(created.stage.percentage, 5);
    const advanced = subject.rollout.advance({ rolloutId: created.id, healthy: 5, total: 5 });
    assert.equal(advanced.stage.percentage, 25);
    assert.equal(subject.rollout.advance({ rolloutId: created.id, healthy: 25, total: 25 }).stage.percentage, 100);
    assert.equal(subject.rollout.advance({ rolloutId: created.id, healthy: 100, total: 100 }).status, 'completed');
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});

test('blocks invalid images and rolls back a rollout with unhealthy canaries', () => {
  const subject = fixture();
  try {
    assert.throws(() => subject.rollout.start({ candidate: { ...candidate, checks: { ...candidate.checks, health: false } }, idempotencyKey: 'bad' }), /release gates/);
    const created = subject.rollout.start({ candidate, idempotencyKey: 'image-1' });
    const stopped = subject.rollout.advance({ rolloutId: created.id, healthy: 4, total: 5 });
    assert.equal(stopped.status, 'rolled_back');
    assert.equal(stopped.rollback.reason, 'canary-health-below-threshold');
  } finally { rmSync(subject.root, { recursive: true, force: true }); }
});
