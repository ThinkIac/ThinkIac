import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { normalizeManifestSlots, resolveSlot } = require('../../runtime/system/apps/slots.js');

test('normalizes the minimal named-slot contribution', () => {
  assert.deepEqual(normalizeManifestSlots({
    'email-manager.account-connect': { id: 'google', view: 'Connect' },
  }, 'gmail-bridge'), [{
    slot: 'email-manager.account-connect', id: 'google', packageName: 'gmail-bridge',
    view: 'Connect', label: 'google', order: 0, contract: 1,
  }]);
});

test('rejects malformed slot names and contribution ids', () => {
  assert.deepEqual(normalizeManifestSlots({ accountConnect: { id: 'Google!' } }, 'bad'), []);
});

test('last contribution wins for the same slot and id with diagnostics', () => {
  const result = resolveSlot([
    { slot: 'host.point', id: 'google', packageName: 'base', order: 10 },
    { slot: 'host.point', id: 'other', packageName: 'other', order: 5 },
    { slot: 'host.point', id: 'google', packageName: 'local', order: 1 },
  ], 'host.point');
  assert.deepEqual(result.map(({ id, packageName, overrides }) => ({ id, packageName, overrides })), [
    { id: 'google', packageName: 'local', overrides: 'base' },
    { id: 'other', packageName: 'other', overrides: undefined },
  ]);
});

test('empty and unknown slots resolve to an empty list', () => {
  assert.deepEqual(resolveSlot([], 'host.point'), []);
});
