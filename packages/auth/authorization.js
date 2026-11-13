import { getProxy } from 'logos';
import permissionService from './permissions.cjs';
import permissionCatalogService from './permission_catalog.cjs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const { authorize } = permissionService;
const { createPermissionCatalog } = permissionCatalogService;
const packagesDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const permissionCatalog = createPermissionCatalog({ packagesDir });

/**
 * Contrato de autorização para pacotes do Runtime.
 *
 * A identidade é obtida pelo accessGate e o Auth continua sendo a única
 * autoridade para grants, grupos declarados e negações explícitas.
 */
export function authorizeRequest(req, permission, resourceId = null, {
  database = getProxy('auth'),
  catalog = permissionCatalog,
} = {}) {
  const userId = req?.principal?.subject ?? req?.user?.id;
  if (!userId) return { allowed: false, status: 401, reason: 'unauthenticated' };
  const result = authorize({ userId, permission, resourceId, database, catalog });
  return { ...result, status: result.allowed ? 200 : 403 };
}

export function requirePermission(req, permission, resourceId = null, options) {
  const result = authorizeRequest(req, permission, resourceId, options);
  if (result.allowed) return result;
  const error = new Error(result.status === 401 ? 'Login required.' : 'Permission denied.');
  error.status = result.status;
  error.permission = permission;
  error.reason = result.reason;
  throw error;
}
