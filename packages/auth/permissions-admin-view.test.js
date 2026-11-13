import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const root = new URL('.', import.meta.url);
const source = readFileSync(new URL('./index.js', root), 'utf8');
const view = readFileSync(new URL('./views/Index.svelte', root), 'utf8');
const schemaView = readFileSync(new URL('../ui-schema/views/AuthSurface.svelte', root), 'utf8');

test('permission administration exposes reversible membership removal and recent audit', () => {
    assert.match(source, /@register_router permissions\/memberships\/delete/);
    assert.match(source, /await db\.permissionMembership\.delete\(membership\.id\)/);
    assert.match(source, /'membership\.delete'/);
    assert.match(source, /@register_router permissions\/audit/);
    assert.match(source, /db\.permissionAudit\.query\(\{\}/);
});

test('access view presents a focused role workspace with custom role creation', () => {
    assert.match(view, /aria-label="Role management"/);
    assert.match(view, /<h2>Roles<\/h2>/);
    assert.match(view, /role-layout/);
    assert.match(view, /role-editor/);
    assert.match(view, /Search roles/);
    assert.match(view, /Package roles/);
    assert.match(view, /Recent activity/);
    assert.match(view, /\/auth\/permissions\/audit/);
    assert.match(view, /Create role/);
    assert.match(view, /<summary>Manage<\/summary>/);
    assert.doesNotMatch(view, /linear-gradient\(145deg, var\(--surface\), #151515\)/);
    assert.doesNotMatch(view, /#c6af78/);
    assert.match(view, /data-theme=\{theme\}/);
});

test('custom roles have a complete, reversible lifecycle', () => {
    assert.match(source, /@register_router permissions\/groups\/update/);
    assert.match(source, /@register_router permissions\/groups\/delete/);
    assert.match(source, /permissionMembership\.query\(\{ groupId: group\.id \}\)/);
    assert.match(source, /permissionGrant\.query\(\{ subjectType: 'group', subjectId: group\.id \}\)/);
    assert.match(view, />Save<\/button>/);
    assert.match(view, /Delete role/);
});

test('permission selectors offer full access for each package through a server-validated route', () => {
    assert.match(view, /<option value=\{`full:\$\{app\}`\}>Full Access<\/option>/);
    assert.match(view, /permissions\/grants\/full-package/);
    assert.match(source, /@register_router permissions\/grants\/full-package/);
    assert.match(source, /permissionCatalog\.list\(\)/);
});

test('system extensions use the manifest-backed tab protocol', () => {
    assert.match(source, /manifest\.systemTab/);
    assert.match(source, /@register_router system\/tabs/);
});

test('users are associated with roles and extra permissions without an account-type control', () => {
    assert.match(view, /roleSelections:groupsFor\(user\.id\)/);
    assert.match(view, /Roles<select multiple bind:value=\{editForm\.roleSelections\}>/);
    assert.match(view, /Roles and extra permissions/);
    assert.match(view, /Extra permissions/);
    assert.match(view, /rolesSummary\(user\)/);
    assert.doesNotMatch(view, /Account type<select/);
    assert.doesNotMatch(view, /tenant-|tenantStatus|tenantDomain/);
});

test('user role selectors use the full assignable catalog, independently of registration defaults', () => {
    assert.match(source, /assignableRoles: permissionCatalog\.list\(\)/);
    assert.match(view, /assignableRoles=data\.assignableRoles\|\|availableRoles/);
    assert.match(view, /roles=tab==="settings"\?availableRoles:assignableRoles/);
    assert.match(schemaView, /assignableRoles = Array\.isArray\(data\.assignableRoles\)/);
    assert.match(schemaView, /roleOptions = optionsFor\(assignableRoles\)/);
    assert.match(schemaView, /defaultRoleOptions = optionsFor\(availableRoles\)/);
    assert.match(schemaView, /declared:\$\{role\.packageName\}:\$\{role\.id\}/);
});

test('the users surface keeps the refreshed action state instead of restoring the stale input state', () => {
    assert.match(schemaView, /let data = \{\}, appliedState = null/);
    assert.match(schemaView, /state !== appliedState/);
    assert.match(schemaView, /data = result\.state \|\| data/);
    assert.doesNotMatch(schemaView, /state !== data/);
});

test('user updates accept the optional legacy account role without referencing an undeclared value', () => {
    assert.match(source, /const \{ userId, name, email, role, roleSelections, roleSelection/);
});

test('individual permissions remain secondary in the user editor and the system view has no cloud controls', () => {
    assert.match(view, /Package roles/);
    assert.match(view, /<details><summary>Extra permissions<\/summary>/);
    assert.match(view, /Allow registration/);
    assert.match(view, /Enable invitations/);
    assert.match(view, /\/auth\/settings/);
    assert.match(view, />Invitations<\/button>/);
    assert.match(view, /tab==="invitations"/);
    assert.match(view, /settings\.registrationEnabled&&settings\.invitationsEnabled/);
    assert.doesNotMatch(view, />Add user<\/button><\/nav>/);
    assert.doesNotMatch(view, /tenant-|tenantStatus|tenantDomain|\/cloud\//);
});

test('registration settings can select an available default role', () => {
    assert.match(source, /function canBeDefaultRegistrationRole/);
    assert.match(source, /defaultRoleGroupId/);
    assert.match(source, /resolveRoleSelection\(db, defaultRoleSelection\)/);
    assert.match(source, /permissionMembership\.push\(\{ userId: user\.id, groupId: group\.id \}\)/);
    assert.match(view, /Default role/);
    assert.match(view, /Default role for new registrations/);
    assert.match(view, /settings\.defaultRoleSelection/);
});
