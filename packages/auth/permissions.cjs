'use strict';

// Autoridade global de permissões. Pacotes consumidores só enviam o sujeito,
// a ação e, opcionalmente, a instância concreta do recurso.
const PERMISSION_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,}$/;
const SUBJECT_TYPES = new Set(['user', 'group']);
const EFFECTS = new Set(['allow', 'deny']);
const { defaultPermissionCatalog } = require('./permission_catalog.cjs');

function rows(table, where = {}) {
  return table?.query ? (table.query(where) || []) : [];
}

function readPermissionVariants(permission) {
  const values = [permission];
  if (permission.endsWith('.read')) values.push(`${permission.slice(0, -5)}.write`);
  return values;
}

function permissionsForUser({ userId, database, catalog = defaultPermissionCatalog }) {
  const memberships = rows(database.permissionMembership, { userId });
  const groupIds = [...new Set(memberships.map((membership) => membership.groupId).filter(Boolean))].sort();
  const direct = rows(database.permissionGrant, { subjectType: 'user', subjectId: userId });
  const grouped = groupIds.flatMap((groupId) => rows(database.permissionGrant, { subjectType: 'group', subjectId: groupId }));
  const declaredGroups = groupIds.flatMap((groupId) => {
    const group = rows(database.permissionGroup, { id: groupId })[0];
    if (!group?.declaredPackage || !group?.declaredGroup) return [];
    const definition = catalog?.get(group.declaredPackage, group.declaredGroup);
    return definition ? [{ groupId, ...definition }] : [];
  });
  return { groupIds, grants: [...direct, ...grouped], declaredGroups };
}

function authorize({ userId, permission, resourceId = null, database, catalog = defaultPermissionCatalog }) {
  const user = database?.user?.[userId];
  if (!userId || !user || user.disabled || !PERMISSION_RE.test(String(permission))) return { allowed: false, reason: 'invalid-subject-or-permission' };
  if (user.role === 'admin') return { allowed: true, reason: 'admin' };

  const { grants, declaredGroups } = permissionsForUser({ userId, database, catalog });
  const permissionVariants = readPermissionVariants(permission);
  const relevant = grants.filter((grant) => permissionVariants.includes(grant.permission)
    && (grant.resourceId == null || grant.resourceId === '' || grant.resourceId === '*' || grant.resourceId === resourceId));
  if (relevant.some((grant) => grant.effect === 'deny')) return { allowed: false, reason: 'explicit-deny' };
  if (relevant.some((grant) => grant.effect === 'allow')) return { allowed: true, reason: 'grant' };
  return declaredGroups.some((group) => group.permissions.some((granted) => permissionVariants.includes(granted)))
    ? { allowed: true, reason: 'declared-group' }
    : { allowed: false, reason: 'no-grant' };
}

function validateGrantInput(input = {}) {
  const subjectType = String(input.subjectType || '');
  const subjectId = String(input.subjectId || '').trim();
  const permission = String(input.permission || '').trim();
  const resourceId = input.resourceId == null || input.resourceId === '' ? null : String(input.resourceId);
  const effect = String(input.effect || 'allow');
  if (!SUBJECT_TYPES.has(subjectType)) throw new Error('Invalid subject type.');
  if (!subjectId) throw new Error('Subject is required.');
  if (!PERMISSION_RE.test(permission)) throw new Error('Invalid permission.');
  if (!EFFECTS.has(effect)) throw new Error('Invalid effect.');
  return { subjectType, subjectId, permission, resourceId, effect };
}

module.exports = { authorize, permissionsForUser, validateGrantInput };
