// External repo transport — the git plumbing behind the auto-repository.
//
// The bare repository at .logos/repo.git is the one the SSH server serves.
// The project root is its work tree: what a client clones is literally the
// code that is running. There is no copy and no deploy directory.
//
// Two hooks are installed into the bare repo, both thin shells around a
// generated node script (hooks/logos-hook.cjs) that reads its configuration
// from hooks/logos-hook.json — regenerated on every boot, so the callback URL
// always points at the port the runtime actually came up on:
//
//   pre-receive   enforces the per-key role (only `main` keys write to main)
//   post-receive  calls the running runtime back over HTTP
//
// Everything here is synchronous on purpose: it runs at boot or inside a
// push, never on a hot request path.
'use strict';
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.git = git;
exports.gitAvailable = gitAvailable;
exports.ensureRepo = ensureRepo;
exports.hasCommits = hasCommits;
exports.writeHooks = writeHooks;
exports.listBranches = listBranches;
exports.commitLog = commitLog;
exports.changedPaths = changedPaths;
exports.changedPackages = changedPackages;
exports.checkoutInto = checkoutInto;
exports.workTreeDirty = workTreeDirty;
exports.backupWorkTree = backupWorkTree;
exports.updateRef = updateRef;
exports.addWorktree = addWorktree;
exports.removeWorktree = removeWorktree;
exports.pruneWorktrees = pruneWorktrees;
const fs_1 = __importDefault(require("fs"));
const path_1 = __importDefault(require("path"));
const child_process_1 = require("child_process");
/** Files never committed by the initial seed (also honoured by `git add -A`). */
const SEED_EXCLUDES = [
    'node_modules/',
    'node_modules', // also when it is a symlink, which the trailing slash misses
    '.logos/',
    '.logos',
    '.git/',
    '.svelte-cache/',
    '.database/',
    'dist/',
    'build/',
    'uploads/',
    '.env',
    '*.log',
    '*.sqlite',
    '*.sqlite3',
    '*.db',
];
function git(gitDir, args, opts = {}) {
    const base = ['--git-dir', gitDir];
    if (opts.workTree)
        base.push('--work-tree', opts.workTree);
    const run = (0, child_process_1.spawnSync)('git', [...base, ...args], {
        encoding: 'utf-8',
        cwd: opts.cwd,
        input: opts.input,
        env: opts.env ?? process.env,
        maxBuffer: 32 * 1024 * 1024,
    });
    return {
        ok: run.status === 0,
        code: run.status,
        stdout: (run.stdout || '').trim(),
        stderr: (run.stderr || '').trim(),
    };
}
function gitAvailable() {
    const probe = (0, child_process_1.spawnSync)('git', ['--version'], { encoding: 'utf-8' });
    return probe.status === 0;
}
/**
 * Creates the bare repository if absent and makes sure it has a first commit
 * (seeded from whatever is already in the project root). Idempotent.
 */
function ensureRepo(paths, mainBranch, log) {
    // `.logos` may already exist as something else entirely — an empty marker
    // file is a real thing in the wild. Say so instead of failing on mkdir.
    if (fs_1.default.existsSync(paths.home) && !fs_1.default.statSync(paths.home).isDirectory()) {
        throw new Error(`${paths.home} exists and is not a directory — move it out of the way`);
    }
    fs_1.default.mkdirSync(paths.home, { recursive: true });
    let created = false;
    if (!fs_1.default.existsSync(path_1.default.join(paths.gitDir, 'HEAD'))) {
        const init = (0, child_process_1.spawnSync)('git', ['init', '--bare', paths.gitDir], { encoding: 'utf-8' });
        if (init.status !== 0)
            throw new Error(`git init --bare failed: ${(init.stderr || '').trim()}`);
        created = true;
        log(`[repo] bare repository created at ${paths.gitDir}`);
    }
    // HEAD must point at the main branch so a fresh clone checks it out.
    git(paths.gitDir, ['symbolic-ref', 'HEAD', `refs/heads/${mainBranch}`]);
    // The work tree is the project root; pushing into a checked-out branch is
    // exactly what we want here, so silence the safety refusal.
    git(paths.gitDir, ['config', 'receive.denyCurrentBranch', 'ignore']);
    git(paths.gitDir, ['config', 'core.logAllRefUpdates', 'true']);
    writeExcludes(paths);
    let seeded = false;
    if (!hasCommits(paths.gitDir, mainBranch)) {
        seeded = seedInitialCommit(paths, mainBranch, log);
    }
    return { created, seeded };
}
function writeExcludes(paths) {
    const infoDir = path_1.default.join(paths.gitDir, 'info');
    fs_1.default.mkdirSync(infoDir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(infoDir, 'exclude'), `# managed by logos/repo — keeps runtime artefacts out of the auto-repository\n${SEED_EXCLUDES.join('\n')}\n`);
}
function hasCommits(gitDir, branch) {
    return git(gitDir, ['rev-parse', '--verify', `refs/heads/${branch}`]).ok;
}
function seedInitialCommit(paths, mainBranch, log) {
    const index = path_1.default.join(paths.gitDir, 'logos-seed-index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    try {
        const add = git(paths.gitDir, ['add', '-A', '.'], { workTree: paths.root, cwd: paths.root, env });
        if (!add.ok) {
            log(`[repo] initial seed skipped: ${add.stderr}`);
            return false;
        }
        const tree = git(paths.gitDir, ['write-tree'], { workTree: paths.root, cwd: paths.root, env });
        if (!tree.ok || !tree.stdout) {
            log(`[repo] initial seed skipped: nothing to commit`);
            return false;
        }
        const commit = git(paths.gitDir, [
            '-c', 'user.name=Lógos', '-c', 'user.email=logos@localhost',
            'commit-tree', tree.stdout, '-m', 'chore(repo): seed auto-repository from working tree',
        ], { env });
        if (!commit.ok) {
            log(`[repo] initial seed failed: ${commit.stderr}`);
            return false;
        }
        git(paths.gitDir, ['update-ref', `refs/heads/${mainBranch}`, commit.stdout]);
        log(`[repo] seeded "${mainBranch}" with the current working tree (${commit.stdout.slice(0, 8)})`);
        return true;
    }
    finally {
        try {
            fs_1.default.unlinkSync(index);
        }
        catch { /* no index written */ }
    }
}
// ── Hooks ───────────────────────────────────────────────────────────────────
const HOOK_CLIENT = String.raw `#!/usr/bin/env node
// Generated by logos/repo — do not edit. Rewritten on every runtime boot.
'use strict';
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');

const phase = process.argv[2];
const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, 'logos-hook.json'), 'utf8'));

function readRefs(cb) {
  let buf = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', d => { buf += d; });
  process.stdin.on('end', () => {
    const refs = buf.split('\n').filter(Boolean).map(line => {
      const [oldSha, newSha, ref] = line.trim().split(/\s+/);
      return { oldSha, newSha, ref };
    });
    cb(refs);
  });
}

readRefs(refs => {
  if (phase === 'pre-receive') {
    const role = process.env.LOGOS_PUSH_ROLE || 'main';
    const mainRef = 'refs/heads/' + cfg.mainBranch;
    for (const r of refs) {
      if (r.ref === mainRef && role !== 'main') {
        process.stderr.write('\n  [logos] this key may push branches but not "' + cfg.mainBranch + '".\n\n');
        process.exit(1);
      }
      if (r.ref === mainRef && /^0+$/.test(r.newSha)) {
        process.stderr.write('\n  [logos] refusing to delete "' + cfg.mainBranch + '" — it is the running runtime.\n\n');
        process.exit(1);
      }
    }
    process.exit(0);
  }

  // post-receive: hand the refs to the running runtime and relay its answer.
  const body = JSON.stringify({ secret: cfg.secret, refs, role: process.env.LOGOS_PUSH_ROLE || 'main' });
  const url = new URL(cfg.hookUrl);
  const lib = url.protocol === 'https:' ? https : http;
  const req = lib.request({
    protocol: url.protocol,
    hostname: url.hostname,
    port: url.port,
    path: url.pathname,
    method: 'POST',
    timeout: cfg.timeoutMs || 120000,
    headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
  }, res => {
    let out = '';
    res.on('data', d => { out += d; });
    res.on('end', () => {
      let parsed = null;
      try { parsed = JSON.parse(out); } catch (_) { /* not our shape */ }
      const lines = (parsed && parsed.messages) || [];
      process.stderr.write('\n');
      for (const line of lines) process.stderr.write('  [logos] ' + line + '\n');
      if (!lines.length) process.stderr.write('  [logos] runtime answered ' + res.statusCode + '\n');
      process.stderr.write('\n');
      process.exit(0);
    });
  });
  req.on('timeout', () => { req.destroy(new Error('timeout')); });
  req.on('error', err => {
    process.stderr.write('\n  [logos] runtime not reachable (' + err.message + ') — refs stored, nothing deployed.\n\n');
    process.exit(0);
  });
  req.write(body);
  req.end();
});
`;
function writeHooks(paths, cfg) {
    const hooksDir = path_1.default.join(paths.gitDir, 'hooks');
    fs_1.default.mkdirSync(hooksDir, { recursive: true });
    fs_1.default.writeFileSync(path_1.default.join(hooksDir, 'logos-hook.cjs'), HOOK_CLIENT, { mode: 0o755 });
    fs_1.default.writeFileSync(path_1.default.join(hooksDir, 'logos-hook.json'), JSON.stringify(cfg, null, 2));
    for (const phase of ['pre-receive', 'post-receive']) {
        const script = `#!/bin/sh\n# managed by logos/repo\nexec ${process.execPath} "$(dirname "$0")/logos-hook.cjs" ${phase}\n`;
        fs_1.default.writeFileSync(path_1.default.join(hooksDir, phase), script, { mode: 0o755 });
    }
}
function listBranches(gitDir) {
    const sep = '\x1f';
    const res = git(gitDir, [
        'for-each-ref', '--sort=-committerdate',
        `--format=%(refname:short)${sep}%(objectname)${sep}%(contents:subject)${sep}%(authorname)${sep}%(committerdate:iso8601)`,
        'refs/heads',
    ]);
    if (!res.ok || !res.stdout)
        return [];
    return res.stdout.split('\n').map(line => {
        const [branch, sha, subject, author, committedAt] = line.split(sep);
        return { branch, sha, subject: subject || '', author: author || '', committedAt: committedAt || '' };
    });
}
function commitLog(gitDir, ref, limit = 20) {
    const sep = '\x1f';
    const res = git(gitDir, ['log', `-${limit}`, `--format=%H${sep}%s${sep}%an${sep}%aI`, ref]);
    if (!res.ok || !res.stdout)
        return [];
    return res.stdout.split('\n').map(line => {
        const [sha, subject, author, date] = line.split(sep);
        return { sha, subject, author, date };
    });
}
const ZERO = /^0+$/;
/** Paths touched between two revisions, relative to the repository root. */
function changedPaths(gitDir, oldSha, newSha) {
    const res = ZERO.test(oldSha || '')
        ? git(gitDir, ['ls-tree', '-r', '--name-only', newSha])
        : git(gitDir, ['diff', '--name-only', `${oldSha}..${newSha}`]);
    if (!res.ok || !res.stdout)
        return [];
    return res.stdout.split('\n').filter(Boolean);
}
/** Workspace package folders touched by a set of repository-relative paths. */
function changedPackages(paths, workspaceDirName) {
    const prefix = `${workspaceDirName}/`;
    const folders = new Set();
    for (const file of paths) {
        if (!file.startsWith(prefix))
            continue;
        const folder = file.slice(prefix.length).split('/')[0];
        if (folder)
            folders.add(folder);
    }
    return [...folders];
}
// ── Mutations ───────────────────────────────────────────────────────────────
/** Materialises `branch` into the project root (the live work tree). */
function checkoutInto(paths, branch) {
    return git(paths.gitDir, ['checkout', '-f', branch], { workTree: paths.root, cwd: paths.root });
}
/**
 * Everything in the work tree that differs from the deployed commit.
 *
 * A Lógos work tree is not a passive checkout: agents rewrite packages while
 * the runtime is running, and someone may well have edited a file on the box.
 * `checkout -f` would delete all of that without a word.
 */
function workTreeDirty(paths) {
    const res = git(paths.gitDir, ['status', '--porcelain', '--untracked-files=all'], { workTree: paths.root, cwd: paths.root });
    if (!res.ok || !res.stdout)
        return [];
    // "XY path" — but git() trims, so the first line has already lost the
    // leading space of a " M path". Match the status field instead of slicing
    // a fixed width.
    return res.stdout
        .split('\n')
        .map(line => line.replace(/^[ MADRCU?!]{1,2}\s+/, '').trim())
        .filter(Boolean);
}
/**
 * Commits the current work tree to a ref nobody checks out
 * (`refs/logos/worktree/<timestamp>`) so a deploy can overwrite it without
 * destroying anything. Returns the sha, or null when there was nothing to
 * save. Recover with:
 *
 *   git --git-dir=.logos/repo.git show <sha>:packages/foo/routes.js
 */
function backupWorkTree(paths, reason) {
    const index = path_1.default.join(paths.gitDir, 'logos-backup-index');
    const env = { ...process.env, GIT_INDEX_FILE: index };
    try {
        const add = git(paths.gitDir, ['add', '-A', '.'], { workTree: paths.root, cwd: paths.root, env });
        if (!add.ok)
            return null;
        const tree = git(paths.gitDir, ['write-tree'], { workTree: paths.root, cwd: paths.root, env });
        if (!tree.ok || !tree.stdout)
            return null;
        const commit = git(paths.gitDir, [
            '-c', 'user.name=Lógos', '-c', 'user.email=logos@localhost',
            'commit-tree', tree.stdout, '-m', `chore(repo): work tree before ${reason}`,
        ], { env });
        if (!commit.ok)
            return null;
        const ref = `refs/logos/worktree/${new Date().toISOString().replace(/[:.]/g, '-')}`;
        updateRef(paths.gitDir, ref, commit.stdout);
        return commit.stdout;
    }
    catch {
        return null;
    }
    finally {
        try {
            fs_1.default.unlinkSync(index);
        }
        catch { /* no index written */ }
    }
}
function updateRef(gitDir, ref, sha) {
    return git(gitDir, ['update-ref', ref, sha]);
}
function addWorktree(paths, dir, branch) {
    return git(paths.gitDir, ['worktree', 'add', '--force', '--detach', dir, branch]);
}
function removeWorktree(paths, dir) {
    const res = git(paths.gitDir, ['worktree', 'remove', '--force', dir]);
    git(paths.gitDir, ['worktree', 'prune']);
    return res;
}
function pruneWorktrees(paths) {
    git(paths.gitDir, ['worktree', 'prune']);
}
//# sourceMappingURL=git.js.map
