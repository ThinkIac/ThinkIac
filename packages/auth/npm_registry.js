const SCOPED_NAME = /^@([a-z0-9][a-z0-9-]{1,61}[a-z0-9])\/([a-z0-9][a-z0-9._-]*)$/i;
const UN_SCOPED_NAME = /^[a-z0-9][a-z0-9._-]*$/i;

export function packageVisibility(value) {
  return value === 'public' ? 'public' : 'private';
}

export function normalizeNpmPackage({ name, owner, visibility = 'private', official = false }) {
  const rawName = String(name || '').trim();
  const match = SCOPED_NAME.exec(rawName);
  const normalizedOwner = String(owner || '').trim().toLowerCase();
  if (official === true && normalizedOwner && UN_SCOPED_NAME.test(rawName)) {
    return { name: rawName.toLowerCase(), owner: normalizedOwner, visibility: 'public', official: true };
  }
  if (!match || !normalizedOwner || match[1].toLowerCase() !== normalizedOwner) {
    throw new Error('O pacote precisa pertencer ao seu workspace pessoal (@usuário/nome).');
  }
  return { name: `@${match[1].toLowerCase()}/${match[2].toLowerCase()}`, owner: normalizedOwner, visibility: packageVisibility(visibility) };
}

export function canReadNpmPackage(record, username) {
  if (!record || packageVisibility(record.visibility) === 'public') return true;
  return String(record.owner || '').toLowerCase() === String(username || '').toLowerCase();
}

/** Public, credential-free index used to keep npm upstream cache out of the UI. */
export function npmPublicCatalog(records = []) {
  return records
    .filter(record => record && (record.official === true || packageVisibility(record.visibility) === 'public'))
    .map(record => ({ name: record.name, official: record.official === true }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Catalog safe for a signed-in workspace: public releases plus that
 * workspace's private releases. It deliberately omits owner and visibility
 * metadata, so the catalog cannot disclose other private workspaces.
 */
export function npmReadableCatalog(records = [], username) {
  const normalizedUsername = String(username || '').trim().toLowerCase();
  return records
    .filter(record => canReadNpmPackage(record, username))
    .map(record => {
      const owned = String(record?.owner || '').toLowerCase() === normalizedUsername;
      return {
        name: record.name,
        official: record.official === true,
        owned,
        ...(owned ? { visibility: packageVisibility(record.visibility) } : {}),
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Safe, token-free data for the package manager's workspace panel. */
export function npmWorkspaceSummary(user, records = []) {
  const username = String(user?.username || '').trim().toLowerCase();
  if (!username) return { authenticated: false, workspace: null, packages: [] };
  const packages = records
    .filter(record => String(record?.owner || '').toLowerCase() === username)
    .map(record => ({ name: record.name, visibility: packageVisibility(record.visibility) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { authenticated: true, workspace: `@${username}`, packages };
}
