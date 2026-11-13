// modules/repo/branches.ts — branches that only exist while someone is looking.
//
// A push to a non-main branch costs nothing: git stores the objects and that
// is the end of it. No process, no port, no database. The branch materialises
// only when it is *requested* — an HTTP hit on `/@slug/`, `slug.host`, a tool
// call or the CLI — and it dies again once nobody has touched it for a while.
//
// The instance itself is a plain child Lógos runtime:
//
//   git worktree add .logos/worktrees/<slug> <branch>   (shares the object store)
//   node <entry>  with PORT / LOGOS_ROLE=branch          (fresh port from the pool)
//   GET /__health until it answers                       (readiness)
//   SIGTERM → git worktree remove → port back to the pool
//
// LOGOS_ROLE=branch is what stops the recursion: a child runtime sees it and
// keeps the repo module dormant — no SSH server, no hooks, no branches of its
// own (see index.ts).

'use strict';

import fs from 'fs';
import net from 'net';
import http from 'http';
import path from 'path';
import { spawn, ChildProcess } from 'child_process';
import { RepoPaths, slugify } from './paths';
import { addWorktree, removeWorktree, pruneWorktrees, git } from './git';

export type BranchStatus = 'booting' | 'live' | 'stopping' | 'failed';

export interface BranchInstance {
  branch: string;
  slug: string;
  port: number;
  pid: number | null;
  dir: string;
  status: BranchStatus;
  sha: string | null;
  startedAt: number;
  lastHit: number;
  /** Requests currently in flight through the proxy (a reaper veto). */
  inFlight: number;
  error?: string;
  /** Tail of the child's stdout/stderr, for the admin view. */
  output: string[];
}

export interface BranchesConfig {
  /** Inclusive port range for ephemeral instances. */
  ports: [number, number];
  /** Milliseconds without a hit before an instance is reaped. */
  idleTTLms: number;
  /** Hard cap on simultaneous instances; the least-recently-used is evicted. */
  max: number;
  /** How long to wait for /__health before giving up. */
  bootTimeoutMs: number;
  /** Entry script; defaults to the file that started this runtime. */
  entry?: string;
  runner?: { command: string; args: string[] };
  /** empty = fresh; clone = copy each package's .database. */
  db: 'empty' | 'clone' | 'shared';
  /** Always false: branch worktrees never receive .env files. */
  secrets: boolean;
  /** Environment variables passed through to instances. */
  envAllow: string[];
  /** Always false: branch runners never inherit the parent environment. */
  envInherit: boolean;
}

const ALWAYS_PASSED = ['PATH', 'HOME', 'LANG', 'LC_ALL', 'TZ', 'TMPDIR', 'SHELL', 'USER', 'NODE_ENV', 'NODE_OPTIONS'];
const OUTPUT_LINES = 60;

export interface BranchManagerOptions {
  paths: RepoPaths;
  config: BranchesConfig;
  workspaceDirName: string;
  log: (msg: string) => void;
  emit: (event: string, payload: any) => void;
}

export class BranchManager {
  private instances = new Map<string, BranchInstance>();
  private children = new Map<string, ChildProcess>();
  private booting = new Map<string, Promise<BranchInstance>>();
  private reaper: NodeJS.Timeout | null = null;
  private opts: BranchManagerOptions;

  constructor(opts: BranchManagerOptions) {
    this.opts = opts;
    this.recoverOrphans();
  }

  private get paths() { return this.opts.paths; }
  private get config() { return this.opts.config; }

  // ── Introspection ─────────────────────────────────────────────────────────

  list(): BranchInstance[] {
    return [...this.instances.values()].sort((a, b) => b.lastHit - a.lastHit);
  }

  get(slug: string): BranchInstance | null {
    return this.instances.get(slug) ?? null;
  }

  /** Marks an instance as in use — this is what keeps the reaper away. */
  touch(slug: string): void {
    const instance = this.instances.get(slug);
    if (instance) instance.lastHit = Date.now();
  }

  hold(slug: string): void {
    const instance = this.instances.get(slug);
    if (instance) { instance.inFlight += 1; instance.lastHit = Date.now(); }
  }

  release(slug: string): void {
    const instance = this.instances.get(slug);
    if (instance) { instance.inFlight = Math.max(0, instance.inFlight - 1); instance.lastHit = Date.now(); }
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Returns a live instance for `branch`, booting one if needed. Concurrent
   * callers during a cold start share the same boot promise, so a burst of
   * requests spawns exactly one process.
   */
  async ensure(branch: string): Promise<BranchInstance> {
    const slug = slugify(branch);
    const existing = this.instances.get(slug);
    if (existing && existing.status === 'live') {
      existing.lastHit = Date.now();
      return existing;
    }
    const inFlight = this.booting.get(slug);
    if (inFlight) return inFlight;

    const boot = this.boot(branch, slug).finally(() => this.booting.delete(slug));
    this.booting.set(slug, boot);
    return boot;
  }

  private async boot(branch: string, slug: string): Promise<BranchInstance> {
    await this.enforceCap();

    const dir = path.join(this.paths.worktrees, slug);
    const port = await this.allocatePort();
    const instance: BranchInstance = {
      branch, slug, port, dir, pid: null, status: 'booting', sha: null,
      startedAt: Date.now(), lastHit: Date.now(), inFlight: 0, output: [],
    };
    this.instances.set(slug, instance);
    this.opts.emit('repo:branch:booting', { branch, slug, port });

    try {
      this.materialise(branch, dir, instance);
      const child = this.spawnRuntime(branch, slug, dir, port, instance);
      this.children.set(slug, child);
      await this.waitForHealth(port, instance);

      instance.status = 'live';
      instance.pid = child.pid ?? null;
      this.persist();
      this.opts.log(`[repo] branch "${branch}" is live on port ${port} (pid ${child.pid})`);
      this.opts.emit('repo:branch:up', { branch, slug, port, pid: child.pid });
      return instance;
    } catch (err: any) {
      instance.status = 'failed';
      instance.error = err.message;
      this.opts.log(`[repo] branch "${branch}" failed to boot: ${err.message}`);
      this.opts.emit('repo:branch:failed', { branch, slug, error: err.message, output: instance.output });
      await this.stop(slug, 'boot-failed');
      throw err;
    }
  }

  /** git worktree + node_modules + optional database/secrets. */
  private materialise(branch: string, dir: string, instance: BranchInstance): void {
    if (fs.existsSync(dir)) removeWorktree(this.paths, dir);
    fs.mkdirSync(this.paths.worktrees, { recursive: true });

    const added = addWorktree(this.paths, dir, branch);
    if (!added.ok) throw new Error(`git worktree add failed: ${added.stderr || added.stdout}`);
    instance.sha = git(this.paths.gitDir, ['rev-parse', branch]).stdout || null;

    // node_modules is shared by symlink — an ephemeral branch must never pay
    // for an install, and the object store is already shared anyway.
    const rootModules = path.join(this.paths.root, 'node_modules');
    const branchModules = path.join(dir, 'node_modules');
    if (fs.existsSync(rootModules) && !fs.existsSync(branchModules)) {
      try { fs.symlinkSync(rootModules, branchModules, 'dir'); }
      catch (err: any) { this.opts.log(`[repo] could not link node_modules: ${err.message}`); }
    }

    this.provisionData(dir);
  }

  /** Databases and .env files, according to policy. */
  private provisionData(dir: string): void {
    const mode = this.config.db;
    const workspace = path.join(this.paths.root, this.opts.workspaceDirName);
    if (!fs.existsSync(workspace)) return;

    for (const folder of fs.readdirSync(workspace)) {
      const sourcePkg = path.join(workspace, folder);
      const targetPkg = path.join(dir, this.opts.workspaceDirName, folder);
      if (!fs.existsSync(targetPkg) || !fs.statSync(sourcePkg).isDirectory()) continue;

      if (mode !== 'empty') {
        const sourceDb = path.join(sourcePkg, '.database');
        const targetDb = path.join(targetPkg, '.database');
        if (fs.existsSync(sourceDb) && !fs.existsSync(targetDb)) {
          try {
            if (mode === 'shared') fs.symlinkSync(sourceDb, targetDb, 'dir');
            else fs.cpSync(sourceDb, targetDb, { recursive: true });
          } catch (err: any) { this.opts.log(`[repo] database provisioning for "${folder}": ${err.message}`); }
        }
      }

      if (this.config.secrets) {
        const sourceEnv = path.join(sourcePkg, '.env');
        const targetEnv = path.join(targetPkg, '.env');
        if (fs.existsSync(sourceEnv) && !fs.existsSync(targetEnv)) {
          try { fs.copyFileSync(sourceEnv, targetEnv); } catch { /* best effort */ }
        }
      }
    }

    if (this.config.secrets) {
      const rootEnv = path.join(this.paths.root, '.env');
      if (fs.existsSync(rootEnv) && !fs.existsSync(path.join(dir, '.env'))) {
        try { fs.copyFileSync(rootEnv, path.join(dir, '.env')); } catch { /* best effort */ }
      }
    }
  }

  private resolveEntry(dir: string): string {
    const configured = this.config.entry ?? process.argv[1];
    if (!configured) throw new Error('cannot determine the entry script (set repo.branches.entry)');
    const absolute = path.resolve(configured);
    const relative = path.relative(this.paths.root, absolute);
    // Entry inside the project → run the branch's own copy of it.
    if (relative && !relative.startsWith('..') && !path.isAbsolute(relative)) {
      return path.join(dir, relative);
    }
    return absolute;
  }

  private buildEnv(branch: string, slug: string, port: number): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = this.config.envInherit ? { ...process.env } : {};
    if (!this.config.envInherit) {
      for (const name of [...ALWAYS_PASSED, ...this.config.envAllow]) {
        if (process.env[name] !== undefined) env[name] = process.env[name];
      }
    }
    env.PORT = String(port);
    env.LOGOS_PORT = String(port);
    env.LOGOS_ROLE = 'branch';
    env.LOGOS_BRANCH = branch;
    env.LOGOS_BRANCH_SLUG = slug;
    // An ephemeral preview is not production, whatever the parent thinks.
    env.NODE_ENV = env.NODE_ENV === 'production' ? 'production' : (env.NODE_ENV ?? 'development');
    return env;
  }

  private spawnRuntime(branch: string, slug: string, dir: string, port: number, instance: BranchInstance): ChildProcess {
    const entry = this.resolveEntry(dir);
    if (!fs.existsSync(entry)) throw new Error(`entry script not found in branch: ${entry}`);
    if (!this.config.runner?.command) {
      throw new Error('branch execution requires repo.branches.runner (an isolated runner); local child processes are disabled');
    }

    const child = spawn(this.config.runner.command, this.config.runner.args, {
      cwd: dir,
      env: this.buildEnv(branch, slug, port),
      stdio: ['pipe', 'pipe', 'pipe'],
      detached: false,
    });
    child.stdin?.end(JSON.stringify({
      version: 1,
      workspace: dir,
      entry,
      port,
      branch,
      slug,
      env: this.buildEnv(branch, slug, port),
      // The worker must mount only this worktree and explicitly allowed
      // dependencies; it must not inherit the runtime workspace or secrets.
      isolation: { filesystem: 'worktree-only', secrets: false, database: this.config.db },
    }));

    const capture = (chunk: Buffer) => {
      for (const line of chunk.toString().split('\n')) {
        if (!line.trim()) continue;
        instance.output.push(line);
        if (instance.output.length > OUTPUT_LINES) instance.output.shift();
      }
    };
    child.stdout?.on('data', capture);
    child.stderr?.on('data', capture);

    child.on('exit', (code, signal) => {
      this.children.delete(slug);
      const current = this.instances.get(slug);
      if (!current || current.status === 'stopping') return;
      current.status = 'failed';
      current.error = `exited with ${signal ?? code}`;
      this.opts.log(`[repo] branch "${branch}" died (${signal ?? code})`);
      this.opts.emit('repo:branch:down', { branch, slug, reason: 'crashed', code, signal });
      this.cleanupWorktree(slug, dir);
    });

    return child;
  }

  private async waitForHealth(port: number, instance: BranchInstance): Promise<void> {
    const deadline = Date.now() + this.config.bootTimeoutMs;
    let lastError = 'timed out';
    while (Date.now() < deadline) {
      if (instance.status === 'failed') throw new Error(instance.error || 'process died during boot');
      const ok = await probe(port).catch((err: Error) => { lastError = err.message; return false; });
      if (ok) return;
      await delay(150);
    }
    throw new Error(`branch did not answer /__health within ${this.config.bootTimeoutMs}ms (${lastError})`);
  }

  async stop(slug: string, reason: string): Promise<boolean> {
    const instance = this.instances.get(slug);
    if (!instance) return false;
    instance.status = 'stopping';

    const child = this.children.get(slug);
    if (child && child.pid) {
      child.kill('SIGTERM');
      const died = await waitForExit(child, 5_000);
      if (!died) { try { child.kill('SIGKILL'); } catch { /* already gone */ } }
    }
    this.children.delete(slug);
    this.cleanupWorktree(slug, instance.dir);
    this.instances.delete(slug);
    this.persist();
    this.opts.log(`[repo] branch "${instance.branch}" stopped (${reason})`);
    this.opts.emit('repo:branch:down', { branch: instance.branch, slug, reason });
    return true;
  }

  private cleanupWorktree(slug: string, dir: string): void {
    try {
      if (fs.existsSync(dir)) removeWorktree(this.paths, dir);
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true });
    } catch (err: any) {
      this.opts.log(`[repo] worktree cleanup for "${slug}": ${err.message}`);
    }
  }

  async stopAll(reason: string): Promise<void> {
    await Promise.all([...this.instances.keys()].map(slug => this.stop(slug, reason)));
  }

  // ── Reaper ────────────────────────────────────────────────────────────────

  startReaper(intervalMs = 30_000): void {
    if (this.reaper) return;
    this.reaper = setInterval(() => this.sweep(), intervalMs);
    this.reaper.unref?.();
  }

  stopReaper(): void {
    if (this.reaper) clearInterval(this.reaper);
    this.reaper = null;
  }

  /** Reaps every instance that is idle, quiet and not serving anything. */
  async sweep(): Promise<string[]> {
    const now = Date.now();
    const reaped: string[] = [];
    for (const instance of [...this.instances.values()]) {
      if (instance.status !== 'live') continue;
      if (instance.inFlight > 0) continue;
      if (now - instance.lastHit < this.config.idleTTLms) continue;
      await this.stop(instance.slug, 'idle');
      reaped.push(instance.slug);
    }
    return reaped;
  }

  private async enforceCap(): Promise<void> {
    const live = this.list().filter(i => i.status === 'live' || i.status === 'booting');
    if (live.length < this.config.max) return;
    const victim = [...live].reverse().find(i => i.inFlight === 0);
    if (!victim) throw new Error(`branch limit reached (${this.config.max}) and every instance is busy`);
    await this.stop(victim.slug, 'evicted');
  }

  // ── Ports ─────────────────────────────────────────────────────────────────

  private async allocatePort(): Promise<number> {
    const [from, to] = this.config.ports;
    const taken = new Set([...this.instances.values()].map(i => i.port));
    for (let port = from; port <= to; port++) {
      if (taken.has(port)) continue;
      if (await isFree(port)) return port;
    }
    throw new Error(`no free port in ${from}-${to}`);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private persist(): void {
    try {
      fs.mkdirSync(this.paths.home, { recursive: true });
      const snapshot = {
        owner: process.pid,
        updatedAt: new Date().toISOString(),
        instances: this.list().map(({ output, ...rest }) => rest),
      };
      fs.writeFileSync(this.paths.registry, JSON.stringify(snapshot, null, 2));
    } catch { /* the registry is a convenience, never a source of truth */ }
  }

  /**
   * A previous runtime may have been killed without reaping its children.
   * Their pids are in branches.json; they are not our children any more, so
   * signal them directly and clear the worktrees they left behind.
   */
  private recoverOrphans(): void {
    let snapshot: any = null;
    try { snapshot = JSON.parse(fs.readFileSync(this.paths.registry, 'utf-8')); } catch { return; }
    if (!snapshot?.instances?.length) return;
    if (snapshot.owner === process.pid) return;

    for (const orphan of snapshot.instances) {
      if (orphan.pid) {
        try { process.kill(orphan.pid, 'SIGTERM'); this.opts.log(`[repo] reaped orphan branch "${orphan.branch}" (pid ${orphan.pid})`); }
        catch { /* already dead */ }
      }
      if (orphan.dir) {
        try {
          removeWorktree(this.paths, orphan.dir);
          if (fs.existsSync(orphan.dir)) fs.rmSync(orphan.dir, { recursive: true, force: true });
        } catch { /* best effort */ }
      }
    }
    pruneWorktrees(this.paths);
    try { fs.unlinkSync(this.paths.registry); } catch { /* gone */ }
  }
}

// ── helpers ─────────────────────────────────────────────────────────────────

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isFree(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const probe = net.createServer();
    probe.once('error', () => resolve(false));
    probe.once('listening', () => probe.close(() => resolve(true)));
    probe.listen(port, '127.0.0.1');
  });
}

function probe(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const req = http.get({ host: '127.0.0.1', port, path: '/__health', timeout: 1_000 }, res => {
      res.resume();
      resolve((res.statusCode ?? 500) < 500);
    });
    req.on('timeout', () => { req.destroy(); resolve(false); });
    req.on('error', () => resolve(false));
  });
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (child.exitCode !== null || child.signalCode !== null) return Promise.resolve(true);
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), timeoutMs);
    timer.unref?.();
    child.once('exit', () => { clearTimeout(timer); resolve(true); });
  });
}

