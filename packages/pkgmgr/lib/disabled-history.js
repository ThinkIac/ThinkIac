import { createHash, randomUUID } from 'crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'fs';
import { join, resolve, sep } from 'path';

function inside(base, ...parts) {
  const value = resolve(base, ...parts);
  if (value !== base && !value.startsWith(base + sep)) throw new Error('Resolved path escapes disabled package history');
  return value;
}

function manifestAt(path) {
  try { return JSON.parse(readFileSync(join(path, 'package.json'), 'utf8')); } catch { return null; }
}

function digestDirectory(path) {
  const hash = createHash('sha256');
  const visit = (current, relative = '') => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      if (entry.name === '.git') continue;
      const next = join(current, entry.name);
      const name = `${relative}${entry.name}`;
      if (entry.isDirectory()) visit(next, `${name}/`);
      else if (entry.isFile()) {
        hash.update(`file:${name}:`);
        hash.update(readFileSync(next));
      }
    }
  };
  visit(path);
  return `sha256:${hash.digest('hex')}`;
}

function readState(packageDir) {
  try {
    const parsed = JSON.parse(readFileSync(join(packageDir, 'state.json'), 'utf8'));
    return Array.isArray(parsed.entries) ? parsed : { schemaVersion: 1, entries: [] };
  } catch { return { schemaVersion: 1, entries: [] }; }
}

function writeState(packageDir, state) {
  writeFileSync(join(packageDir, 'state.json'), `${JSON.stringify(state, null, 2)}\n`);
}

function versionFolder(version, suffix = '') {
  return `${String(version || '0.0.0').replace(/[^a-zA-Z0-9._-]/g, '_')}${suffix}`;
}

/** A filesystem-backed archive that keeps all disabled releases of a package. */
export function createDisabledHistory({ disabledDir, now = () => new Date().toISOString(), id = randomUUID } = {}) {
  if (!disabledDir) throw new Error('disabledDir is required');

  const packageDir = name => inside(disabledDir, name);

  function migrateLegacy(name) {
    const root = packageDir(name);
    if (!existsSync(join(root, 'package.json'))) return;
    const manifest = manifestAt(root) || {};
    const temporary = inside(disabledDir, `.pkgmgr-legacy-${id()}`);
    renameSync(root, temporary);
    mkdirSync(root, { recursive: true });
    const version = versionFolder(manifest.version);
    renameSync(temporary, inside(root, version));
    const checksum = digestDirectory(inside(root, version));
    writeState(root, { schemaVersion: 1, entries: [{ version: manifest.version || '', folder: version, checksum, disabledAt: now(), legacy: true }] });
  }

  function list(name) {
    const root = packageDir(name);
    if (!existsSync(root)) return [];
    migrateLegacy(name);
    const state = readState(root);
    return state.entries
      .filter(entry => existsSync(inside(root, entry.folder, 'package.json')))
      .map(entry => ({ ...entry, manifest: manifestAt(inside(root, entry.folder)) || {} }));
  }

  function archive(name, source) {
    mkdirSync(disabledDir, { recursive: true });
    const root = packageDir(name);
    if (existsSync(root)) migrateLegacy(name);
    mkdirSync(root, { recursive: true });
    const manifest = manifestAt(source);
    if (!manifest) throw new Error(`Package "${name}" has no valid package.json`);
    const checksum = digestDirectory(source);
    const state = readState(root);
    const base = versionFolder(manifest.version);
    let folder = base;
    const same = state.entries.find(entry => entry.checksum === checksum);
    if (same) folder = versionFolder(manifest.version, `--duplicate-${id().slice(0, 8)}`);
    while (existsSync(inside(root, folder))) folder = versionFolder(manifest.version, `--conflict-${id().slice(0, 8)}`);
    const destination = inside(root, folder);
    renameSync(source, destination);
    const entry = { version: manifest.version || '', folder, checksum, disabledAt: now(), conflict: !same && folder !== base, duplicateOf: same?.folder || null };
    state.entries.push(entry);
    try {
      writeState(root, state);
    } catch (error) {
      renameSync(destination, source);
      throw error;
    }
    return { entry, duplicate: false };
  }

  function restore(name, version, destination) {
    const candidates = list(name);
    const selected = version
      ? candidates.find(entry => entry.folder === version || entry.version === version)
      : candidates.length === 1 ? candidates[0] : null;
    if (!selected) {
      if (candidates.length > 1 && !version) throw new Error(`Package "${name}" has multiple disabled versions; choose one explicitly`);
      throw new Error(`Disabled version "${version || ''}" for package "${name}" was not found`);
    }
    if (existsSync(destination)) throw new Error(`An active package named "${name}" already exists — disable it first`);
    const root = packageDir(name);
    const source = inside(root, selected.folder);
    renameSync(source, destination);
    const state = readState(root);
    state.entries = state.entries.filter(entry => entry.folder !== selected.folder);
    try {
      writeState(root, state);
    } catch (error) {
      renameSync(destination, source);
      throw error;
    }
    return selected;
  }

  return { archive, list, restore };
}
