import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { createEnvironmentStore } from '../environment.js';
import { createEnvironmentOperations } from '../environment-operations.js';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'thinkiac-environment-operations-'));
  const store = createEnvironmentStore({ root, idFactory: () => 'env_1' });
  store.create({ tenantId: 'tenant_1' });
  const calls = [];
  const driver = {
    provision: async input => { calls.push(['provision', input]); },
    start: async input => { calls.push(['start', input]); },
    stop: async input => { calls.push(['stop', input]); },
    remove: async input => { calls.push(['remove', input]); },
  };
  return { root, store, calls, operations: createEnvironmentOperations({ root, store, driver }) };
}

test('administrative lifecycle operations are durable, idempotent, and use driver operation ids', async () => {
  const subject = fixture();
  try {
    const first = await subject.operations.execute({ environmentId: 'env_1', type: 'provision', idempotencyKey: 'create-1' });
    assert.equal(first.status, 'succeeded');
    assert.equal(subject.store.get('env_1').state, 'ready');
    assert.equal(subject.calls.length, 1);
    assert.equal(subject.calls[0][1].operationId, first.id);

    const repeat = await subject.operations.execute({ environmentId: 'env_1', type: 'provision', idempotencyKey: 'create-1' });
    assert.equal(repeat.id, first.id);
    assert.equal(subject.calls.length, 1);

    await subject.operations.execute({ environmentId: 'env_1', type: 'start', idempotencyKey: 'start-1' });
    assert.equal(subject.store.get('env_1').state, 'running');
    await subject.operations.execute({ environmentId: 'env_1', type: 'suspend', idempotencyKey: 'stop-1' });
    assert.equal(subject.store.get('env_1').state, 'suspended');
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('failed teardown is resumable with the same idempotency key and preserves its purge intent', async () => {
  const subject = fixture();
  try {
    await subject.operations.execute({ environmentId: 'env_1', type: 'provision', idempotencyKey: 'create-1' });
    let failOnce = true;
    subject.operations.driver.remove = async input => {
      subject.calls.push(['remove', input]);
      if (failOnce) { failOnce = false; throw new Error('network interrupted'); }
    };

    await assert.rejects(
      subject.operations.execute({ environmentId: 'env_1', type: 'teardown', idempotencyKey: 'delete-1', purge: false }),
      /network interrupted/
    );
    assert.equal(subject.store.get('env_1').state, 'failed');

    const resumed = await subject.operations.execute({ environmentId: 'env_1', type: 'teardown', idempotencyKey: 'delete-1', purge: false });
    assert.equal(resumed.status, 'succeeded');
    assert.equal(subject.store.get('env_1').state, 'deleted');
    assert.equal(subject.calls.filter(([name]) => name === 'remove').at(-1)[1].purge, false);
    assert.equal(subject.operations.list({ environmentId: 'env_1' }).length, 2);
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});

test('an idempotency key cannot be reused for a distinct administrative request', async () => {
  const subject = fixture();
  try {
    await subject.operations.execute({ environmentId: 'env_1', type: 'provision', idempotencyKey: 'key-1' });
    await assert.rejects(
      subject.operations.execute({ environmentId: 'env_1', type: 'start', idempotencyKey: 'key-1' }),
      /already belongs to a different operation/
    );
  } finally {
    rmSync(subject.root, { recursive: true, force: true });
  }
});
