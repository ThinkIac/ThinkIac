import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { requiredViewPermission, requiredToolPermission } = require('./discovery_permissions.cjs');
const manifest = { name: 'providers', manifest: { access: {
  views: { Index: 'providers.config.read' },
  tools: { saveProvider: 'providers.config.write' },
} } };

test('discovery declarations resolve canonical view and tool permissions', () => {
  assert.equal(requiredViewPermission(manifest, 'Index'), 'providers.config.read');
  assert.equal(requiredToolPermission(manifest, 'saveProvider'), 'providers.config.write');
});

test('invalid, foreign, and undeclared discovery permissions fail closed', () => {
  assert.equal(requiredViewPermission(manifest, 'Missing'), null);
  assert.equal(requiredToolPermission({ name: 'providers', manifest: { access: { tools: { saveProvider: 'auth.users.read' } } } }, 'saveProvider'), null);
  assert.equal(requiredViewPermission({ name: 'providers', manifest: { access: { views: { '../Index': 'providers.config.read' } } } }, '../Index'), null);
});
