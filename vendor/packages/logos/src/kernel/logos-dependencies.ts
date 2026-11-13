// Package-to-package dependencies. These are workspace Packages, never Node
// modules; the npm-compatible registry is only their distribution channel.
'use strict';

import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import type { PackageInfo, PackageRegistry } from './registry';

const run = promisify(execFile);
export const DEFAULT_LOGOS_REGISTRY = 'https://npm.thinkiac.cloud';

export interface LogosDependencySpec { name: string; version: string; optional: boolean; }
export interface DependencyDiagnostic { package: string; dependency: string; optional: boolean; error: string; }
export interface DependencyResolution {
  packages: PackageInfo[];
  blocked: Array<{ folder: string; error: string }>;
  diagnostics: DependencyDiagnostic[];
}
interface Release { version: string; dist?: { tarball?: string; integrity?: string }; }

export function parseLogosDependencies(value: unknown): LogosDependencySpec[] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  const seen = new Set<string>();
  return Object.entries(value as Record<string, unknown>).map(([raw, version]) => {
    const optional = raw.endsWith('?'); const name = optional ? raw.slice(0, -1) : raw;
    if (!name || !String(version || '').trim()) throw new Error(`invalid logosDependencies entry "${raw}"`);
    if (seen.has(name)) throw new Error(`logosDependencies declares "${name}" more than once`);
    seen.add(name); return { name, version: String(version).trim(), optional };
  });
}

function versionParts(value: string): number[] | null {
  const hit = value.match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  return hit ? hit.slice(1, 4).map(Number) : null;
}
function compare(a: string, b: string): number {
  const x = versionParts(a); const y = versionParts(b);
  return !x || !y ? a.localeCompare(b) : x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
}

/** Requested release, nearest lower release, then newest available release. */
export function selectRegistryVersion(requested: string, available: string[]): string | null {
  const versions = available.filter(v => Boolean(versionParts(v))).sort(compare);
  if (!versions.length) return null;
  const floor = requested.match(/(\d+)\.(\d+)\.(\d+)/)?.[0];
  if (!floor) return versions.at(-1)!;
  if (versions.includes(floor)) return floor;
  return versions.filter(v => compare(v, floor) < 0).at(-1) ?? versions.at(-1)!;
}

function installed(registry: PackageRegistry, name: string): PackageInfo | undefined {
  const folder = name.replace(/^@[^/]+\//, '');
  return registry.discover().find(pkg => pkg.name === name || pkg.folder === folder);
}
function verifyIntegrity(bytes: Buffer, integrity?: string): void {
  if (!integrity) return;
  const match = integrity.match(/^(sha256|sha384|sha512)-([A-Za-z0-9+/=]+)$/);
  if (!match) throw new Error(`unsupported registry integrity format "${integrity}"`);
  if (crypto.createHash(match[1]).update(bytes).digest('base64') !== match[2]) throw new Error('registry tarball integrity check failed');
}
async function installRelease(registry: PackageRegistry, name: string, release: Release): Promise<PackageInfo> {
  const tarball = release.dist?.tarball;
  if (!tarball) throw new Error(`registry release "${release.version}" has no tarball`);
  const response = await fetch(tarball);
  if (!response.ok) throw new Error(`registry tarball responded ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  verifyIntegrity(bytes, release.dist?.integrity);
  const staging = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-package-'));
  try {
    const archive = path.join(staging, 'package.tgz'); fs.writeFileSync(archive, bytes);
    await run('tar', ['-xzf', archive, '-C', staging]);
    const root = fs.existsSync(path.join(staging, 'package', 'package.json')) ? path.join(staging, 'package') : staging;
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    if (manifest.name !== name) throw new Error(`registry tarball declares "${manifest.name}", expected "${name}"`);
    const folder = name.replace(/^@[^/]+\//, ''); const destination = path.join(registry.workspace, folder);
    if (fs.existsSync(destination)) throw new Error(`package folder "${folder}" already exists`);
    fs.rmSync(archive, { force: true }); fs.renameSync(root, destination);
  } finally { fs.rmSync(staging, { recursive: true, force: true }); }
  const result = installed(registry, name);
  if (!result) throw new Error(`installed "${name}" but it is not discoverable`);
  return result;
}
async function ensure(registry: PackageRegistry, name: string, requested: string, registryUrl: string): Promise<PackageInfo> {
  const local = installed(registry, name); if (local) return local;
  const endpoint = `${registryUrl.replace(/\/$/, '')}/${encodeURIComponent(name)}`;
  const response = await fetch(endpoint, { headers: { accept: 'application/json' } });
  if (!response.ok) throw new Error(`registry ${endpoint} responded ${response.status}`);
  const metadata = await response.json() as { versions?: Record<string, Release> };
  const selected = selectRegistryVersion(requested, Object.keys(metadata.versions ?? {}));
  if (!selected) throw new Error(`registry has no release for "${name}"`);
  return installRelease(registry, name, metadata.versions![selected]);
}

export async function resolveLogosDependencies(registry: PackageRegistry, options: { registry?: string } = {}): Promise<DependencyResolution> {
  const registryUrl = options.registry || DEFAULT_LOGOS_REGISTRY;
  const diagnostics: DependencyDiagnostic[] = []; const blocked = new Map<string, string>();
  const ordered: PackageInfo[] = []; const visited = new Set<string>(); const visiting: string[] = [];
  const visit = async (pkg: PackageInfo): Promise<boolean> => {
    if (blocked.has(pkg.folder)) return false; if (visited.has(pkg.folder)) return true;
    const cycleAt = visiting.indexOf(pkg.folder);
    if (cycleAt >= 0) { const cycle = visiting.slice(cycleAt); const error = `required logosDependencies cycle: ${[...cycle, pkg.folder].join(' -> ')}`; cycle.forEach(folder => blocked.set(folder, error)); return false; }
    visiting.push(pkg.folder);
    for (const dep of parseLogosDependencies(pkg.logosDependencies)) {
      try {
        const child = await ensure(registry, dep.name, dep.version, registryUrl);
        if (!(await visit(child)) && !dep.optional) blocked.set(pkg.folder, `required dependency "${dep.name}" is blocked`);
      } catch (err: any) {
        const error = err?.message || String(err); diagnostics.push({ package: pkg.folder, dependency: dep.name, optional: dep.optional, error });
        if (!dep.optional) blocked.set(pkg.folder, `required dependency "${dep.name}" unavailable: ${error}`);
      }
    }
    visiting.pop();
    if (blocked.has(pkg.folder)) return false;
    visited.add(pkg.folder); ordered.push(pkg); return true;
  };
  for (const pkg of registry.discover()) await visit(pkg);
  return { packages: ordered.filter(pkg => !blocked.has(pkg.folder)), blocked: [...blocked].map(([folder, error]) => ({ folder, error })), diagnostics };
}
