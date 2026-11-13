import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createEnvironmentStore } from '../environment.js';

test('persists an Environment and permits only declared lifecycle transitions', () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-environments-'));
  try {
    const store = createEnvironmentStore({ root, idFactory: () => 'env_staging' });
    const created = store.create({ tenantId: 'tenant_staging', plan: 'free', domain: 'staging.example.test' });
    assert.equal(created.state, 'requested');
    assert.equal(store.transition(created.id, 'provisioning').state, 'provisioning');
    assert.equal(store.transition(created.id, 'ready').state, 'ready');
    assert.equal(store.transition(created.id, 'starting').state, 'starting');
    assert.equal(store.transition(created.id, 'running').state, 'running');
    assert.equal(store.get(created.id).history.length, 5);
    assert.throws(() => store.transition(created.id, 'deleted'), /Invalid Environment transition/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('Environment identity is stable across store recreation and terminal states cannot restart', () => {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-environments-'));
  try {
    const first = createEnvironmentStore({ root, idFactory: () => 'env_1' });
    first.create({ tenantId: 'tenant_1' });
    for (const state of ['provisioning', 'ready', 'deleting', 'deleted']) first.transition('env_1', state);

    const restored = createEnvironmentStore({ root });
    assert.equal(restored.get('env_1').state, 'deleted');
    assert.throws(() => restored.transition('env_1', 'starting'), /Invalid Environment transition/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
