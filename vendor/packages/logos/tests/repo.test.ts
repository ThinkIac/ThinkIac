// tests/repo.test.ts — the auto-repository.
//
// The pure parts (config, key parsing, command parsing, routing) are unit
// tested. The git layer is exercised against a real temporary repository —
// it is the part most likely to break silently, and creating a bare repo in
// tmp is cheap. No SSH server and no child runtimes are started here.

import fs from 'fs';
import crypto from 'crypto';
import os from 'os';
import path from 'path';
import { execFileSync } from 'child_process';
import { describe, it, expect, beforeAll } from 'vitest';

import { repoPaths, slugify } from '../src/modules/repo/paths';
import { normalizeConfig, parseDuration, isAuthorizedAdminRequest } from '../src/modules/repo';
import { parseAuthorizedKeys } from '../src/modules/repo/keys';
import { parseGitCommand } from '../src/modules/repo/ssh';
import { verifyDelegatedCredential, DELEGATION_PREFIX } from '../src/modules/repo/delegation';
import { resolveTarget } from '../src/modules/repo/proxy';
import {
  ensureRepo, writeHooks, listBranches, changedPaths, changedPackages,
  commitLog, checkoutInto, updateRef, git, gitAvailable, hasCommits,
  workTreeDirty, backupWorkTree,
} from '../src/modules/repo/git';

// ── paths ───────────────────────────────────────────────────────────────────

describe('repoPaths / slugify', () => {
  it('puts everything under <project>/.logos, next to packages/', () => {
    const paths = repoPaths('/srv/app/packages');
    expect(paths.root).toBe('/srv/app');
    expect(paths.gitDir).toBe('/srv/app/.logos/repo.git');
    expect(paths.authorizedKeys).toBe('/srv/app/.logos/authorized_keys');
  });

  it('makes branch names safe for URLs and hostnames', () => {
    expect(slugify('feature/checkout')).toMatch(/^feature-checkout-[a-f0-9]{8}$/);
    expect(slugify('Fix_Ção-99')).toMatch(/^fix-cao-99-[a-f0-9]{8}$/);
    expect(slugify('---')).toMatch(/^branch-[a-f0-9]{8}$/);
    expect(slugify('feature/a')).not.toBe(slugify('feature-a'));
    expect(slugify('a'.repeat(80)).length).toBe(41);
  });
});

// ── config ──────────────────────────────────────────────────────────────────

describe('normalizeConfig', () => {
  it('is off unless asked for', () => {
    expect(normalizeConfig(undefined).enabled).toBe(false);
    expect(normalizeConfig(false).enabled).toBe(false);
  });

  it('takes `repo: true` as "everything, with defaults"', () => {
    const config = normalizeConfig(true);
    expect(config.enabled).toBe(true);
    expect(config.ssh.port).toBe(2222);
    expect(config.main.branch).toBe('main');
    expect(config.main.onPush).toBe('stabilize');
    expect(config.branches.enabled).toBe(true);
    expect(config.branches.ports).toEqual([5100, 5199]);
  });

  it('reads durations in human units', () => {
    expect(parseDuration('10m', 0)).toBe(600_000);
    expect(parseDuration('45s', 0)).toBe(45_000);
    expect(parseDuration('1.5h', 0)).toBe(5_400_000);
    expect(parseDuration(1234, 0)).toBe(1234);
    expect(parseDuration('nonsense', 99)).toBe(99);
    expect(normalizeConfig({ branches: { idleTTL: '2m' } }).branches.idleTTLms).toBe(120_000);
  });

  it('never passes secrets, shared databases, or the parent environment to branches', () => {
    const config = normalizeConfig({ branches: {} });
    expect(config.branches.secrets).toBe(false);
    expect(config.branches.envInherit).toBe(false);
    expect(normalizeConfig({ branches: { secrets: true, db: 'shared', env: { inherit: true, allow: ['API_URL'] } } }).branches)
      .toMatchObject({ secrets: false, db: 'empty', envInherit: false, envAllow: ['API_URL'] });
  });

  it('requires an explicit isolated runner to execute a branch', () => {
    expect(normalizeConfig({ branches: {} }).branches.runner).toBeUndefined();
    expect(normalizeConfig({ branches: { runner: { command: 'thinkiac-branch-runner', args: ['--json'] } } }).branches.runner)
      .toEqual({ command: 'thinkiac-branch-runner', args: ['--json'] });
  });
});

describe('repo admin authentication', () => {
  const request = (headers: Record<string, string>) => ({ headers, get: (name: string) => headers[name.toLowerCase()] });
  it('accepts the configured bearer token and rejects missing or incorrect ones', () => {
    expect(isAuthorizedAdminRequest(request({ authorization: 'Bearer correct' }), 'correct')).toBe(true);
    expect(isAuthorizedAdminRequest(request({}), 'correct')).toBe(false);
    expect(isAuthorizedAdminRequest(request({ 'x-logos-repo-token': 'wrong' }), 'correct')).toBe(false);
  });

  it('lets a single sub-key be turned off without losing the rest', () => {
    const config = normalizeConfig({ ssh: { enabled: false }, branches: { enabled: false } });
    expect(config.enabled).toBe(true);
    expect(config.ssh.enabled).toBe(false);
    expect(config.branches.enabled).toBe(false);
  });
});

describe('Git Cloud delegated SSH identities', () => {
  it('accepts a signed unexpired identity and rejects a tampered one', () => {
    const pair = crypto.generateKeyPairSync('ed25519');
    const payload = Buffer.from(JSON.stringify({ v: 1, machine: 'abc234', actor: 'user-1', role: 'read', exp: 2_000_000_000 })).toString('base64url');
    const signature = crypto.sign(null, Buffer.from(`thinkiac:git-delegation:v1:${payload}`), pair.privateKey).toString('base64url');
    const token = `${DELEGATION_PREFIX}${payload}.${signature}`;
    const pub = pair.publicKey.export({ type: 'spki', format: 'pem' }).toString();
    expect(verifyDelegatedCredential(token, pub, 'abc234', () => 1_000)).toMatchObject({ machine: 'abc234', actor: 'user-1', role: 'read' });
    expect(verifyDelegatedCredential(token, pub, 'other-machine', () => 1_000)).toBeNull();
    expect(verifyDelegatedCredential(`${token}x`, pub, 'abc234', () => 1_000)).toBeNull();
  });
});

// ── authorized keys ─────────────────────────────────────────────────────────

const KEY_A = 'AAAAC3NzaC1lZDI1NTE5AAAAIN1IPvsFDQ0000000000000000000000000000000000';
const KEY_B = 'AAAAC3NzaC1lZDI1NTE5AAAAIN1IPvsFDQ1111111111111111111111111111111111';

describe('parseAuthorizedKeys', () => {
  it('reads plain OpenSSH lines and defaults the role to main', () => {
    const [key] = parseAuthorizedKeys(`ssh-ed25519 ${KEY_A} alice@laptop`);
    expect(key.type).toBe('ssh-ed25519');
    expect(key.comment).toBe('alice@laptop');
    expect(key.role).toBe('main');
  });

  it('reads the role prefix', () => {
    const keys = parseAuthorizedKeys([
      `logos-role=branch ssh-ed25519 ${KEY_A} alice`,
      `logos-role=read ssh-ed25519 ${KEY_B} bob`,
    ].join('\n'));
    expect(keys.map(k => k.role)).toEqual(['branch', 'read']);
  });

  it('skips comments, blanks and garbage', () => {
    const keys = parseAuthorizedKeys([
      '# a comment',
      '',
      'not-a-key at all',
      `ssh-ed25519 ${KEY_A} ok`,
    ].join('\n'));
    expect(keys).toHaveLength(1);
    expect(keys[0].comment).toBe('ok');
  });

  it('decodes the blob so it can be compared with what the wire sends', () => {
    const [key] = parseAuthorizedKeys(`ssh-ed25519 ${KEY_A} alice`);
    expect(Buffer.isBuffer(key.blob)).toBe(true);
    expect(key.blob.length).toBeGreaterThan(0);
  });
});

// ── ssh command parsing ─────────────────────────────────────────────────────

describe('parseGitCommand', () => {
  it('accepts the two commands git actually sends', () => {
    expect(parseGitCommand("git-upload-pack '/project'")).toEqual({ verb: 'upload-pack', repo: '/project' });
    expect(parseGitCommand("git-receive-pack '/project'")).toEqual({ verb: 'receive-pack', repo: '/project' });
    expect(parseGitCommand('git upload-pack /project')).toEqual({ verb: 'upload-pack', repo: '/project' });
  });

  it('refuses everything else — this endpoint has no shell', () => {
    expect(parseGitCommand('bash')).toBeNull();
    expect(parseGitCommand('git-upload-archive \'/project\'')).toBeNull();
    expect(parseGitCommand("git-upload-pack '/project'; rm -rf /")).toBeNull();
    expect(parseGitCommand('')).toBeNull();
  });
});

// ── proxy routing ───────────────────────────────────────────────────────────

describe('resolveTarget', () => {
  const known = (slug: string) => slug === 'my-feature';

  it('routes /@slug/… and strips the prefix', () => {
    expect(resolveTarget('path', '/@my-feature/dashboard?x=1', 'host', known))
      .toEqual({ slug: 'my-feature', path: '/dashboard?x=1' });
    expect(resolveTarget('path', '/@my-feature', 'host', known))
      .toEqual({ slug: 'my-feature', path: '/' });
  });

  it('routes by subdomain and keeps the URL intact', () => {
    expect(resolveTarget('subdomain', '/dashboard', 'my-feature.example.com:5040', known))
      .toEqual({ slug: 'my-feature', path: '/dashboard' });
  });

  it('never routes an unknown slug — a typo must not spawn a process', () => {
    expect(resolveTarget('path', '/@typo/x', 'host', known)).toBeNull();
    expect(resolveTarget('subdomain', '/x', 'typo.example.com', known)).toBeNull();
  });

  it('leaves ordinary traffic alone', () => {
    expect(resolveTarget('path', '/hello/ping', 'host', known)).toBeNull();
    expect(resolveTarget('subdomain', '/x', 'localhost:5040', known)).toBeNull();
    expect(resolveTarget('port-only', '/@my-feature/x', 'my-feature.example.com', known)).toBeNull();
  });
});

// ── package mapping ─────────────────────────────────────────────────────────

describe('changedPackages', () => {
  it('maps touched files to workspace package folders', () => {
    expect(changedPackages([
      'packages/hello/routes.js',
      'packages/hello/views/Home.svelte',
      'packages/billing/tools.js',
      'server.js',
      'README.md',
    ], 'packages').sort()).toEqual(['billing', 'hello']);
  });

  it('ignores everything outside the workspace', () => {
    expect(changedPackages(['server.js', 'docker/Dockerfile'], 'packages')).toEqual([]);
  });
});

// ── the git layer, for real ─────────────────────────────────────────────────

const hasGit = gitAvailable();

describe.skipIf(!hasGit)('git layer', () => {
  let root: string;
  let paths: ReturnType<typeof repoPaths>;
  const log = () => {};

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-repo-test-'));
    fs.mkdirSync(path.join(root, 'packages', 'hello'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'hello', 'routes.js'), '// v1\n');
    fs.writeFileSync(path.join(root, 'server.js'), 'require("logos").bootstrap();\n');
    // Things the seed must not swallow.
    fs.mkdirSync(path.join(root, 'node_modules', 'junk'), { recursive: true });
    fs.writeFileSync(path.join(root, 'node_modules', 'junk', 'index.js'), 'x');
    fs.writeFileSync(path.join(root, '.env'), 'SECRET=hunter2\n');
    paths = repoPaths(path.join(root, 'packages'));
  });

  it('creates a bare repo and seeds main from the working tree', () => {
    const result = ensureRepo(paths, 'main', log);
    expect(result.created).toBe(true);
    expect(result.seeded).toBe(true);
    expect(hasCommits(paths.gitDir, 'main')).toBe(true);

    const tracked = git(paths.gitDir, ['ls-tree', '-r', '--name-only', 'main']).stdout.split('\n');
    expect(tracked).toContain('packages/hello/routes.js');
    expect(tracked).toContain('server.js');
    expect(tracked.some(f => f.startsWith('node_modules/'))).toBe(false);
    expect(tracked).not.toContain('.env');
  });

  it('is idempotent', () => {
    const again = ensureRepo(paths, 'main', log);
    expect(again.created).toBe(false);
    expect(again.seeded).toBe(false);
  });

  it('points HEAD at main so a clone lands on it', () => {
    expect(git(paths.gitDir, ['symbolic-ref', 'HEAD']).stdout).toBe('refs/heads/main');
  });

  it('installs both hooks, executable, with a config the runtime rewrote', () => {
    writeHooks(paths, { mainBranch: 'main', hookUrl: 'http://127.0.0.1:5040/_logos/repo/hook', secret: 's3cr3t' });
    for (const hook of ['pre-receive', 'post-receive', 'logos-hook.cjs']) {
      const file = path.join(paths.gitDir, 'hooks', hook);
      expect(fs.existsSync(file)).toBe(true);
      expect(fs.statSync(file).mode & 0o111).toBeTruthy();
    }
    const cfg = JSON.parse(fs.readFileSync(path.join(paths.gitDir, 'hooks', 'logos-hook.json'), 'utf-8'));
    expect(cfg).toMatchObject({ mainBranch: 'main', secret: 's3cr3t' });
  });

  it('lists branches with their last commit', () => {
    const branches = listBranches(paths.gitDir);
    expect(branches.map(b => b.branch)).toContain('main');
    expect(branches[0].sha).toMatch(/^[0-9a-f]{40}$/);
    expect(branches[0].subject).toMatch(/seed auto-repository/);
  });

  it('reports the files a revision range touched', () => {
    const first = git(paths.gitDir, ['rev-parse', 'main']).stdout;

    // A second commit, made the way a push would leave things.
    checkoutInto(paths, 'main');
    fs.writeFileSync(path.join(root, 'packages', 'hello', 'routes.js'), '// v2\n');
    const index = path.join(paths.gitDir, 'commit-index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    git(paths.gitDir, ['add', '-A', '.'], { workTree: root, cwd: root, env });
    const tree = git(paths.gitDir, ['write-tree'], { workTree: root, cwd: root, env }).stdout;
    const second = git(paths.gitDir, [
      '-c', 'user.name=t', '-c', 'user.email=t@t',
      'commit-tree', tree, '-p', first, '-m', 'edit hello',
    ], { env }).stdout;
    updateRef(paths.gitDir, 'refs/heads/main', second);

    const files = changedPaths(paths.gitDir, first, second);
    expect(files).toEqual(['packages/hello/routes.js']);
    expect(changedPackages(files, 'packages')).toEqual(['hello']);
    expect(commitLog(paths.gitDir, 'main', 5)[0].subject).toBe('edit hello');
  });

  it('treats an all-zero old sha as "everything in the new commit"', () => {
    const head = git(paths.gitDir, ['rev-parse', 'main']).stdout;
    const files = changedPaths(paths.gitDir, '0000000000000000000000000000000000000000', head);
    expect(files).toContain('server.js');
    expect(files).toContain('packages/hello/routes.js');
  });

  it('parks an uncommitted work tree before a deploy overwrites it', () => {
    checkoutInto(paths, 'main');
    expect(workTreeDirty(paths)).toEqual([]);

    fs.writeFileSync(path.join(root, 'packages', 'hello', 'routes.js'), '// an agent wrote this\n');
    fs.writeFileSync(path.join(root, 'packages', 'hello', 'brand-new.js'), '// and this\n');
    const dirty = workTreeDirty(paths);
    expect(dirty).toContain('packages/hello/routes.js');
    expect(dirty).toContain('packages/hello/brand-new.js');

    const backup = backupWorkTree(paths, 'a test');
    expect(backup).toMatch(/^[0-9a-f]{40}$/);

    // The deploy wins on disk…
    checkoutInto(paths, 'main');
    expect(fs.readFileSync(path.join(root, 'packages', 'hello', 'routes.js'), 'utf-8')).toBe('// v2\n');
    // …but nothing was lost.
    const saved = git(paths.gitDir, ['show', `${backup}:packages/hello/routes.js`]).stdout;
    expect(saved).toBe('// an agent wrote this');
    expect(git(paths.gitDir, ['show', `${backup}:packages/hello/brand-new.js`]).stdout).toBe('// and this');

    // Parked out of the way, not on a branch anyone checks out.
    const refs = git(paths.gitDir, ['for-each-ref', '--format=%(refname)', 'refs/logos']).stdout;
    expect(refs).toMatch(/^refs\/logos\/worktree\//m);
    expect(listBranches(paths.gitDir).map(b => b.branch)).not.toContain('logos');

    try { fs.unlinkSync(path.join(root, 'packages', 'hello', 'brand-new.js')); } catch { /* checkout may have removed it */ }
  });

  it('checks a branch out into the live work tree', () => {
    const other = execFileSync('git', ['--git-dir', paths.gitDir, 'rev-parse', 'main'], { encoding: 'utf-8' }).trim();
    updateRef(paths.gitDir, 'refs/heads/preview', other);

    fs.writeFileSync(path.join(root, 'packages', 'hello', 'routes.js'), '// dirty\n');
    const out = checkoutInto(paths, 'main');
    expect(out.ok).toBe(true);
    expect(fs.readFileSync(path.join(root, 'packages', 'hello', 'routes.js'), 'utf-8')).toBe('// v2\n');
    expect(listBranches(paths.gitDir).map(b => b.branch)).toContain('preview');
  });
});

