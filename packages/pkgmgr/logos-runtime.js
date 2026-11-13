// Adapter for the Lógos stabilizer. The durable runtime stays framework-free;
// this file is the only place where an applied release becomes visible to a
// running Lógos workspace.

import { existsSync, writeFileSync } from 'node:fs';
import { join, resolve, relative, sep } from 'node:path';
import { createPackageRuntime, DEFAULT_RUNTIME_ROOT } from './runtime.js';

function packagePath(packagesDir, packageName) {
  const root = resolve(packagesDir);
  const candidate = resolve(root, packageName);
  if (!candidate.startsWith(`${root}${sep}`)) throw new Error('Package path escapes the Lógos workspace');
  return candidate;
}

/**
 * Lógos' documented explicit-reload protocol is a `.commit` marker in the
 * package directory. It lets the stabilizer validate and atomically swap the
 * changed package instead of restarting the Node process.
 */
export function createLogosReloadCallback({ packagesDir }) {
  const root = resolve(packagesDir);
  return ({ packageName, action }) => {
    const path = packagePath(root, packageName);
    if (action === 'removed') return { packageName, action, requested: false };
    if (!existsSync(path)) throw new Error(`Managed Lógos package "${packageName}" is not materialized`);
    writeFileSync(join(path, '.commit'), `${new Date().toISOString()}\n`, 'utf8');
    return { packageName, action, requested: true, marker: relative(root, join(path, '.commit')) };
  };
}

/** Creates the production-facing runtime with recovery and Lógos wiring. */
export function createManagedPackageRuntime({ root = DEFAULT_RUNTIME_ROOT, packagesDir }) {
  const runtime = createPackageRuntime({ root });
  runtime.initialize();
  const recovered = runtime.recoverTransactions();
  const reload = createLogosReloadCallback({ packagesDir });
  function desiredRelease({ packageName, version, source, checksum = null, capabilitiesDigest = null }) {
    if (typeof source !== 'string' || !source) throw new Error('A package release source is required');
    return { packageName, version, source, checksum, capabilitiesDigest };
  }

  function setDesiredRelease(release, { mustExist }) {
    const manifest = runtime.readManifest();
    const exists = Boolean(manifest.packages[release.packageName]);
    if (mustExist && !exists) throw new Error(`Cannot update unmanaged package "${release.packageName}"`);
    if (!mustExist && exists) throw new Error(`Package "${release.packageName}" is already managed; use update`);
    runtime.writeManifest({
      ...manifest,
      packages: {
        ...manifest.packages,
        [release.packageName]: {
          version: release.version,
          source: 'managed-runtime',
          checksum: release.checksum,
          capabilitiesDigest: release.capabilitiesDigest,
        },
      },
    });
  }

  function reconcileRelease(release) {
    return runtime.reconcile({
      workspacePackagesDir: packagesDir,
      reload,
      resolveRelease: ({ packageName, version }) => {
        if (packageName !== release.packageName || version !== release.version) throw new Error('Release resolver received an unexpected package');
        return release;
      },
    });
  }
  return {
    runtime,
    recovered,
    reconcile(options = {}) {
      return runtime.reconcile({ ...options, workspacePackagesDir: packagesDir, reload });
    },
    install(input) {
      const release = desiredRelease(input);
      setDesiredRelease(release, { mustExist: false });
      return reconcileRelease(release);
    },
    update(input) {
      const release = desiredRelease(input);
      setDesiredRelease(release, { mustExist: true });
      return reconcileRelease(release);
    },
    remove({ packageName }) {
      const manifest = runtime.readManifest();
      if (!manifest.packages[packageName]) throw new Error(`Cannot remove unmanaged package "${packageName}"`);
      const packages = { ...manifest.packages };
      delete packages[packageName];
      runtime.writeManifest({ ...manifest, packages });
      return runtime.reconcile({ workspacePackagesDir: packagesDir, reload });
    },
    rollback({ packageName, version }) {
      const manifest = runtime.readManifest();
      if (!manifest.packages[packageName]) throw new Error(`Cannot roll back unmanaged package "${packageName}"`);
      runtime.writeManifest({
        ...manifest,
        packages: { ...manifest.packages, [packageName]: { ...manifest.packages[packageName], version, source: 'runtime-rollback' } },
      });
      const result = runtime.rollbackRelease({ packageName, version });
      runtime.materializePackage(packageName, packagesDir);
      reload({ packageName, action: 'changed' });
      return result;
    },
  };
}
