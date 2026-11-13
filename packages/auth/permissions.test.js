import assert from 'node:assert/strict';
import test from 'node:test';
import {
    authorize,
    permissionsForUser,
    validateGrantInput,
} from './permissions.cjs';

function dbWith({ users = [], groups = [], memberships = [], grants = [] } = {}) {
    const table = (rows) => ({ query: (where = {}) => rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)) });
    return {
        user: Object.fromEntries(users.map((user) => [user.id, user])),
        permissionGroup: table(groups),
        permissionMembership: table(memberships),
        permissionGrant: table(grants),
    };
}

test('admin has implicit global access while regular users deny by default', () => {
    const database = dbWith({ users: [{ id: 'admin', role: 'admin' }, { id: 'ana', role: 'user' }] });
    assert.equal(authorize({ userId: 'admin', permission: 'email-manager.mailbox.write', resourceId: 'mb-1', database }).allowed, true);
    assert.equal(authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-1', database }).allowed, false);
});

test('resource grant allows only that mailbox and write implies read', () => {
    const database = dbWith({
        users: [{ id: 'ana', role: 'user' }],
        grants: [{ subjectType: 'user', subjectId: 'ana', permission: 'email-manager.mailbox.write', resourceId: 'mb-finance', effect: 'allow' }],
    });
    assert.equal(authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-finance', database }).allowed, true);
    assert.equal(authorize({ userId: 'ana', permission: 'email-manager.mailbox.write', resourceId: 'mb-other', database }).allowed, false);
});

test('group grants apply and an explicit denial wins over every allow', () => {
    const database = dbWith({
        users: [{ id: 'ana', role: 'user' }],
        memberships: [{ userId: 'ana', groupId: 'support' }],
        grants: [
            { subjectType: 'group', subjectId: 'support', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', effect: 'allow' },
            { subjectType: 'user', subjectId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', effect: 'deny' },
        ],
    });
    assert.equal(authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', database }).allowed, false);
    assert.deepEqual(permissionsForUser({ userId: 'ana', database }).groupIds, ['support']);
});

test('permission grants have a constrained globally reusable grammar', () => {
    assert.deepEqual(validateGrantInput({ subjectType: 'group', subjectId: 'finance', permission: 'email-manager.mailbox.read', resourceId: 'mb-1', effect: 'allow' }), {
        subjectType: 'group', subjectId: 'finance', permission: 'email-manager.mailbox.read', resourceId: 'mb-1', effect: 'allow',
    });
    assert.throws(() => validateGrantInput({ subjectType: 'user', subjectId: 'ana', permission: '../root', effect: 'allow' }), /invalid permission/i);
});

test('a package-declared group grants its current catalog permissions without persisted grants', () => {
    const database = dbWith({
        users: [{ id: 'ana', role: 'user' }],
        groups: [{ id: 'inbox-operator', declaredPackage: 'email-manager', declaredGroup: 'operator' }],
        memberships: [{ userId: 'ana', groupId: 'inbox-operator' }],
    });
    const catalog = { get: (packageName, definitionId) => packageName === 'email-manager' && definitionId === 'operator'
        ? { permissions: ['email-manager.mailbox.write'] }
        : null };
    const result = authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', database, catalog });
    assert.deepEqual(result, { allowed: true, reason: 'declared-group' });
    assert.deepEqual(permissionsForUser({ userId: 'ana', database, catalog }).grants, []);
});

test('explicit deny wins over a package-declared group and a removed definition grants nothing', () => {
    const database = dbWith({
        users: [{ id: 'ana', role: 'user' }],
        groups: [{ id: 'inbox-operator', declaredPackage: 'email-manager', declaredGroup: 'operator' }],
        memberships: [{ userId: 'ana', groupId: 'inbox-operator' }],
        grants: [{ subjectType: 'user', subjectId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', effect: 'deny' }],
    });
    const catalog = { get: () => ({ permissions: ['email-manager.mailbox.read'] }) };
    assert.deepEqual(authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', resourceId: 'mb-help', database, catalog }), {
        allowed: false, reason: 'explicit-deny',
    });
    assert.deepEqual(authorize({ userId: 'ana', permission: 'email-manager.mailbox.read', database, catalog: { get: () => null } }), {
        allowed: false, reason: 'no-grant',
    });
});
