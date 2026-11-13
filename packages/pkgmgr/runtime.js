// Durable, filesystem-backed package state.  It deliberately does not talk to
// the Store or Lógos: resolution and live reload are separate transactions
// layered on top of these atomic local primitives.

import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, readlinkSync, renameSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { dirname, join, relative, resolve, sep } from 'node:path';

export const DEFAULT_RUNTIME_ROOT = '/app/data/runtime';

const INITIAL_MANIFEST = Object.freeze({ schemaVersion: 1, runtimeChannel: 'stable', packages: {} });
const INITIAL_LOCKFILE = Object.freeze({ schemaVersion: 1, generation: 0, packages: {} });
const PACKAGE_SEGMENT_RE = /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const PACKAGE_NAME_RE = /^(?:@[a-zA-Z0-9][a-zA-Z0-9._-]*\/)?[a-zA-Z0-9][a-zA-Z0-9._-]*$/;
const VERSION_RE = /^[0-9A-Za-z][0-9A-Za-z.+_-]*$/;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function atomicJson(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const temporary = `${path}.${randomUUID()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  renameSync(temporary, path);
}

function readJson(path, fallback) {
  if (!existsSync(path)) return clone(fallback);
  return JSON.parse(readFileSync(path, 'utf8'));
}

function assertSegment(value, pattern, label) {
  if (typeof value !== 'string' || !pattern.test(value) || value === '.' || value === '..') {
    throw new Error(`Expected a valid ${label}`);
  }
  return value;
}

function assertPackageName(value) {
  if (typeof value !== 'string' || !PACKAGE_NAME_RE.test(value)) throw new Error('Expected a valid package name');
  const parts = value.startsWith('@') ? value.slice(1).split('/') : [value];
  if (parts.length > 2 || parts.some((part) => !PACKAGE_SEGMENT_RE.test(part) || part === '.' || part === '..')) {
    throw new Error('Expected a valid package name');
  }
  return value;
}

/** Maps an npm name to safe nested runtime paths while retaining its identity. */
function packagePath(packageName) {
  const name = assertPackageName(packageName);
  return name.startsWith('@') ? name.slice(1).split('/') : [name];
}

function assertInside(base, candidate) {
  const resolved = resolve(candidate);
  const rel = relative(base, resolved);
  if (rel.startsWith(`..${sep}`) || rel === '..' || resolve(base) === resolved) {
    throw new Error('Runtime path escapes its root');
  }
  return resolved;
}

function lockFingerprint(lockfile) {
  const canonical = { ...lockfile, fingerprint: undefined };
  return `sha256:${createHash('sha256').update(JSON.stringify(canonical)).digest('hex')}`;
}

function validateManifest(manifest) {
  if (!manifest || manifest.schemaVersion !== 1 || typeof manifest.packages !== 'object' || Array.isArray(manifest.packages)) {
    throw new Error('Expected a runtime manifest with schemaVersion 1 and a packages object');
  }
  for (const [packageName, desired] of Object.entries(manifest.packages)) {
    assertPackageName(packageName);
    if (!desired || typeof desired !== 'object') throw new Error(`Expected a desired release for ${packageName}`);
    assertSegment(desired.version, VERSION_RE, 'package version');
    if (typeof desired.source !== 'string' || !desired.source) throw new Error(`Expected a source for ${packageName}`);
  }
  return manifest;
}

export function createPackageRuntime({ root = DEFAULT_RUNTIME_ROOT } = {}) {
  const runtimeRoot = resolve(root);
  const paths = {
    root: runtimeRoot,
    manifest: join(runtimeRoot, 'manifest.json'),
    lockfile: join(runtimeRoot, 'packages.lock.json'),
    transactions: join(runtimeRoot, 'transactions'),
    releases: join(runtimeRoot, 'releases'),
    active: join(runtimeRoot, 'active'),
    rollback: join(runtimeRoot, 'rollback'),
    state: join(runtimeRoot, 'state'),
  };

  function transactionPath(id) {
    return assertInside(paths.transactions, join(paths.transactions, assertSegment(id, PACKAGE_NAME_RE, 'transaction id')));
  }

  function writeTransaction(transaction) {
    atomicJson(join(transactionPath(transaction.id), 'transaction.json'), transaction);
    return transaction;
  }

  function readTransaction(id) {
    const path = join(transactionPath(id), 'transaction.json');
    if (!existsSync(path)) throw new Error(`Unknown package transaction "${id}"`);
    return readJson(path, {});
  }

  function releasePath(packageName, version) {
    const name = assertPackageName(packageName);
    const releaseVersion = assertSegment(version, VERSION_RE, 'package version');
    return assertInside(paths.releases, join(paths.releases, ...packagePath(name), releaseVersion));
  }

  function writeLockfile(lockfile) {
    const next = { ...lockfile, fingerprint: lockFingerprint(lockfile) };
    atomicJson(paths.lockfile, next);
    return next;
  }

  return {
    paths: Object.freeze(paths),

    makeDirectory(path) { mkdirSync(path, { recursive: true }); },

    initialize() {
      for (const path of Object.values(paths)) {
        if (path !== paths.manifest && path !== paths.lockfile) mkdirSync(path, { recursive: true });
      }
      if (!existsSync(paths.manifest)) atomicJson(paths.manifest, INITIAL_MANIFEST);
      if (!existsSync(paths.lockfile)) writeLockfile(INITIAL_LOCKFILE);
      return { manifest: this.readManifest(), lockfile: this.readLockfile() };
    },

    readManifest() { return readJson(paths.manifest, INITIAL_MANIFEST); },
    readLockfile() { return readJson(paths.lockfile, INITIAL_LOCKFILE); },
    writeManifest(manifest) { validateManifest(manifest); atomicJson(paths.manifest, manifest); return this.readManifest(); },
    readTransaction,

    beginTransaction({ operation, packageName, version }) {
      if (!['install', 'update', 'remove', 'rollback'].includes(operation)) throw new Error('Expected a supported package operation');
      assertPackageName(packageName);
      assertSegment(version, VERSION_RE, 'package version');
      const transaction = {
        id: randomUUID(), operation, packageName, version, state: 'prepared',
        createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      };
      mkdirSync(transactionPath(transaction.id), { recursive: true });
      return writeTransaction(transaction);
    },

    stageRelease(id, source) {
      const transaction = readTransaction(id);
      if (transaction.state !== 'prepared') throw new Error(`Transaction "${id}" cannot be staged from ${transaction.state}`);
      const sourcePath = resolve(source);
      if (!existsSync(join(sourcePath, 'package.json'))) throw new Error('A staged release must contain package.json');
      const staged = join(transactionPath(id), 'staging');
      rmSync(staged, { recursive: true, force: true });
      cpSync(sourcePath, staged, { recursive: true, dereference: false, errorOnExist: true });
      const packageJson = readJson(join(staged, 'package.json'), {});
      if (packageJson.name !== transaction.packageName || packageJson.version !== transaction.version) {
        rmSync(staged, { recursive: true, force: true });
        throw new Error('Staged package identity does not match its transaction');
      }
      writeTransaction({ ...transaction, state: 'staged', stagedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
      return staged;
    },

    promoteRelease(id, { checksum = null, capabilitiesDigest = null } = {}) {
      const transaction = readTransaction(id);
      if (transaction.state !== 'staged') throw new Error(`Transaction "${id}" cannot be promoted from ${transaction.state}`);
      const staged = join(transactionPath(id), 'staging');
      if (!existsSync(join(staged, 'package.json'))) throw new Error('Transaction staging area is missing');
      const destination = releasePath(transaction.packageName, transaction.version);
      mkdirSync(dirname(destination), { recursive: true });
      if (existsSync(destination)) throw new Error(`Release ${transaction.packageName}@${transaction.version} already exists`);
      const activeLink = assertInside(paths.active, join(paths.active, ...packagePath(transaction.packageName)));
      const previousActiveTarget = existsSync(activeLink) ? readlinkSync(activeLink) : null;
      writeTransaction({
        ...transaction,
        state: 'activating',
        destination,
        removeDestinationOnRecovery: true,
        previousActiveTarget,
        updatedAt: new Date().toISOString(),
      });
      renameSync(staged, destination);

      const temporaryLink = `${activeLink}.${transaction.id}.tmp`;
      mkdirSync(dirname(activeLink), { recursive: true });
      rmSync(temporaryLink, { force: true });
      symlinkSync(relative(dirname(activeLink), destination), temporaryLink, 'dir');
      renameSync(temporaryLink, activeLink);

      const current = this.readLockfile();
      const packages = { ...current.packages, [transaction.packageName]: {
        version: transaction.version, checksum, capabilitiesDigest, installedAt: new Date().toISOString(), source: 'registry',
      } };
      writeLockfile({ ...current, generation: current.generation + 1, packages, appliedAt: new Date().toISOString() });
      return writeTransaction({ ...transaction, state: 'promoted', promotedAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    },

    rollbackRelease({ packageName, version }) {
      const name = assertPackageName(packageName);
      const releaseVersion = assertSegment(version, VERSION_RE, 'package version');
      const destination = releasePath(name, releaseVersion);
      const packageJson = readJson(join(destination, 'package.json'), {});
      if (packageJson.name !== name || packageJson.version !== releaseVersion) {
        throw new Error(`No retained release ${name}@${releaseVersion} is available for rollback`);
      }
      const transaction = this.beginTransaction({ operation: 'rollback', packageName: name, version: releaseVersion });
      const activeLink = assertInside(paths.active, join(paths.active, ...packagePath(name)));
      const previousActiveTarget = existsSync(activeLink) ? readlinkSync(activeLink) : null;
      writeTransaction({
        ...transaction,
        state: 'activating',
        destination,
        removeDestinationOnRecovery: false,
        previousActiveTarget,
        updatedAt: new Date().toISOString(),
      });

      const temporaryLink = `${activeLink}.${transaction.id}.tmp`;
      mkdirSync(dirname(activeLink), { recursive: true });
      rmSync(temporaryLink, { force: true });
      symlinkSync(relative(dirname(activeLink), destination), temporaryLink, 'dir');
      renameSync(temporaryLink, activeLink);

      const current = this.readLockfile();
      const previous = current.packages[name] ?? {};
      const packages = { ...current.packages, [name]: {
        ...previous,
        version: releaseVersion,
        source: 'runtime-rollback',
        rolledBackAt: new Date().toISOString(),
      } };
      writeLockfile({ ...current, generation: current.generation + 1, packages, appliedAt: new Date().toISOString() });
      return writeTransaction({ ...this.readTransaction(transaction.id), state: 'rolled_back', rolledBackAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    },

    reconcile({ resolveRelease, workspacePackagesDir = null, reload = null } = {}) {
      const manifest = validateManifest(this.readManifest());
      const current = this.readLockfile();
      const changed = [];
      const unchanged = [];
      const removed = [];
      const workspace = workspacePackagesDir ? resolve(workspacePackagesDir) : null;
      if (workspace) mkdirSync(workspace, { recursive: true });

      for (const [packageName, desired] of Object.entries(manifest.packages)) {
        const applied = current.packages[packageName];
        if (workspace) this.assertWorkspaceSlot(packageName, workspace);
        if (applied?.version === desired.version && existsSync(releasePath(packageName, desired.version))) {
          if (workspace) this.materializePackage(packageName, workspace);
          unchanged.push(packageName);
          continue;
        }
        if (typeof resolveRelease !== 'function') throw new Error(`A release resolver is required for ${packageName}`);
        const resolved = resolveRelease({ packageName, ...desired });
        if (!resolved?.source) throw new Error(`Resolver returned no source for ${packageName}`);
        const transaction = this.beginTransaction({ operation: applied ? 'update' : 'install', packageName, version: desired.version });
        this.stageRelease(transaction.id, resolved.source);
        this.promoteRelease(transaction.id, {
          checksum: resolved.checksum ?? desired.checksum ?? null,
          capabilitiesDigest: resolved.capabilitiesDigest ?? desired.capabilitiesDigest ?? null,
        });
        if (workspace) this.materializePackage(packageName, workspace);
        changed.push(packageName);
        if (typeof reload === 'function') reload({ packageName, action: 'changed' });
      }

      for (const packageName of Object.keys(current.packages)) {
        if (manifest.packages[packageName]) continue;
        if (workspace) this.unmaterializePackage(packageName, workspace);
        const activeLink = assertInside(paths.active, join(paths.active, ...packagePath(packageName)));
        try {
          if (!lstatSync(activeLink).isSymbolicLink()) throw new Error(`Refusing to remove an invalid active release for ${packageName}`);
          rmSync(activeLink, { force: true });
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        const latest = this.readLockfile();
        const packages = { ...latest.packages };
        delete packages[packageName];
        writeLockfile({ ...latest, generation: latest.generation + 1, packages, appliedAt: new Date().toISOString() });
        removed.push(packageName);
        if (typeof reload === 'function') reload({ packageName, action: 'removed' });
      }
      return { changed, removed, unchanged };
    },

    materializePackage(packageName, workspacePackagesDir) {
      const name = assertPackageName(packageName);
      const workspace = resolve(workspacePackagesDir);
      const link = assertInside(workspace, join(workspace, ...packagePath(name)));
      const target = assertInside(paths.active, join(paths.active, ...packagePath(name)));
      if (!existsSync(target)) throw new Error(`No active release exists for ${name}`);
      this.assertWorkspaceSlot(name, workspace);
      if (existsSync(link) || (() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) return link;
      mkdirSync(dirname(link), { recursive: true });
      symlinkSync(relative(dirname(link), target), link, 'dir');
      return link;
    },

    assertWorkspaceSlot(packageName, workspacePackagesDir) {
      const name = assertPackageName(packageName);
      const workspace = resolve(workspacePackagesDir);
      const link = assertInside(workspace, join(workspace, ...packagePath(name)));
      const target = assertInside(paths.active, join(paths.active, ...packagePath(name)));
      if (existsSync(link) || (() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) {
        let managed = false;
        try { managed = lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === target; } catch { /* handled below */ }
        if (managed) return true;
        throw new Error(`Refusing to replace unmanaged Lógos package "${name}"`);
      }
      return false;
    },

    unmaterializePackage(packageName, workspacePackagesDir) {
      const name = assertPackageName(packageName);
      const workspace = resolve(workspacePackagesDir);
      const link = assertInside(workspace, join(workspace, ...packagePath(name)));
      if (!existsSync(link) && !(() => { try { return lstatSync(link).isSymbolicLink(); } catch { return false; } })()) return false;
      const target = assertInside(paths.active, join(paths.active, ...packagePath(name)));
      let managed = false;
      try { managed = lstatSync(link).isSymbolicLink() && resolve(dirname(link), readlinkSync(link)) === target; } catch { /* handled below */ }
      if (!managed) throw new Error(`Refusing to remove unmanaged Lógos package "${name}"`);
      rmSync(link, { force: true });
      return true;
    },

    recoverTransactions() {
      if (!existsSync(paths.transactions)) return [];
      const recovered = [];
      for (const entry of readdirSync(paths.transactions, { withFileTypes: true })) {
        if (!entry.isDirectory()) continue;
        const transactionFile = join(paths.transactions, entry.name, 'transaction.json');
        if (!existsSync(transactionFile)) continue;
        const transaction = readJson(transactionFile, {});
        if (!['prepared', 'staged', 'activating'].includes(transaction.state)) continue;
        const staged = join(paths.transactions, entry.name, 'staging');
        rmSync(staged, { recursive: true, force: true });
        if (transaction.state === 'activating') {
          const activeLink = assertInside(paths.active, join(paths.active, ...packagePath(transaction.packageName)));
          rmSync(activeLink, { recursive: true, force: true });
          if (transaction.previousActiveTarget) symlinkSync(transaction.previousActiveTarget, activeLink, 'dir');
          if (transaction.removeDestinationOnRecovery !== false && transaction.destination) {
            rmSync(assertInside(paths.releases, transaction.destination), { recursive: true, force: true });
          }
        }
        writeTransaction({ ...transaction, state: 'abandoned', recoveredAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
        recovered.push({ id: transaction.id, action: 'abandoned' });
      }
      return recovered;
    },
  };
}
