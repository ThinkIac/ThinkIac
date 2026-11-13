import assert from 'node:assert/strict';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { authorizeRequest, requirePermission } from './authorization.js';
import permissionCatalogService from './permission_catalog.cjs';

function database({ role = 'user', memberships = [], groups = [], grants = [] } = {}) {
  const rows = (values) => ({ query: (where = {}) => values.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)) });
  return {
    user: { ana: { id: 'ana', role } },
    permissionMembership: rows(memberships),
    permissionGroup: rows(groups),
    permissionGrant: rows(grants),
  };
}

test('the package authorization contract resolves declared Access groups', () => {
  const db = database({
    memberships: [{ userId: 'ana', groupId: 'providers-manager' }],
    groups: [{ id: 'providers-manager', declaredPackage: 'providers', declaredGroup: 'manager' }],
  });
  const catalog = { get: (pkg, group) => pkg === 'providers' && group === 'manager'
    ? { permissions: ['providers.catalog.write'] } : null };

  assert.deepEqual(authorizeRequest({ principal: { subject: 'ana' } }, 'providers.catalog.read', null, { database: db, catalog }), {
    allowed: true, reason: 'declared-group', status: 200,
  });
});

test('Redirect and Providers publish their groups to the real Access catalog', () => {
  const catalog = permissionCatalogService.createPermissionCatalog({
    packagesDir: resolve(dirname(fileURLToPath(import.meta.url)), '..'),
  });
  assert.deepEqual(catalog.get('redirect', 'manager')?.permissions, [
    'redirect.homepage.read', 'redirect.homepage.write',
  ]);
  assert.deepEqual(catalog.get('providers', 'manager')?.permissions, [
    'providers.catalog.read', 'providers.catalog.write', 'providers.catalog.manage',
  ]);
  assert.ok(catalog.get('cnpj-scraper', 'operator')?.permissions.includes('cnpj-scraper.read'));
});

test('the package authorization contract fails closed and retains explicit deny', () => {
  const db = database({
    grants: [{ subjectType: 'user', subjectId: 'ana', permission: 'redirect.homepage.write', resourceId: null, effect: 'deny' }],
  });
  assert.equal(authorizeRequest({}, 'redirect.homepage.write', null, { database: db }).status, 401);
  assert.equal(authorizeRequest({ user: { id: 'ana' } }, 'redirect.homepage.write', null, { database: db }).status, 403);
  assert.throws(() => requirePermission({ user: { id: 'ana' } }, 'redirect.homepage.write', null, { database: db }), { status: 403 });
});
