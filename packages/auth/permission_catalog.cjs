'use strict';

const fs = require('node:fs');
const path = require('node:path');

const PACKAGE_RE = /^[a-z][a-z0-9-]*$/;
const GROUP_RE = /^[a-z][a-z0-9-]*$/;
const PERMISSION_RE = /^[a-z][a-z0-9-]*(?:\.[a-z][a-z0-9-]*){1,}$/;
const DEFAULT_PACKAGES_DIR = path.resolve(__dirname, '..');

function normalizeDefinition(packageName, definition, packageLabel = packageName) {
  if (!definition || typeof definition !== 'object') return null;
  const id = String(definition.id || '').trim();
  const permissions = [...new Set((Array.isArray(definition.permissions) ? definition.permissions : [])
    .map((permission) => String(permission || '').trim())
    .filter((permission) => PERMISSION_RE.test(permission) && permission.startsWith(`${packageName}.`)))];
  if (!PACKAGE_RE.test(packageName) || !GROUP_RE.test(id) || permissions.length === 0) return null;
  const label = String(definition.label || id).trim() || id;
  return { packageName, packageLabel: String(packageLabel || packageName).trim() || packageName, id, label, permissions };
}

function createPermissionCatalog({ packagesDir = DEFAULT_PACKAGES_DIR } = {}) {
  function list() {
    let entries = [];
    try { entries = fs.readdirSync(packagesDir, { withFileTypes: true }); } catch { return []; }
    const definitions = [];
    for (const entry of entries.filter((item) => item.isDirectory()).sort((a, b) => a.name.localeCompare(b.name))) {
      try {
        const manifest = JSON.parse(fs.readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8'));
        const packageName = String(manifest.name || '');
        if (!PACKAGE_RE.test(packageName) || !Array.isArray(manifest.manifest?.permissionGroups)) continue;
        for (const definition of manifest.manifest.permissionGroups) {
          const normalized = normalizeDefinition(packageName, definition, manifest.manifest?.name);
          if (normalized) definitions.push(normalized);
        }
      } catch {
        // Um manifest ausente ou inválido não pode abrir permissões.
      }
    }
    return definitions;
  }

  function get(packageName, definitionId) {
    return list().find((definition) => definition.packageName === packageName && definition.id === definitionId) || null;
  }

  return { list, get };
}

function permissionParts(permission) {
  const parts = String(permission || '').split('.');
  return {
    permission,
    packageName: parts[0],
    resource: parts.slice(1, -1).join('.'),
    action: parts.at(-1),
  };
}

// O catálogo de escolha é informativo: não muda a validação de um grant nem
// torna uma permissão legada inválida. Assim, uma permissão já atribuída antes
// de um pacote declarar seu manifesto continua administrável pela interface.
function listSelectablePermissions({ catalog = defaultPermissionCatalog, grants = [] } = {}) {
  const sourcesByPermission = new Map();
  const add = (permission, source) => {
    if (!PERMISSION_RE.test(String(permission || ''))) return;
    const sources = sourcesByPermission.get(permission) || [];
    if (!sources.includes(source)) sources.push(source);
    sourcesByPermission.set(permission, sources);
  };

  for (const definition of catalog?.list?.() || []) {
    for (const permission of definition.permissions || []) add(permission, 'declared');
  }
  for (const grant of grants || []) add(String(grant?.permission || ''), 'historical');

  return [...sourcesByPermission.entries()].map(([permission, sources]) => ({
    ...permissionParts(permission), sources,
  }));
}

function validateDeclaredGroupInput(input = {}, catalog = defaultPermissionCatalog) {
  const declaredPackage = String(input.declaredPackage || '').trim();
  const declaredGroup = String(input.declaredGroup || '').trim();
  if (!declaredPackage && !declaredGroup) return { declaredPackage: null, declaredGroup: null };
  if (!PACKAGE_RE.test(declaredPackage) || !GROUP_RE.test(declaredGroup) || !catalog?.get(declaredPackage, declaredGroup)) {
    throw new Error('The declared group definition is invalid or unavailable.');
  }
  return { declaredPackage, declaredGroup };
}

const defaultPermissionCatalog = createPermissionCatalog();

module.exports = {
  createPermissionCatalog,
  defaultPermissionCatalog,
  listSelectablePermissions,
  validateDeclaredGroupInput,
};
