// Verdaccio -> Package Runtime adapter for tenant bootstrap. Downloads are
// verified before a PackageRuntime transaction receives their source paths.

import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { stageRegistryRelease } from './lib/registry-client.js';

function requiredText(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`Expected a non-empty ${label}`);
  return value.trim();
}

/**
 * Materializes every exact package in a public manifest before the runtime is
 * changed. The caller must invoke cleanup only after reconcile() copied the
 * package sources into its own durable transaction staging directories.
 */
export async function prepareRegistryReconciliation({ manifest, fetchFn = fetch } = {}) {
  if (!manifest?.packages || typeof manifest.packages !== 'object' || Array.isArray(manifest.packages)) {
    throw new Error('A runtime manifest with packages is required');
  }
  const stagingRoot = mkdtempSync(join(tmpdir(), 'thinkiac-registry-reconciliation-'));
  const releases = new Map();
  try {
    for (const [packageName, desired] of Object.entries(manifest.packages)) {
      const version = requiredText(desired?.version, `version for ${packageName}`);
      const integrity = requiredText(desired?.integrity, `sha512 integrity for ${packageName}`);
      const packageStagingDir = join(stagingRoot, packageName.replace(/[^a-zA-Z0-9._-]/g, '_'));
      mkdirSync(packageStagingDir, { recursive: true });
      const staged = await stageRegistryRelease({
        name: packageName,
        version,
        stagingDir: packageStagingDir,
        fetchFn,
      });
      if (staged.release.dist.integrity !== integrity) {
        throw new Error(`Registry integrity does not match the public manifest for ${packageName}@${version}`);
      }
      releases.set(packageName, {
        packageName,
        version,
        integrity,
        source: staged.source,
        channel: manifest.runtimeChannel ?? 'stable',
      });
    }
    return {
      resolveRelease({ packageName, version }) {
        const release = releases.get(packageName);
        if (!release || release.version !== version) throw new Error(`No prepared registry release exists for ${packageName}@${version}`);
        return release;
      },
      cleanup() { rmSync(stagingRoot, { recursive: true, force: true }); },
    };
  } catch (error) {
    rmSync(stagingRoot, { recursive: true, force: true });
    throw error;
  }
}
