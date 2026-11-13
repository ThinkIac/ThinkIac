// tests/checkpoint.test.ts — the workspace time-travel store.
//
// Exercises the shadow-git strategy (git is available in CI/dev) for
// commit + per-package rollback, and the git-independent database snapshot
// path. Each test uses a throwaway workspace so the real repo is never touched.

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { describe, it, expect, afterEach, beforeEach } from 'vitest';
import { CheckpointStore } from '../src/stabilizer/checkpoint';
import { makeWorkspace, FixtureWorkspace } from './helpers';

const hasGit = (() => {
  try { execSync('git --version', { stdio: 'ignore' }); return true; } catch { return false; }
})();

let ws: FixtureWorkspace;
beforeEach(() => { ws = makeWorkspace(); });
afterEach(() => ws.cleanup());

describe('CheckpointStore (shadow git)', () => {
  it.skipIf(!hasGit)('commits a stable checkpoint and reports the last stable ref', () => {
    ws.pkg('alpha', { 'routes.js': 'exports.v = 1;' });
    const store = new CheckpointStore(ws.root);
    const ref = store.commitStable('alpha', 'first');
    expect(ref).toBeTruthy();
    const last = store.lastStable('alpha');
    expect(last).toMatchObject({ ref, mode: 'git' });
  });

  it.skipIf(!hasGit)('rolls a package back to its last stable content', () => {
    const dir = ws.pkg('alpha', { 'routes.js': 'exports.v = 1;' });
    const store = new CheckpointStore(ws.root);
    store.commitStable('alpha');

    fs.writeFileSync(path.join(dir, 'routes.js'), 'exports.v = 999; // broken');
    const result = store.rollbackPackage('alpha');
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, 'routes.js'), 'utf-8')).toBe('exports.v = 1;');
  });

  it.skipIf(!hasGit)('reports failure when rolling back a package with no checkpoint', () => {
    const store = new CheckpointStore(ws.root);
    expect(store.rollbackPackage('never-committed')).toEqual({ ok: false });
  });

  it('lastStable is null before any commit', () => {
    const store = new CheckpointStore(ws.root);
    expect(store.lastStable('alpha')).toBeNull();
    expect(store.lastStable(null)).toBeNull();
  });
});

describe('CheckpointStore database snapshots (git-independent)', () => {
  it('snapshots and restores a package .database directory', () => {
    const dir = ws.pkg('data', { '.database/state.json': '{"count":1}' });
    const store = new CheckpointStore(ws.root);

    const snap = store.snapshotDatabase('data');
    expect(snap).toBeTruthy();

    fs.writeFileSync(path.join(dir, '.database', 'state.json'), '{"count":999}');
    const result = store.restoreDatabase('data');
    expect(result.ok).toBe(true);
    expect(fs.readFileSync(path.join(dir, '.database', 'state.json'), 'utf-8')).toBe('{"count":1}');
  });

  it('returns null snapshotting a package that has no .database dir', () => {
    ws.pkg('nodb', { 'index.js': '' });
    const store = new CheckpointStore(ws.root);
    expect(store.snapshotDatabase('nodb')).toBeNull();
  });

  it('reports failure restoring a database that was never snapshotted', () => {
    ws.pkg('nodb', { '.database/x.json': '{}' });
    const store = new CheckpointStore(ws.root);
    expect(store.restoreDatabase('nodb')).toEqual({ ok: false });
  });
});
