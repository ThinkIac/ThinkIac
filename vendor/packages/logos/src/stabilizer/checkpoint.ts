// stabilizer/checkpoint.ts — time travel for the workspace.
//
// Strategy 1 (preferred): a SHADOW git repository. We never touch the user's
// own .git — the shadow lives at <workspace>/.logos/shadow.git with the
// workspace as its work-tree. Every stable state becomes a commit; rollback
// of one package is `git checkout <commit> -- <pkg>`.
//
// Strategy 2 (fallback, no git on the machine): directory snapshots copied to
// <workspace>/.logos/snapshots/<pkg>/, keeping the last N per package.
//
// Databases: package .database dirs are EXCLUDED from git (binary churn) and
// snapshotted separately by snapshotDatabase()/restoreDatabase(), so a schema
// rollback restores code + data as one atomic unit.

'use strict';

import { spawnSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { ensureDir, copyDir, removeDirContents, safeReadJson, IGNORE_DIRS } from '../kernel/utils';

const KEEP_SNAPSHOTS = 5;

export class CheckpointStore {
  workspace: string;
  private logosDir: string;
  private gitDir: string;
  private stateFile: string;
  private mode: 'git' | 'copy';

  constructor(workspace: string) {
    this.workspace = workspace;
    this.logosDir = path.join(workspace, '.logos');
    this.gitDir = path.join(this.logosDir, 'shadow.git');
    this.stateFile = path.join(this.logosDir, 'checkpoints.json');
    ensureDir(this.logosDir);
    this.mode = this.gitAvailable() ? 'git' : 'copy';
    if (this.mode === 'git') this.initShadow();
    console.log(`[stabilizer] checkpoints via ${this.mode === 'git' ? 'shadow git' : 'directory snapshots'}`);
  }

  private git(args: string[]): { ok: boolean; out: string } {
    const result = spawnSync('git', [`--git-dir=${this.gitDir}`, `--work-tree=${this.workspace}`, ...args],
      { encoding: 'utf-8' });
    return { ok: result.status === 0, out: (result.stdout || '').trim() };
  }

  private gitAvailable(): boolean {
    try { return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0; }
    catch { return false; }
  }

  private initShadow(): void {
    if (!fs.existsSync(this.gitDir)) {
      spawnSync('git', ['init', '--bare', this.gitDir], { stdio: 'ignore' });
      spawnSync('git', [`--git-dir=${this.gitDir}`, 'config', 'user.email', 'logos@runtime'], { stdio: 'ignore' });
      spawnSync('git', [`--git-dir=${this.gitDir}`, 'config', 'user.name', 'Lógos Stabilizer'], { stdio: 'ignore' });
    }
    // Excludes: heavy/binary dirs never enter the shadow history.
    const excludeFile = path.join(this.gitDir, 'info', 'exclude');
    ensureDir(path.dirname(excludeFile));
    fs.writeFileSync(excludeFile, [
      'node_modules/', '.logos/', '.git/', '.svelte-cache/',
      '.database/', '*.db', '*.sqlite', '*.sqlite3', '.snapshots/', 'dist/',
      'data/', 'uploads/', 'profiles/', 'secrets/', 'generated/',
      'backups/', 'snapshots/', 'sessions/', 'shared-cache/',
      'terminal/profiles/', 'terminal/shared-cache/',
    ].join('\n'));
  }

  private readState(): Record<string, any> {
    return safeReadJson(this.stateFile) ?? {};
  }

  private writeState(state: Record<string, any>): void {
    fs.writeFileSync(this.stateFile, JSON.stringify(state, null, 2));
  }

  // ── Commit ────────────────────────────────────────────────────────────────

  /** Records a stable checkpoint. pkg = null means "whole workspace stable". */
  commitStable(pkg: string | null, reason = 'stable'): string | null {
    const label = pkg ?? '__workspace__';

    if (this.mode === 'git') {
      this.git(['add', '-A']);
      const commit = this.git(['commit', '-m', `stable(${label}): ${reason}`, '--allow-empty']);
      if (!commit.ok) return null;
      const rev = this.git(['rev-parse', 'HEAD']);
      if (!rev.ok) return null;

      const state = this.readState();
      state[label] = { ref: rev.out, ts: Date.now(), mode: 'git' };
      if (pkg) state['__workspace__'] = state['__workspace__'] ?? { ref: rev.out, ts: Date.now(), mode: 'git' };
      this.writeState(state);
      return rev.out;
    }

    // copy mode
    const target = pkg ? path.join(this.workspace, pkg) : this.workspace;
    if (!fs.existsSync(target)) return null;
    const snapRoot = path.join(this.logosDir, 'snapshots', label);
    const snapDir = path.join(snapRoot, String(Date.now()));
    copyDir(target, snapDir);
    this.prune(snapRoot);

    const state = this.readState();
    state[label] = { ref: snapDir, ts: Date.now(), mode: 'copy' };
    this.writeState(state);
    return snapDir;
  }

  private prune(snapRoot: string): void {
    if (!fs.existsSync(snapRoot)) return;
    const snaps = fs.readdirSync(snapRoot).sort();
    while (snaps.length > KEEP_SNAPSHOTS) {
      const oldest = snaps.shift()!;
      fs.rmSync(path.join(snapRoot, oldest), { recursive: true, force: true });
    }
  }

  lastStable(pkg: string | null): { ref: string; ts: number; mode: string } | null {
    return this.readState()[pkg ?? '__workspace__'] ?? null;
  }

  // ── Rollback ──────────────────────────────────────────────────────────────

  /** Restores one package to its last stable checkpoint. Returns the diff (git mode). */
  rollbackPackage(pkg: string): { ok: boolean; diff?: string; ts?: number } {
    const stable = this.lastStable(pkg);
    if (!stable) return { ok: false };

    if (stable.mode === 'git') {
      const diff = this.git(['diff', stable.ref, '--', pkg]);
      const checkout = this.git(['checkout', stable.ref, '--', pkg]);
      return { ok: checkout.ok, diff: diff.out, ts: stable.ts };
    }

    const pkgDir = path.join(this.workspace, pkg);
    removeDirContents(pkgDir);
    copyDir(stable.ref, pkgDir);
    return { ok: true, ts: stable.ts };
  }

  /** Restores the whole workspace (crash-loop recovery). */
  rollbackWorkspace(): { ok: boolean; ts?: number } {
    const stable = this.lastStable(null);
    if (!stable) return { ok: false };

    if (stable.mode === 'git') {
      const checkout = this.git(['checkout', stable.ref, '--', '.']);
      return { ok: checkout.ok, ts: stable.ts };
    }
    removeDirContents(this.workspace, new Set([...IGNORE_DIRS, '.logos']));
    copyDir(stable.ref, this.workspace);
    return { ok: true, ts: stable.ts };
  }

  // ── Database snapshots (schema rollback = code + data as one unit) ────────

  snapshotDatabase(pkg: string): string | null {
    // `.database` may be a directory (multi-file / per-tenant) or a single
    // SQLite file (auth, bags, memory, billing, …). Handle both — treating a
    // file as a dir throws ENOTDIR in copyDir/readdirSync.
    const dbPath = path.join(this.workspace, pkg, '.database');
    if (!fs.existsSync(dbPath)) return null;
    const isFile = fs.statSync(dbPath).isFile();
    const snapDir = path.join(this.logosDir, 'db-snapshots', pkg, String(Date.now()));
    if (isFile) {
      ensureDir(snapDir);
      fs.copyFileSync(dbPath, path.join(snapDir, '.database'));
    } else {
      copyDir(dbPath, snapDir, new Set());
    }
    this.prune(path.join(this.logosDir, 'db-snapshots', pkg));

    const state = this.readState();
    state[`db:${pkg}`] = { ref: snapDir, ts: Date.now(), mode: 'copy', file: isFile };
    this.writeState(state);
    return snapDir;
  }

  restoreDatabase(pkg: string): { ok: boolean; ts?: number } {
    const stable = this.readState()[`db:${pkg}`];
    if (!stable) return { ok: false };
    const dbPath = path.join(this.workspace, pkg, '.database');
    if (stable.file) {
      // Snapshot stored the single SQLite file as `<snapDir>/.database`.
      ensureDir(path.dirname(dbPath));
      fs.copyFileSync(path.join(stable.ref, '.database'), dbPath);
    } else {
      removeDirContents(dbPath, new Set());
      copyDir(stable.ref, dbPath, new Set());
    }
    return { ok: true, ts: stable.ts };
  }
}
