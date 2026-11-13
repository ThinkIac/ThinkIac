import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

export const REGISTRY_URL = 'https://npm.thinkiac.cloud';
const REQUEST_TIMEOUT_MS = 20_000;

function registryUrl(path = '') { return new URL(path, `${REGISTRY_URL}/`).toString(); }

export function parseIntegrity(value) {
  const match = /^sha512-([A-Za-z0-9+/]+={0,2})$/.exec(String(value || '').trim());
  if (!match) throw new Error('Registry package must provide a valid sha512 dist.integrity');
  return { algorithm: 'sha512', digest: match[1] };
}

export function validateRegistryMetadata(release) {
  if (!release || typeof release !== 'object' || !release.name || !release.version) throw new Error('Registry returned invalid package metadata');
  const tarball = new URL(String(release.dist?.tarball || ''));
  if (tarball.origin !== REGISTRY_URL) throw new Error('Registry tarball must come from the trusted registry');
  parseIntegrity(release.dist?.integrity);
  return release;
}

export function selectRegistryVersion(metadata, version) {
  const requested = String(version || metadata?.['dist-tags']?.latest || '').trim();
  const release = metadata?.versions?.[requested];
  if (!release) throw new Error(`Version "${requested}" is not published in the registry`);
  return validateRegistryMetadata(release);
}

async function registryFetch(path, { fetchFn = fetch, binary = false, headers = {} } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchFn(registryUrl(path), { headers: { Accept: binary ? 'application/octet-stream' : 'application/json', ...headers }, signal: controller.signal });
    if (!response.ok) throw new Error(`Registry request failed (HTTP ${response.status})`);
    return binary ? Buffer.from(await response.arrayBuffer()) : response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('Registry request timed out');
    throw error;
  } finally { clearTimeout(timer); }
}

export async function getRegistryPackage(name, { fetchFn, headers } = {}) {
  const packageName = String(name || '').trim();
  if (!packageName || /[\\\s]/.test(packageName)) throw new Error('A valid registry package name is required');
  return registryFetch(encodeURIComponent(packageName), { fetchFn, headers });
}

export async function listRegistryPackages({ fetchFn, headers } = {}) {
  const metadata = await registryFetch('-/all', { fetchFn, headers });
  const summaries = Object.values(metadata || {}).filter(entry => entry && typeof entry === 'object' && entry.name);
  const packages = await Promise.all(summaries.map(async summary => {
    const full = await getRegistryPackage(summary.name, { fetchFn, headers });
    const latest = selectRegistryVersion(full);
    return { ...latest, versions: full.versions, 'dist-tags': full['dist-tags'] };
  }));
  return packages.sort((a, b) => a.name.localeCompare(b.name));
}

function safeTarball(archive) {
  const entries = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8', timeout: 30_000 }).split('\n').filter(Boolean);
  if (!entries.length || entries.length > 10_000) throw new Error('Registry tarball has an invalid number of entries');
  for (const entry of entries) {
    const normalized = entry.replace(/\\/g, '/');
    if (normalized.startsWith('/') || normalized.split('/').includes('..')) throw new Error('Registry tarball contains an unsafe path');
  }
}

/** Downloads, checks and extracts an npm tarball into an existing staging directory. */
export async function stageRegistryRelease({ name, version, stagingDir, fetchFn } = {}) {
  const metadata = await getRegistryPackage(name, { fetchFn });
  const release = selectRegistryVersion(metadata, version);
  if (release.name !== name) throw new Error('Registry package identity does not match the requested package');
  const bytes = await registryFetch(new URL(release.dist.tarball).pathname, { fetchFn, binary: true });
  const expected = parseIntegrity(release.dist.integrity);
  const actual = createHash(expected.algorithm).update(bytes).digest('base64');
  if (actual !== expected.digest) throw new Error(`Registry integrity mismatch for ${name}@${release.version}`);
  const archive = resolve(stagingDir, 'package.tgz');
  const output = resolve(stagingDir, 'package');
  if (!archive.startsWith(resolve(stagingDir) + sep) || !output.startsWith(resolve(stagingDir) + sep)) throw new Error('Invalid staging directory');
  writeFileSync(archive, bytes, { mode: 0o600 });
  safeTarball(archive);
  mkdirSync(output, { recursive: true });
  execFileSync('tar', ['-xzf', archive, '-C', output, '--strip-components=1'], { timeout: 30_000 });
  const manifestPath = join(output, 'package.json');
  if (!existsSync(manifestPath)) throw new Error('Registry tarball has no package.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  if (manifest.name !== name || manifest.version !== release.version) throw new Error('Registry tarball identity does not match its metadata');
  return { source: output, release };
}
