import { getProxy } from 'logos';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import permissionService from '../permissions.cjs';
import permissionCatalogService from '../permission_catalog.cjs';
import { listLegacySystemTabs } from '../../settings/lib/tabs.js';
const { authorize, permissionsForUser, validateGrantInput } = permissionService;
const { createPermissionCatalog, listSelectablePermissions, validateDeclaredGroupInput } = permissionCatalogService;

export const permissionCatalog = createPermissionCatalog({ packagesDir: path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..') });

export function canManageAuth(db, user, permission) {
    return !!user && authorize({
        userId: user.id,
        permission,
        database: db,
        catalog: permissionCatalog,
    }).allowed;
}

function requireGlobalPermissionAdmin(req, permission) {
    const db = getProxy('auth');
    const actor = db.user[req.user?.id];
    if (!canManageAuth(db, actor, permission)) {
        const error = new Error('Only system administrators can manage global permissions.');
        error.status = 403;
        throw error;
    }
    return { db, actor };
}

export async function resolveRoleSelection(db, value) {
    const selection = String(value || '').trim();
    if (!selection) return { group: null };
    let group = null;
    if (selection.startsWith('group:')) {
        group = db.permissionGroup[selection.slice('group:'.length)];
    } else if (selection.startsWith('declared:')) {
        const [, packageName, declaredGroup] = selection.split(':');
        const definition = permissionCatalog.get(packageName, declaredGroup);
        if (!definition) return { error: 'The selected role is unavailable.' };
        group = (db.permissionGroup.query({ declaredPackage: packageName, declaredGroup }) || [])[0];
        if (!group) group = await db.permissionGroup.push({ name: definition.label, declaredPackage: packageName, declaredGroup });
    } else {
        return { error: 'The selected role is invalid.' };
    }
    return group ? { group } : { error: 'The selected role is unavailable.' };
}

export async function assignRoleSelections(db, userId, values) {
    const selections = [...new Set((Array.isArray(values) ? values : []).map((value) => String(value || '').trim()).filter(Boolean))];
    const groups = [];
    for (const selection of selections) {
        const resolved = await resolveRoleSelection(db, selection);
        if (resolved.error) return resolved;
        if (resolved.group) groups.push(resolved.group);
    }
    for (const membership of db.permissionMembership.query({ userId }) || []) await db.permissionMembership.delete(membership.id);
    for (const group of groups) await db.permissionMembership.push({ userId, groupId: group.id });
    return { groups };
}

async function auditPermissionChange(db, actorId, action, details = {}) {
    return db.permissionAudit.push({ actorId, action, ...details });
}

function registeredSystemTabs() {
    return listLegacySystemTabs();
}

export async function routerPermissionsOverview(req, res) {
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const grants = db.permissionGrant.query({}) || [];
    return {
        groups: db.permissionGroup.query({}) || [],
        memberships: db.permissionMembership.query({}) || [],
        grants,
        declaredGroups: permissionCatalog.list(),
        selectablePermissions: listSelectablePermissions({ catalog: permissionCatalog, grants }),
    };
}

export async function routerPermissionsCatalog(req, res) {
    requireGlobalPermissionAdmin(req, 'auth.access.read');
    return { groups: permissionCatalog.list() };
}

export async function routerPermissionsCreateGroup(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const declared = validateDeclaredGroupInput(req.body, permissionCatalog);
    const definition = declared.declaredPackage ? permissionCatalog.get(declared.declaredPackage, declared.declaredGroup) : null;
    const name = String(req.body?.name || definition?.label || '').trim();
    if (!name) return { status: 400, error: 'Group name is required.' };
    const group = await db.permissionGroup.push({ name, ...declared });
    await auditPermissionChange(db, actor.id, 'group.create', { subjectType: 'group', subjectId: group.id });
    return group;
}

export async function routerPermissionsUpdateGroup(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const group = db.permissionGroup[String(req.body?.id || '')];
    if (!group) return { status: 404, error: 'Group not found.' };
    if (group.declaredPackage) return { status: 400, error: 'Declared roles cannot be renamed.' };
    const name = String(req.body?.name || '').trim();
    if (!name) return { status: 400, error: 'Group name is required.' };
    group.name = name;
    await auditPermissionChange(db, actor.id, 'group.update', { subjectType: 'group', subjectId: group.id });
    return group;
}

export async function routerPermissionsDeleteGroup(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const group = db.permissionGroup[String(req.body?.id || '')];
    if (!group) return { status: 404, error: 'Group not found.' };
    if (group.declaredPackage) return { status: 400, error: 'Declared roles cannot be deleted.' };
    for (const membership of db.permissionMembership.query({ groupId: group.id }) || []) await db.permissionMembership.delete(membership.id);
    for (const grant of db.permissionGrant.query({ subjectType: 'group', subjectId: group.id }) || []) await db.permissionGrant.delete(grant.id);
    await db.permissionGroup.delete(group.id);
    await auditPermissionChange(db, actor.id, 'group.delete', { subjectType: 'group', subjectId: group.id });
    return { success: true };
}

export async function routerSystemTabs(req, res) {
    requireGlobalPermissionAdmin(req, 'auth.users.read');
    return { tabs: registeredSystemTabs() };
}

export async function routerPermissionsAddMember(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const userId = String(req.body?.userId || '');
    const groupId = String(req.body?.groupId || '');
    if (!db.user[userId] || !db.permissionGroup[groupId]) return { status: 404, error: 'User or group not found.' };
    const existing = (db.permissionMembership.query({ userId, groupId }) || [])[0];
    if (existing) return existing;
    const membership = await db.permissionMembership.push({ userId, groupId });
    await auditPermissionChange(db, actor.id, 'membership.create', { subjectType: 'user', subjectId: userId, resourceId: groupId });
    return membership;
}

export async function routerPermissionsDeleteMember(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const id = String(req.body?.id || '');
    const membership = db.permissionMembership[id];
    if (!membership) return { status: 404, error: 'Group membership not found.' };
    await db.permissionMembership.delete(membership.id);
    await auditPermissionChange(db, actor.id, 'membership.delete', {
        subjectType: 'user', subjectId: membership.userId, resourceId: membership.groupId,
    });
    return { success: true };
}

export async function routerPermissionsCreateGrant(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const grantInput = validateGrantInput(req.body);
    const subjectExists = grantInput.subjectType === 'user'
        ? db.user[grantInput.subjectId]
        : db.permissionGroup[grantInput.subjectId];
    if (!subjectExists) return { status: 404, error: 'Permission subject not found.' };
    const grant = await db.permissionGrant.push({ ...grantInput, createdById: actor.id });
    await auditPermissionChange(db, actor.id, 'grant.create', grantInput);
    return grant;
}

export async function routerPermissionsCreateFullPackageGrant(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const subjectType = String(req.body?.subjectType || '');
    const subjectId = String(req.body?.subjectId || '').trim();
    const packageName = String(req.body?.packageName || '').trim();
    const effect = String(req.body?.effect || 'allow');
    if (!['user', 'group'].includes(subjectType) || !subjectId || !['allow', 'deny'].includes(effect)) {
        return { status: 400, error: 'Invalid full package access request.' };
    }
    const subjectExists = subjectType === 'user' ? db.user[subjectId] : db.permissionGroup[subjectId];
    if (!subjectExists) return { status: 404, error: 'Permission subject not found.' };
    const permissions = [...new Set(permissionCatalog.list()
        .filter((definition) => definition.packageName === packageName)
        .flatMap((definition) => definition.permissions || []))];
    if (!permissions.length) return { status: 400, error: 'This package has no declared permissions.' };
    const existing = db.permissionGrant.query({ subjectType, subjectId }) || [];
    const existingKeys = new Set(existing.map((grant) => `${grant.permission}:${grant.resourceId || ''}:${grant.effect}`));
    const created = [];
    for (const permission of permissions) {
        if (existingKeys.has(`${permission}::${effect}`)) continue;
        created.push(await db.permissionGrant.push({ subjectType, subjectId, permission, resourceId: null, effect, createdById: actor.id }));
    }
    await auditPermissionChange(db, actor.id, 'grant.full-package', { subjectType, subjectId, packageName, effect });
    return { created: created.length, permissions };
}

export async function routerPermissionsDeleteGrant(req, res) {
    const { db, actor } = requireGlobalPermissionAdmin(req, 'auth.access.write');
    const id = String(req.body?.id || '');
    const grant = db.permissionGrant[id];
    if (!grant) return { status: 404, error: 'Permission not found.' };
    await db.permissionGrant.delete(id);
    await auditPermissionChange(db, actor.id, 'grant.delete', {
        subjectType: grant.subjectType, subjectId: grant.subjectId, permission: grant.permission, resourceId: grant.resourceId,
    });
    return { success: true };
}

export async function routerPermissionsForUser(req, res) {
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const userId = String(req.query?.userId || '');
    if (!db.user[userId]) return { status: 404, error: 'User not found.' };
    return permissionsForUser({ userId, database: db, catalog: permissionCatalog });
}

export async function routerPermissionsAudit(req, res) {
    const { db } = requireGlobalPermissionAdmin(req, 'auth.access.read');
    const limit = Math.min(Math.max(Number(req.query?.limit) || 30, 1), 100);
    return { entries: db.permissionAudit.query({}, { sort: 'createdAt DESC', limit }) || [] };
}
