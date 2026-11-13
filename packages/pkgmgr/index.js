// pkgmgr — install, enable, disable and remove ThinkIac packages.
//
// Two install paths, both converging on the same contract: whatever lands in
// packages/<name> must be a real package, and <name> always comes from the
// manifest's "name" field — never from user input. Letting the caller pick the
// folder name allowed the same package to be installed twice under different
// names, and made "is this already installed?" unanswerable.
//
//   Git  — clone the default branch (detected via ls-remote) into staging
//   Zip  — extract an uploaded archive into staging (WordPress-plugin style)
//
// Both then read the manifest, check for collisions, and rename staging into
// place. Staging lives next to packages/ so the final rename is atomic and on
// the same filesystem; a hidden folder is never scanned by the Lógos loader.

import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, renameSync, statSync, writeFileSync } from 'fs';
import { resolve, join, dirname, sep } from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { randomUUID } from 'crypto';
import { fileURLToPath } from 'url';
import AdmZip from 'adm-zip';
import { createDisabledHistory } from './lib/disabled-history.js';

const execFileAsync = promisify(execFile);

const __dirname = resolve(fileURLToPath(import.meta.url), '..');
const WORKSPACE = resolve(__dirname, '../..');
const PACKAGES_DIR = resolve(WORKSPACE, 'packages');
const DISABLED_DIR = resolve(WORKSPACE, '.disabled-packages');
const disabledHistory = createDisabledHistory({ disabledDir: DISABLED_DIR });
const STAGING_DIR = resolve(WORKSPACE, '.pkgmgr-staging');

// Packages that cannot be disabled or removed from here. Disabling any of them
// leaves the runtime unrecoverable from the UI: `shell` is the core, `auth`
// is imported by the bootstrap itself (the process would not even boot), and
// `pkgmgr` is this manager — disabling it deletes the only screen that could
// bring it back.
// Keep the complete bootstrap closure reachable. Auth now owns identity and
// public-exposure policy; Agent is the canonical assistant package. ui-dialogs
// remains shared by Shell as well as Auth's compatibility surface.
const PROTECTED = new Set([
  'shell', 'auth', 'agent', 'pkgmgr', 'ui-dialogs',
]);

// Folder names the Lógos loader never treats as packages, plus the npm folder.
// Listing them as installable packages was what made `.logos` (which holds the
// runtime's shadow git) show up as a package with no manifest.
const NON_PACKAGE_DIRS = new Set(['node_modules', 'dist', '.git', '.logos', '.svelte-cache', '.snapshots', '.database']);

const CLONE_TIMEOUT_MS = 180_000;
const LS_REMOTE_TIMEOUT_MS = 30_000;

// ── Store ────────────────────────────────────────────────────────────────
//
// The catalog is the org's `thinkiac-*` repositories. Each entry is described
// by its own package.json, so the repository name is only an address — the
// installed name comes from the manifest, exactly as with any other install
// (thinkiac-schedule installs as "scheduler").
//
// Rate limits shape the design: the GitHub API allows 60 requests/hour without
// a token, while raw.githubusercontent is not counted against it. So the
// catalog costs a single API call (the repo list) plus free raw fetches for
// manifests, and the per-package tool/route listing — which needs a file tree,
// one API call — is resolved lazily, only when a card is expanded.
const STORE_ORG = 'ThinkIac';
const STORE_PREFIX = 'thinkiac-';
const STORE_TOPIC = 'thinkiac-package';
const STORE_API = 'https://api.github.com';
const STORE_RAW = 'https://raw.githubusercontent.com';
const CATALOG_TTL_MS = 30 * 60 * 1000;
const DETAILS_TTL_MS = 60 * 60 * 1000;
const STORE_FETCH_TIMEOUT_MS = 20_000;
const MAX_SOURCE_FILES = 30;
const MAX_SOURCE_BYTES = 300_000;
const MAX_README_CHARS = 400_000;

// ── Naming ───────────────────────────────────────────────────────────────

/**
 * Turn a manifest name into a folder name. Scoped names (`@acme/widgets`)
 * install under their unscoped part, which is what the loader can address.
 */
function folderNameFromManifest(name) {
  const raw = String(name || '').trim();
  if (!raw) return null;
  const unscoped = raw.startsWith('@') ? raw.split('/').slice(1).join('/') : raw;
  const candidate = unscoped.replace(/\//g, '-');
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(candidate)) return null;
  if (candidate === '.' || candidate === '..') return null;
  if (NON_PACKAGE_DIRS.has(candidate)) return null;
  return candidate;
}

/** Same rules, applied to a name arriving from a URL param. */
function safeName(name) {
  const candidate = folderNameFromManifest(name);
  if (!candidate) throw new Error(`"${name}" is not a valid package name`);
  return candidate;
}

/** Resolve `name` under `base` and refuse anything that escapes it. */
function resolveInside(base, name) {
  const full = resolve(base, name);
  if (full !== base && !full.startsWith(base + sep)) {
    throw new Error('Resolved path escapes the packages directory');
  }
  return full;
}

// ── Package discovery ────────────────────────────────────────────────────

function readManifest(pkgDir) {
  const manifestPath = join(pkgDir, 'package.json');
  if (!existsSync(manifestPath)) return null;
  try {
    return JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return null;
  }
}

function authorName(author) {
  if (!author) return '';
  if (typeof author === 'string') return author;
  return author.name || '';
}

/**
 * Package classification protocol:
 *
 *   "manifest": { "tags": ["Android"] }
 *
 * `tags` may also live at the package.json top level for compatibility. System
 * is intentionally not declarative: it is assigned only to protected runtime
 * packages. Packages with no valid declared tag belong to Others.
 */
function packageTags(manifest, name) {
  if (PROTECTED.has(name)) return ['System'];

  const declared = manifest?.manifest?.tags ?? manifest?.tags;
  if (!Array.isArray(declared)) return ['Others'];

  const seen = new Set();
  const tags = [];
  for (const candidate of declared) {
    if (typeof candidate !== 'string') continue;
    const tag = candidate.trim().replace(/\s+/g, ' ');
    if (!tag || tag.length > 40 || /[\r\n]/.test(tag)) continue;
    if (/^(system|others)$/i.test(tag)) continue;
    const identity = tag.toLocaleLowerCase();
    if (!seen.has(identity)) {
      seen.add(identity);
      tags.push(tag);
    }
  }
  return tags.length ? tags : ['Others'];
}

/**
 * A directory is a package only when it carries a package.json. Hidden and
 * loader-ignored folders never qualify — see NON_PACKAGE_DIRS.
 */
function listPackageDirs(dir) {
  if (!existsSync(dir)) return [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter(entry => {
      if (entry.name.startsWith('.') || NON_PACKAGE_DIRS.has(entry.name)) return false;
      try {
        if (!statSync(resolve(dir, entry.name)).isDirectory()) return false;
      } catch {
        return false;
      }
      return existsSync(join(dir, entry.name, 'package.json'));
    })
    .map(entry => entry.name);
}

function packageIcon(manifest) {
  const raw = manifest?.manifest?.icon ?? manifest?.icon;
  if (typeof raw !== 'string' || !raw.trim() || /[\r\n]/.test(raw)) return null;
  return raw.trim();
}

function localIconData(manifest, pkgDir) {
  const icon = packageIcon(manifest);
  if (!icon) return null;
  const path = icon.replace(/^\.\//, '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) || path.split('/').includes('..')) return null;

  const extension = path.split('.').pop()?.toLowerCase();
  const mime = { svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' }[extension];
  if (!mime) return null;

  try {
    const source = resolveInside(pkgDir, path);
    const info = statSync(source);
    if (!info.isFile() || info.size > 256 * 1024) return null;
    return `data:${mime};base64,${readFileSync(source).toString('base64')}`;
  } catch {
    return null;
  }
}

function describePackage(name, status) {
  const baseDir = status === 'active' ? PACKAGES_DIR : DISABLED_DIR;
  const manifest = readManifest(join(baseDir, name)) || {};
  return {
    name,
    status,
    manifestName: manifest.name || '',
    description: manifest.description || '',
    version: manifest.version || '',
    author: authorName(manifest.author),
    icon: localIconData(manifest, join(baseDir, name)),
    homepage: manifest.homepage || manifest.repository?.url || '',
    protected: PROTECTED.has(name),
    tags: packageTags(manifest, name),
    path: status === 'active' ? `packages/${name}` : `.disabled-packages/${name}`,
  };
}

function listDisabledPackageNames() {
  if (!existsSync(DISABLED_DIR)) return [];
  try {
    return readdirSync(DISABLED_DIR, { withFileTypes: true })
      .filter(entry => !entry.name.startsWith('.') && entry.isDirectory())
      .map(entry => entry.name)
      .filter(name => folderNameFromManifest(name) === name)
      .filter(name => disabledHistory.list(name).length > 0);
  } catch { return []; }
}

function describeDisabledPackage(name) {
  const versions = disabledHistory.list(name);
  const latest = versions.at(-1);
  const manifest = latest?.manifest || {};
  return {
    name,
    status: 'disabled',
    manifestName: manifest.name || '',
    description: manifest.description || '',
    version: latest?.version || manifest.version || '',
    author: authorName(manifest.author),
    icon: latest ? localIconData(manifest, join(DISABLED_DIR, name, latest.folder)) : null,
    homepage: manifest.homepage || manifest.repository?.url || '',
    protected: PROTECTED.has(name),
    tags: packageTags(manifest, name),
    path: `.disabled-packages/${name}`,
    versions: versions.map(({ manifest: ignored, ...entry }) => entry),
  };
}

// A folder can be copied or renamed outside pkgmgr. Its manifest is the
// package identity, so aliases must not be presented as separate packages.
function packageIdentity(pkg) {
  return folderNameFromManifest(pkg.manifestName) || pkg.name;
}

function preferPackage(current, candidate) {
  if (current.status !== candidate.status) return current.status === 'active' ? current : candidate;
  if (current.name === packageIdentity(current)) return current;
  if (candidate.name === packageIdentity(candidate)) return candidate;
  return current.name.localeCompare(candidate.name) <= 0 ? current : candidate;
}

function consolidatePackages(entries) {
  const grouped = new Map();
  for (const entry of entries) {
    const identity = packageIdentity(entry);
    const current = grouped.get(identity);
    if (!current) grouped.set(identity, { primary: entry, duplicates: [] });
    else {
      const primary = preferPackage(current.primary, entry);
      const duplicate = primary === current.primary ? entry : current.primary;
      grouped.set(identity, { primary, duplicates: [...current.duplicates, duplicate] });
    }
  }
  return [...grouped.values()];
}

function installedStatus(name) {
  if (existsSync(join(PACKAGES_DIR, name, 'package.json'))) return 'active';
  if (listDisabledPackageNames().includes(name)) return 'disabled';
  // A bare folder with no manifest still occupies the name on disk.
  if (existsSync(join(PACKAGES_DIR, name)) || existsSync(join(DISABLED_DIR, name))) return 'occupied';
  return null;
}

// ── Install jobs ─────────────────────────────────────────────────────────
//
// Installing clones or unpacks megabytes of code, so the HTTP request returns
// a job id immediately and the UI follows progress over SSE. Jobs are kept in
// memory: they describe a single install attempt and mean nothing after a
// restart, so there is nothing worth persisting.

const JOBS = new Map();
const JOB_TTL_MS = 15 * 60 * 1000;

const GIT_STEPS = [
  ['resolve', 'Resolve repository'],
  ['download', 'Download source'],
  ['inspect', 'Read manifest'],
  ['install', 'Install package'],
];

const ZIP_STEPS = [
  ['receive', 'Receive archive'],
  ['extract', 'Extract archive'],
  ['inspect', 'Read manifest'],
  ['install', 'Install package'],
];


function createJob(kind, steps, source) {
  const job = {
    id: randomUUID(),
    kind,
    source,
    status: 'running',
    steps: steps.map(([key, label]) => ({ key, label, status: 'pending', detail: '' })),
    package: null,
    notes: [],
    error: null,
    createdAt: Date.now(),
    finishedAt: null,
    subscribers: new Set(),
  };
  JOBS.set(job.id, job);
  pruneJobs();
  return job;
}

function pruneJobs() {
  const cutoff = Date.now() - JOB_TTL_MS;
  for (const [id, job] of JOBS) {
    if (job.finishedAt && job.finishedAt < cutoff && job.subscribers.size === 0) JOBS.delete(id);
  }
}

function publicJob(job) {
  const { subscribers, ...rest } = job;
  return rest;
}

function emitJob(job) {
  const payload = `data: ${JSON.stringify(publicJob(job))}\n\n`;
  for (const res of job.subscribers) {
    try {
      res.write(payload);
    } catch {
      job.subscribers.delete(res);
    }
  }
}

function stepStart(job, key, detail = '') {
  const step = job.steps.find(s => s.key === key);
  if (step) {
    step.status = 'running';
    step.detail = detail;
  }
  emitJob(job);
}

function stepDone(job, key, detail = '') {
  const step = job.steps.find(s => s.key === key);
  if (step) {
    step.status = 'done';
    if (detail) step.detail = detail;
  }
  emitJob(job);
}

function failJob(job, message) {
  const running = job.steps.find(s => s.status === 'running');
  if (running) running.status = 'error';
  job.status = 'error';
  job.error = message;
  job.finishedAt = Date.now();
  emitJob(job);
  for (const res of job.subscribers) {
    try { res.end(); } catch { /* client already gone */ }
  }
  job.subscribers.clear();
}

function completeJob(job, pkg) {
  job.status = 'done';
  job.package = pkg;
  job.finishedAt = Date.now();
  emitJob(job);
  for (const res of job.subscribers) {
    try { res.end(); } catch { /* client already gone */ }
  }
  job.subscribers.clear();
}

// ── Staging ──────────────────────────────────────────────────────────────

function makeStagingDir(prefix) {
  mkdirSync(STAGING_DIR, { recursive: true });
  return mkdtempSync(join(STAGING_DIR, `${prefix}-`));
}

/**
 * Shared tail of both install paths: validate what staging holds, then archive
 * it as disabled. Third-party code must never gain runtime access merely by
 * being downloaded; the user enables it after reviewing the package.
 */
function promoteStagedPackage(job, stagedDir, { origin }) {
  stepStart(job, 'inspect');

  const manifest = readManifest(stagedDir);
  if (!manifest) {
    throw new Error('No package.json found — a ThinkIac package must declare one at its root');
  }

  const name = folderNameFromManifest(manifest.name);
  if (!name) {
    throw new Error(
      manifest.name
        ? `The manifest name "${manifest.name}" is not usable as a package folder`
        : 'The package.json has no "name" field'
    );
  }

  const existing = installedStatus(name);
  if (existing === 'active') throw new Error(`"${name}" is already installed and active`);
  if (existing === 'disabled') throw new Error(`"${name}" is already installed but disabled — enable it instead of reinstalling`);
  if (existing === 'occupied') throw new Error(`A folder named "${name}" already exists in packages/`);

  stepDone(job, 'inspect', `${name}${manifest.version ? ` v${manifest.version}` : ''}`);

  stepStart(job, 'install');
  const archived = disabledHistory.archive(name, stagedDir);
  stepDone(job, 'install', `.disabled-packages/${name}/${archived.entry.folder}`);

  const depCount = Object.keys(manifest.dependencies || {}).length;
  if (depCount > 0) {
    job.notes.push(`Declares ${depCount} npm ${depCount === 1 ? 'dependency' : 'dependencies'} — the runtime installs them automatically; check the runtime log if the package fails to load.`);
  }
  job.notes.push(`Installed from ${origin} as disabled. Review it, then enable it explicitly before it can run.`);

  return describeDisabledPackage(name);
}

// ── Git install ──────────────────────────────────────────────────────────

// Remote schemes only. Anything else (a local path, file://, an option-looking
// string) is rejected before it reaches git, which would otherwise happily
// treat a leading dash as a flag.
const GIT_URL_RE = /^(?:https?:\/\/|git:\/\/|ssh:\/\/|[\w.+-]+@[\w.-]+:)[^\s]+$/i;

function assertGitUrl(url) {
  const value = String(url || '').trim();
  if (!value) throw new Error('Repository URL is required');
  if (/[\s\x00-\x1f]/.test(value)) throw new Error('Repository URL contains invalid characters');
  if (!GIT_URL_RE.test(value)) {
    throw new Error('Only https://, http://, git://, ssh:// or user@host:path repository URLs are supported');
  }
  return value;
}

function assertBranchName(branch) {
  const value = String(branch || '').trim();
  if (!value) return null;
  // git refuses these anyway; catching them here keeps the error readable.
  if (!/^[\w.\-\/]+$/.test(value) || value.startsWith('-') || value.includes('..')) {
    throw new Error(`"${branch}" is not a valid branch name`);
  }
  return value;
}

function gitError(err, fallback) {
  const stderr = String(err?.stderr || '').trim();
  const firstLine = stderr.split('\n').filter(Boolean).pop();
  if (err?.killed || err?.signal) return `${fallback} (timed out)`;
  return firstLine ? `${fallback}: ${firstLine}` : `${fallback}: ${err?.message || 'unknown error'}`;
}

// GIT_TERMINAL_PROMPT=0 keeps a private repo from hanging the request on a
// credential prompt that nobody can answer server-side.
const GIT_ENV = { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'echo', GCM_INTERACTIVE: 'never' };

/** Ask the remote which branch HEAD points at, so nobody has to type "main". */
export async function detectDefaultBranch(url) {
  const repoUrl = assertGitUrl(url);
  try {
    const { stdout } = await execFileAsync('git', ['ls-remote', '--symref', repoUrl, 'HEAD'], {
      env: GIT_ENV,
      timeout: LS_REMOTE_TIMEOUT_MS,
    });
    const match = stdout.match(/^ref:\s+refs\/heads\/(\S+)\s+HEAD/m);
    return match ? match[1] : null;
  } catch (err) {
    throw new Error(gitError(err, 'Could not reach the repository'));
  }
}

async function runGitInstall(job, { url, branch }) {
  const repoUrl = assertGitUrl(url);
  const requested = assertBranchName(branch);
  let staging;

  try {
    stepStart(job, 'resolve');
    const targetBranch = requested || (await detectDefaultBranch(repoUrl));
    stepDone(job, 'resolve', targetBranch ? `branch ${targetBranch}` : 'default branch');

    stepStart(job, 'download');
    staging = makeStagingDir('git');
    const checkout = join(staging, 'repo');
    const args = ['clone', '--depth', '1', '--single-branch'];
    if (targetBranch) args.push('--branch', targetBranch);
    args.push(repoUrl, checkout);

    try {
      await execFileAsync('git', args, { env: GIT_ENV, timeout: CLONE_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 });
    } catch (err) {
      throw new Error(gitError(err, 'Clone failed'));
    }
    stepDone(job, 'download');

    // Drop .git so the installed package is plain files, not a nested repo the
    // runtime's own git tooling would try to manage.
    rmSync(join(checkout, '.git'), { recursive: true, force: true });

    const pkg = promoteStagedPackage(job, checkout, { origin: repoUrl });
    completeJob(job, pkg);
    return pkg;
  } catch (err) {
    failJob(job, err.message);
    throw err;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

// ── Zip install ──────────────────────────────────────────────────────────

const ZIP_JUNK = new Set(['__MACOSX', '.DS_Store', 'Thumbs.db']);

function isJunkEntry(entryName) {
  return entryName.split('/').some(part => ZIP_JUNK.has(part));
}

/**
 * Extract entry by entry instead of AdmZip's extractAllTo: every destination is
 * re-resolved and checked against the target root, so an archive carrying
 * `../../etc/whatever` cannot write outside staging.
 */
function extractZip(buffer, destDir) {
  let zip;
  try {
    zip = new AdmZip(buffer);
  } catch {
    throw new Error('The uploaded file is not a readable .zip archive');
  }

  const entries = zip.getEntries();
  if (!entries.length) throw new Error('The archive is empty');

  let written = 0;
  for (const entry of entries) {
    const entryName = entry.entryName.replace(/\\/g, '/');
    if (!entryName || isJunkEntry(entryName)) continue;
    // An absolute or traversing entry is refused rather than silently skipped:
    // dropping files would install a package that is quietly incomplete.
    if (entryName.startsWith('/') || entryName.split('/').includes('..')) {
      throw new Error(`Refusing to extract "${entry.entryName}" — the archive tries to write outside its folder`);
    }

    const target = resolve(destDir, entryName);
    if (!target.startsWith(destDir + sep)) {
      throw new Error(`Refusing to extract "${entry.entryName}" — the archive tries to write outside its folder`);
    }

    if (entry.isDirectory) {
      mkdirSync(target, { recursive: true });
      continue;
    }
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.getData());
    written += 1;
  }

  if (written === 0) throw new Error('The archive contains no files');
  return written;
}

/**
 * Accept both shapes people actually upload: a zip of the package folder
 * (single top-level directory, the WordPress convention) and a zip of the
 * package contents (package.json at the root).
 */
function findPackageRoot(dir) {
  if (existsSync(join(dir, 'package.json'))) return dir;

  const children = readdirSync(dir, { withFileTypes: true }).filter(entry => !ZIP_JUNK.has(entry.name));
  const dirs = children.filter(entry => entry.isDirectory());
  if (children.length === dirs.length && dirs.length === 1) {
    const nested = join(dir, dirs[0].name);
    if (existsSync(join(nested, 'package.json'))) return nested;
  }
  return null;
}

async function runZipInstall(job, { buffer, filename }) {
  let staging;
  try {
    stepStart(job, 'receive');
    if (!buffer?.length) throw new Error('No file was uploaded');
    stepDone(job, 'receive', `${filename || 'archive.zip'} · ${formatBytes(buffer.length)}`);

    stepStart(job, 'extract');
    staging = makeStagingDir('zip');
    const unpacked = join(staging, 'unpacked');
    mkdirSync(unpacked, { recursive: true });
    const written = extractZip(buffer, unpacked);
    stepDone(job, 'extract', `${written} ${written === 1 ? 'file' : 'files'}`);

    const root = findPackageRoot(unpacked);
    if (!root) {
      throw new Error('No package.json found — the archive must contain a package folder or the package files at its root');
    }

    const pkg = promoteStagedPackage(job, root, { origin: filename || 'an uploaded archive' });
    completeJob(job, pkg);
    return pkg;
  } catch (err) {
    failJob(job, err.message);
    throw err;
  } finally {
    if (staging) rmSync(staging, { recursive: true, force: true });
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

// ── Store: catalog ───────────────────────────────────────────────────────

const storeCache = { catalog: null, catalogAt: 0, details: new Map(), readmes: new Map() };

function storeHeaders() {
  const headers = { Accept: 'application/vnd.github+json', 'User-Agent': 'thinkiac-pkgmgr' };
  // Optional: lifts the anonymous 60 req/hour ceiling to 5000 when present.
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}

async function storeFetch(url, { json = true } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), STORE_FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: storeHeaders(), signal: controller.signal });
    if (res.status === 404) return null;
    if (res.status === 403 || res.status === 429) {
      const reset = Number(res.headers.get('x-ratelimit-reset'));
      const mins = reset ? Math.max(1, Math.ceil((reset * 1000 - Date.now()) / 60000)) : null;
      throw new Error(
        `GitHub rate limit reached${mins ? ` — try again in ~${mins} min` : ''}. Set GITHUB_TOKEN to raise the limit.`
      );
    }
    if (!res.ok) throw new Error(`GitHub responded ${res.status}`);
    return json ? await res.json() : await res.text();
  } catch (err) {
    if (err.name === 'AbortError') throw new Error('GitHub request timed out');
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GitHub caps each organization listing at 100 repositories. Follow pages so
 * the community catalog remains complete as ThinkIac publishes more packages.
 */
async function listStoreRepositories() {
  const repos = [];
  for (let page = 1; page <= 100; page += 1) {
    const batch = await storeFetch(
      `${STORE_API}/orgs/${STORE_ORG}/repos?per_page=100&sort=updated&page=${page}`
    );
    if (!Array.isArray(batch)) throw new Error(`Could not read the ${STORE_ORG} repository list`);
    repos.push(...batch);
    if (batch.length < 100) return repos;
  }
  throw new Error(`The ${STORE_ORG} repository list is unexpectedly large`);
}

function parseManifestText(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Converts a package manifest icon into a GitHub raw URL. Community packages
 * may only point at a file inside their own repository: remote/data URLs and
 * traversing paths are deliberately ignored.
 */
function storeIconUrl(manifest, repo, branch) {
  const icon = packageIcon(manifest);
  if (!icon || !repo || !branch) return null;
  const path = icon.replace(/^\.\//, '');
  if (/^(?:[a-z][a-z\d+.-]*:|\/)/i.test(path) || path.split('/').includes('..')) return null;
  return `${STORE_RAW}/${STORE_ORG}/${encodeURIComponent(repo)}/${encodeURIComponent(branch)}/${path.split('/').map(encodeURIComponent).join('/')}`;
}

/** Keep README content safe for text-only rendering in the view. */
export function normalizeReadme(text) {
  const value = String(text || '').replace(/^\uFEFF/, '');
  if (value.length <= MAX_README_CHARS) return { content: value, truncated: false };
  return { content: value.slice(0, MAX_README_CHARS), truncated: true };
}

/**
 * How a catalog entry relates to this runtime: the repository is only an
 * address, so installed-state is keyed on the manifest name.
 */
function storeInstallState(manifest) {
  const name = manifest ? folderNameFromManifest(manifest.name) : null;
  if (!name) return { installName: null, state: 'unknown' };
  const status = installedStatus(name);
  if (status === 'active') return { installName: name, state: 'installed' };
  if (status === 'disabled') return { installName: name, state: 'disabled' };
  if (status === 'occupied') return { installName: name, state: 'conflict' };
  return { installName: name, state: 'available' };
}

async function buildCatalog() {
  const repos = await listStoreRepositories();

  const matching = repos.filter(repo =>
    !repo.archived && (repo.name.startsWith(STORE_PREFIX) || repo.topics?.includes(STORE_TOPIC))
  );

  // Manifests come from raw.githubusercontent, which the API rate limit does
  // not cover — one per repository, in parallel.
  const entries = await Promise.all(matching.map(async repo => {
    const branch = repo.default_branch || 'main';
    let manifest = null;
    try {
      manifest = parseManifestText(await storeFetch(`${STORE_RAW}/${STORE_ORG}/${repo.name}/${branch}/package.json`, { json: false }));
    } catch {
      // A single unreachable manifest must not take the whole catalog down.
    }

    const { installName, state } = storeInstallState(manifest);
    return {
      repo: repo.name,
      cloneUrl: repo.clone_url,
      htmlUrl: repo.html_url,
      defaultBranch: branch,
      updatedAt: repo.pushed_at || repo.updated_at,
      stars: repo.stargazers_count || 0,
      topics: repo.topics || [],
      hasManifest: Boolean(manifest),
      installName,
      state,
      // Repo description is usually empty on these; the manifest is the source.
      name: manifest?.name || repo.name,
      version: manifest?.version || '',
      description: manifest?.description || repo.description || '',
      author: authorName(manifest?.author),
      dependencies: Object.keys(manifest?.dependencies || {}).length,
      icon: storeIconUrl(manifest, repo.name, branch),
    };
  }));

  entries.sort((a, b) => a.name.localeCompare(b.name));
  return entries;
}

async function listStorePackages(input) {
  /**
   * Legacy GitHub catalog helper, not exposed as a tool.
   * @description Lists the ThinkIac store catalog — every thinkiac-* repository published by the ThinkIac organisation on GitHub, described by its own package.json, with whether each one is already installed here.
   * @param {object} input - Options
   * @param {boolean?} input.refresh - Bypass the 30-minute cache and re-read the catalog from GitHub
   */
  const { refresh } = normalizeInput(input);
  const fresh = refresh === true || refresh === 'true';

  if (!fresh && storeCache.catalog && Date.now() - storeCache.catalogAt < CATALOG_TTL_MS) {
    // Installed-state is local and changes without GitHub, so re-derive it
    // rather than serving a stale "available" for something just installed.
    const packages = storeCache.catalog.map(entry => ({
      ...entry,
      ...storeInstallState(entry.installName ? { name: entry.installName } : null),
    }));
    return { org: STORE_ORG, cached: true, fetchedAt: storeCache.catalogAt, total: packages.length, packages };
  }

  const packages = await buildCatalog();
  storeCache.catalog = packages;
  storeCache.catalogAt = Date.now();
  return { org: STORE_ORG, cached: false, fetchedAt: storeCache.catalogAt, total: packages.length, packages };
}

// ── Store: declared tools and routes ─────────────────────────────────────

// Reads the tool/router registration blocks straight out of the source. The
// runtime's own parser needs loaded modules; here there is only text, and text
// is enough to show what a package would add before any of its code is on
// disk.
//
// Deliberately a line comment, not a JSDoc block: the scanner reads the doc
// above a declaration, so spelling the registration tags inside a /** */ here
// would register this helper as a tool of its own.
export function extractDeclarations(source) {
  const tools = [];
  const routes = [];

  for (const block of source.match(/\/\*\*[\s\S]*?\*\//g) || []) {
    const text = block
      .replace(/^\/\*\*/, '')
      .replace(/\*\/$/, '')
      .split('\n')
      .map(line => line.replace(/^\s*\*\s?/, ''))
      .join('\n');

    if (!/@register_(tool|router)\b/.test(text)) continue;

    // A description runs until the next tag, so it may span several lines.
    const descMatch = text.match(/@description\s+([\s\S]*?)(?=\n\s*@|$)/);
    const description = descMatch ? descMatch[1].trim().replace(/\s+/g, ' ') : '';

    const tool = text.match(/@register_tool\s+(\S+)/);
    if (tool) {
      const params = [...text.matchAll(/@param\s+\{([^}]*)\}\s+(\S+)(?:\s*-\s*([^\n]*))?/g)]
        .map(([, type, name, desc]) => ({ name, type, description: (desc || '').trim() }))
        // The wrapper `input` object carries no information of its own.
        .filter(param => param.name !== 'input');
      tools.push({ name: tool[1], description, params });
      continue;
    }

    const route = text.match(/@register_router\s+(\S+)/);
    if (route) {
      const method = (text.match(/@method\s+([a-zA-Z]+)/) || [, 'get'])[1].toUpperCase();
      routes.push({
        path: route[1],
        method,
        description,
        credentialRequired: /@(requireCredential|auth)\b/.test(text),
        streaming: /@streaming\b/.test(text),
        upload: /@upload\b/.test(text),
      });
    }
  }

  return { tools, routes };
}

async function buildStoreDetails(entry) {
  const tree = await storeFetch(
    `${STORE_API}/repos/${STORE_ORG}/${entry.repo}/git/trees/${encodeURIComponent(entry.defaultBranch)}?recursive=1`
  );
  if (!tree?.tree) throw new Error(`Could not read the file list for ${entry.repo}`);

  const sourceFiles = tree.tree
    .filter(node => node.type === 'blob' && node.path.endsWith('.js'))
    .filter(node => !/(^|\/)(node_modules|dist|\.)/.test(node.path))
    .filter(node => (node.size || 0) <= MAX_SOURCE_BYTES)
    .slice(0, MAX_SOURCE_FILES);

  const tools = [];
  const routes = [];

  await Promise.all(sourceFiles.map(async node => {
    let source;
    try {
      source = await storeFetch(`${STORE_RAW}/${STORE_ORG}/${entry.repo}/${entry.defaultBranch}/${node.path}`, { json: false });
    } catch {
      return; // one unreadable file should not blank the whole listing
    }
    if (!source || !source.includes('@register_')) return;
    const found = extractDeclarations(source);
    for (const tool of found.tools) tools.push({ ...tool, file: node.path });
    for (const route of found.routes) routes.push({ ...route, file: node.path });
  }));

  tools.sort((a, b) => a.name.localeCompare(b.name));
  routes.sort((a, b) => a.path.localeCompare(b.path));

  const views = tree.tree
    .filter(node => node.type === 'blob' && node.path.endsWith('.svelte'))
    .map(node => node.path);

  return {
    repo: entry.repo,
    name: entry.name,
    installName: entry.installName,
    // Routes mount under the installed folder name, so show the real URL.
    routePrefix: entry.installName ? `/${entry.installName}` : '',
    tools,
    routes,
    views,
    fileCount: tree.tree.filter(node => node.type === 'blob').length,
    truncated: Boolean(tree.truncated),
  };
}

async function findCatalogEntry(repoName) {
  const catalog = await listStorePackages({});
  const entry = catalog.packages.find(item => item.repo === repoName);
  if (!entry) throw new Error(`"${repoName}" is not in the ${STORE_ORG} store catalog`);
  return entry;
}

async function getStorePackage(input) {
  /**
   * Legacy GitHub catalog helper, not exposed as a tool.
   * @description Describes one store package in detail — the tools and HTTP routes it declares, read straight from its source on GitHub, so its capabilities are visible before installing it.
   * @param {object} input - Options
   * @param {string} input.repo - Repository name in the store (e.g. thinkiac-ntfy)
   * @param {boolean?} input.refresh - Bypass the 1-hour cache for this package
   */
  const { repo, refresh } = normalizeInput(input);
  if (!repo) throw new Error('Field "repo" is required');

  const fresh = refresh === true || refresh === 'true';
  const cached = storeCache.details.get(repo);
  if (!fresh && cached && Date.now() - cached.at < DETAILS_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const entry = await findCatalogEntry(repo);
  const details = await buildStoreDetails(entry);
  storeCache.details.set(repo, { at: Date.now(), value: details });
  return { ...details, cached: false };
}

async function getStoreReadme(input) {
  /**
   * Legacy GitHub catalog helper, not exposed as a tool.
   * @description Reads a ThinkIac community package README from GitHub without installing its code.
   * @param {object} input - Options
   * @param {string} input.repo - Repository name in the community catalog
   * @param {boolean?} input.refresh - Bypass the README cache
   */
  const { repo, refresh } = normalizeInput(input);
  if (!repo) throw new Error('Field "repo" is required');

  const fresh = refresh === true || refresh === 'true';
  const cached = storeCache.readmes.get(repo);
  if (!fresh && cached && Date.now() - cached.at < DETAILS_TTL_MS) {
    return { ...cached.value, cached: true };
  }

  const entry = await findCatalogEntry(repo);
  let text = null;
  for (const filename of ['README.md', 'readme.md', 'README.MD']) {
    text = await storeFetch(`${STORE_RAW}/${STORE_ORG}/${entry.repo}/${entry.defaultBranch}/${filename}`, { json: false });
    if (text !== null) break;
  }

  if (text === null) {
    const value = { repo: entry.repo, name: entry.name, readme: '', found: false, truncated: false };
    storeCache.readmes.set(repo, { at: Date.now(), value });
    return { ...value, cached: false };
  }

  const { content, truncated } = normalizeReadme(text);
  const value = { repo: entry.repo, name: entry.name, readme: content, found: true, truncated };
  storeCache.readmes.set(repo, { at: Date.now(), value });
  return { ...value, cached: false };
}

async function installStorePackage(input) {
  const { repo } = normalizeInput(input);
  if (!repo) throw new Error('Field "repo" is required');

  const entry = await findCatalogEntry(repo);
  if (!entry.hasManifest) throw new Error(`"${repo}" has no package.json and cannot be installed`);

  return installPackage({ url: entry.cloneUrl, branch: entry.defaultBranch });
}

// ── Lifecycle operations ─────────────────────────────────────────────────

function normalizeInput(input) {
  return input?.input && typeof input.input === 'object' && !Array.isArray(input.input)
    ? input.input
    : input || {};
}

export function listPackages() {
  /**
   * @register_tool listPackages
   * @description Lists every ThinkIac package — active ones in packages/ and disabled ones in .disabled-packages/. Only folders carrying a package.json are reported.
   */
  const active = listPackageDirs(PACKAGES_DIR).map(name => describePackage(name, 'active'));
  const disabled = listDisabledPackageNames().map(describeDisabledPackage);
  const consolidated = consolidatePackages([...active, ...disabled]);
  const packages = consolidated
    .map(({ primary, duplicates }) => ({ ...primary, duplicateFolders: duplicates.map(item => item.name) }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const duplicates = consolidated.flatMap(({ primary, duplicates: aliases }) => aliases.map(alias => ({
    identity: packageIdentity(primary),
    primary: primary.name,
    duplicate: alias.name,
    status: alias.status,
  })));

  return {
    total: packages.length,
    active: packages.filter(pkg => pkg.status === 'active').length,
    disabled: packages.filter(pkg => pkg.status === 'disabled').length,
    duplicates,
    packages,
  };
}

export function disablePackage(input) {
  /**
   * @register_tool disablePackage
   * @description Disables a package by moving it from packages/ to .disabled-packages/
   * @param {object} input - Data
   * @param {string} input.name - Name of the package to disable
   */
  const { name } = normalizeInput(input);
  if (!name) throw new Error('Field "name" is required');

  const pkgName = safeName(name);
  if (PROTECTED.has(pkgName)) {
    throw new Error(`"${pkgName}" is a core package and cannot be disabled — the runtime depends on it`);
  }

  const source = resolveInside(PACKAGES_DIR, pkgName);
  if (!existsSync(source)) throw new Error(`Package "${pkgName}" was not found in packages/`);
  const archived = disabledHistory.archive(pkgName, source);

  return {
    success: true,
    package: pkgName,
    from: `packages/${pkgName}`,
    to: `.disabled-packages/${pkgName}/${archived.entry.folder}`,
    version: archived.entry.version,
    conflict: archived.entry.conflict,
    duplicateOf: archived.entry.duplicateOf,
    message: `Package "${pkgName}" disabled and archived as version ${archived.entry.version || 'unknown'}`,
  };
}

export function enablePackage(input) {
  /**
   * @register_tool enablePackage
   * @description Re-enables a package from its disabled version history. A version is required when more than one archived version exists.
   * @param {object} input - Data
   * @param {string} input.name - Name of the package to enable
   * @param {string?} input.version - Archived version or archive folder to enable
   */
  const { name, version } = normalizeInput(input);
  if (!name) throw new Error('Field "name" is required');

  const pkgName = safeName(name);
  const dest = resolveInside(PACKAGES_DIR, pkgName);

  const restored = disabledHistory.restore(pkgName, version, dest);

  return {
    success: true,
    package: pkgName,
    from: `.disabled-packages/${pkgName}/${restored.folder}`,
    version: restored.version,
    to: `packages/${pkgName}`,
    message: `Package "${pkgName}" enabled and moved to packages/`,
  };
}

export function removeDisabledPackage(input) {
  /**
   * @register_tool removeDisabledPackage
   * @description Permanently deletes a disabled package from .disabled-packages/. Active packages must be disabled first, so removal is always a two-step action.
   * @param {object} input - Data
   * @param {string} input.name - Name of the disabled package to delete
   */
  const { name } = normalizeInput(input);
  if (!name) throw new Error('Field "name" is required');

  const pkgName = safeName(name);
  if (PROTECTED.has(pkgName)) {
    throw new Error(`"${pkgName}" is a core package and cannot be removed`);
  }

  const target = resolveInside(DISABLED_DIR, pkgName);
  if (!existsSync(target)) throw new Error(`Disabled package "${pkgName}" was not found in .disabled-packages/`);

  rmSync(target, { recursive: true, force: true });

  return {
    success: true,
    package: pkgName,
    message: `Disabled package "${pkgName}" was permanently removed`,
  };
}

// ── HTTP routes ──────────────────────────────────────────────────────────

function fail(res, status, message) {
  res.status(status);
  return { error: message };
}

function notFoundOr400(message) {
  return /was not found/.test(message) ? 404 : 400;
}

export function routerListPackages() {
  /**
   * @register_router packages @method GET
   */
  return listPackages();
}

async function routerInspectRepo(req, res) {
  /**
   * Legacy Git endpoint, intentionally not registered.
   * @description Resolves a repository's default branch before installing, so the UI never has to guess "main".
   */
  const { url } = req.body || {};
  if (!url) return fail(res, 400, 'Field "url" is required');

  try {
    const defaultBranch = await detectDefaultBranch(url);
    return { url: String(url).trim(), defaultBranch, reachable: true };
  } catch (err) {
    return fail(res, 400, err.message);
  }
}

function routerInstallFromGit(req, res) {
  /**
   * Legacy Git endpoint, intentionally not registered.
   * @description Starts a Git install and returns a job id; follow progress on /pkgmgr/jobs/:id/stream.
   */
  const { url, branch } = req.body || {};
  if (!url) return fail(res, 400, 'Field "url" is required');

  let job;
  try {
    assertGitUrl(url);
    assertBranchName(branch);
    job = createJob('git', GIT_STEPS, String(url).trim());
  } catch (err) {
    return fail(res, 400, err.message);
  }

  // Detached on purpose: the response carries the job id and the client
  // subscribes to progress. The rejection is already recorded on the job.
  runGitInstall(job, { url, branch }).catch(() => {});
  res.status(202);
  return { jobId: job.id, job: publicJob(job) };
}

function routerInstallFromZip(req, res) {
  /**
   * Legacy ZIP endpoint, intentionally not registered.
   * @upload file 1 50mb memory
   * @description Installs a package from an uploaded .zip archive and returns a job id.
   */
  const file = req.file;
  if (!file?.buffer?.length) return fail(res, 400, 'No file was uploaded (field "file")');

  const filename = file.originalname || 'archive.zip';
  if (!/\.zip$/i.test(filename)) return fail(res, 400, 'Only .zip archives are supported');

  const job = createJob('zip', ZIP_STEPS, filename);
  runZipInstall(job, { buffer: file.buffer, filename }).catch(() => {});
  res.status(202);
  return { jobId: job.id, job: publicJob(job) };
}

export function routerGetJob(req, res) {
  /**
   * @register_router jobs/:id @method GET
   */
  const job = JOBS.get(req.params?.id);
  if (!job) return fail(res, 404, 'Install job was not found or has expired');
  return publicJob(job);
}

export function routerStreamJob(req, res) {
  /**
   * @register_router jobs/:id/stream @method GET
   * @streaming
   *
   * @streaming is required: without it the runtime serializes the handler's
   * return value and ends the response, killing the SSE connection on the
   * first byte.
   */
  const job = JOBS.get(req.params?.id);
  if (!job) {
    res.status(404).json({ error: 'Install job was not found or has expired' });
    return;
  }

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  res.write(`data: ${JSON.stringify(publicJob(job))}\n\n`);

  if (job.status !== 'running') {
    res.end();
    return;
  }

  job.subscribers.add(res);
  const close = () => job.subscribers.delete(res);
  req.on('close', close);
  req.on('error', close);
}

async function routerStoreCatalog(req, res) {
  /**
   * Legacy GitHub endpoint, intentionally not registered.
   * @description Lists the thinkiac-* catalog from GitHub, each entry described by its own package.json.
   */
  try {
    return await listStorePackages({ refresh: req.query?.refresh === '1' });
  } catch (err) {
    return fail(res, 502, err.message);
  }
}

async function routerStorePackage(req, res) {
  /**
   * Legacy GitHub endpoint, intentionally not registered.
   * @description Tools, routes and views a store package declares, read from its source on GitHub.
   */
  const { repo } = req.params || {};
  if (!repo) return fail(res, 400, 'Repository name is required');

  try {
    return await getStorePackage({ repo, refresh: req.query?.refresh === '1' });
  } catch (err) {
    return fail(res, /not in the/.test(err.message) ? 404 : 502, err.message);
  }
}

async function routerStoreReadme(req, res) {
  /**
   * Legacy GitHub endpoint, intentionally not registered.
   * @description Reads the README of one ThinkIac community package without installing it.
   */
  const { repo } = req.params || {};
  if (!repo) return fail(res, 400, 'Repository name is required');

  try {
    return await getStoreReadme({ repo, refresh: req.query?.refresh === '1' });
  } catch (err) {
    return fail(res, /not in the/.test(err.message) ? 404 : 502, err.message);
  }
}

async function routerStoreInstall(req, res) {
  /**
   * Legacy GitHub endpoint, intentionally not registered.
   * @description Starts an install for a store package and returns a job id, same as a Git install.
   */
  const { repo } = req.params || {};
  if (!repo) return fail(res, 400, 'Repository name is required');

  let entry;
  try {
    entry = await findCatalogEntry(repo);
  } catch (err) {
    return fail(res, /not in the/.test(err.message) ? 404 : 502, err.message);
  }
  if (!entry.hasManifest) return fail(res, 400, `"${repo}" has no package.json and cannot be installed`);

  const job = createJob('git', GIT_STEPS, entry.cloneUrl);
  runGitInstall(job, { url: entry.cloneUrl, branch: entry.defaultBranch }).catch(() => {});
  res.status(202);
  return { jobId: job.id, job: publicJob(job) };
}

export function routerDisablePackage(req, res) {
  /**
   * @register_router packages/:name/disable @method POST
   */
  const { name } = req.params || {};
  if (!name) return fail(res, 400, 'Package name is required');

  try {
    return disablePackage({ name });
  } catch (err) {
    return fail(res, notFoundOr400(err.message), err.message);
  }
}

export function routerEnablePackage(req, res) {
  /**
   * @register_router packages/:name/enable @method POST
   */
  const { name } = req.params || {};
  if (!name) return fail(res, 400, 'Package name is required');

  try {
    return enablePackage({ name, version: req.body?.version });
  } catch (err) {
    return fail(res, notFoundOr400(err.message), err.message);
  }
}

export function routerRemoveDisabledPackage(req, res) {
  /**
   * @register_router disabled/:name @method DELETE
   */
  const { name } = req.params || {};
  if (!name) return fail(res, 400, 'Package name is required');

  try {
    return removeDisabledPackage({ name });
  } catch (err) {
    return fail(res, notFoundOr400(err.message), err.message);
  }
}
