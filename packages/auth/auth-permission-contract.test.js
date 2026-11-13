import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('.', import.meta.url);
const manifest = JSON.parse(readFileSync(new URL('./package.json', root), 'utf8'));
const source = readFileSync(new URL('./index.js', root), 'utf8');
const require = createRequire(import.meta.url);
const { authorize } = require('./permissions.cjs');
const { defaultPermissionCatalog } = require('./permission_catalog.cjs');

test('auth declares its administrative role in the shared permission catalog', () => {
    assert.deepEqual(manifest.manifest.permissionGroups, [{
        id: 'administrator',
        label: 'System administrator',
        permissions: [
            'auth.users.read', 'auth.users.write',
            'auth.access.read', 'auth.access.write',
            'auth.settings.read', 'auth.settings.write',
        ],
    }]);
});

test('auth administration uses the same authorization resolver it provides', () => {
    assert.match(source, /function canManageAuth\(db, user, permission\)/);
    assert.match(source, /authorize\(\{[\s\S]*?catalog: permissionCatalog/);
    assert.match(source, /canManageAuth\(db, me, 'auth\.users\.read'\)/);
    assert.match(source, /canManageAuth\(db, me, 'auth\.users\.write'\)/);
    assert.match(source, /canManageAuth\(db, me, 'auth\.settings\.write'\)/);
    assert.match(source, /canManageAuth\(db, user, 'auth\.settings\.write'\)/);
    assert.match(source, /requireGlobalPermissionAdmin\(req, 'auth\.access\.read'\)/);
    assert.match(source, /requireGlobalPermissionAdmin\(req, 'auth\.access\.write'\)/);
});

test('the declared auth administrator role authorizes its own administration', () => {
    const database = {
        user: { operator: { id: 'operator', role: 'user' } },
        permissionGroup: { query: () => [{ id: 'system-admin', declaredPackage: 'auth', declaredGroup: 'administrator' }] },
        permissionMembership: { query: () => [{ userId: 'operator', groupId: 'system-admin' }] },
        permissionGrant: { query: () => [] },
    };
    assert.equal(authorize({ userId: 'operator', permission: 'auth.users.read', database, catalog: defaultPermissionCatalog }).allowed, true);
    assert.equal(authorize({ userId: 'operator', permission: 'auth.access.write', database, catalog: defaultPermissionCatalog }).allowed, true);
    assert.equal(authorize({ userId: 'operator', permission: 'auth.settings.write', database, catalog: defaultPermissionCatalog }).allowed, true);
});
