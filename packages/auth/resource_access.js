import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import permissionService from './permissions.cjs';
import discoveryPermissions from './discovery_permissions.cjs';

const { authorize } = permissionService;
const { requiredViewPermission } = discoveryPermissions;
const packagesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewPath = /^\/view\/([^/]+)\/([A-Za-z][A-Za-z0-9_-]*)(?:\/|$)/;

// Resolve manifests from the runtime workspace, never from input supplied by a
// browser.  Package folders are the route identity used by Lógos; `name` is
// the namespace used by the permission declaration.
export function packageManifestForFolder(folder, { root = packagesDir } = {}) {
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(String(folder || ''))) return null;
  const file = path.join(root, folder, 'package.json');
  try {
    const manifest = JSON.parse(fs.readFileSync(file, 'utf8'));
    return { ...manifest, name: manifest.name || folder };
  } catch {
    return null;
  }
}

export function requiredViewPermissionForPath(requestPath, options) {
  const match = viewPath.exec(String(requestPath || '').split('?')[0]);
  if (!match) return null;
  const manifest = packageManifestForFolder(match[1], options);
  return manifest ? requiredViewPermission(manifest, match[2]) : null;
}

export function authorizeViewRequest({ requestPath, userId, database, catalog, root }) {
  const permission = requiredViewPermissionForPath(requestPath, { root });
  // A missing declaration never grants regular accounts access. Legacy
  // packages remain reachable by the administrator while every other user
  // needs an explicit view permission.
  if (!permission) {
    const user = database?.user?.[userId];
    return user?.role === 'admin'
      ? { allowed: true, permission: null, reason: 'admin-undeclared' }
      : { allowed: false, permission: null, reason: 'undeclared' };
  }
  const result = authorize({ userId, permission, database, catalog });
  return { ...result, permission };
}
