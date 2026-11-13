// tests/crashguard.test.ts — process-level crash-loop protection.
//
// Every test injects an isolated state directory. The CheckpointStore is faked
// because these tests only assert crashguard's counting/threshold logic.

import fs from 'fs';
import os from 'os';
import path from 'path';
import { describe, it, expect, afterEach } from 'vitest';
import { bootAttempt, bootStable } from '../src/stabilizer/crashguard';

const created: string[] = [];
afterEach(() => {
  for (const dir of created) fs.rmSync(dir, { recursive: true, force: true });
  created.length = 0;
});

function freshGuard() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-guard-'));
  created.push(home);
  return path.join(home, '.environments');
}

function fakeCheckpoints(ok = true) {
  const calls = { rollbackWorkspace: 0 };
  return {
    store: { rollbackWorkspace: () => { calls.rollbackWorkspace++; return { ok }; } } as any,
    calls,
  };
}

describe('bootAttempt', () => {
  it('does not restore below the crash limit', () => {
    const stateDir = freshGuard();
    const cp = fakeCheckpoints();
    expect(bootAttempt('/ws', cp.store, stateDir).restored).toBe(false);
    expect(bootAttempt('/ws', cp.store, stateDir).restored).toBe(false);
    expect(cp.calls.rollbackWorkspace).toBe(0);
  });

  it('restores once the crash limit is reached within the window', () => {
    const stateDir = freshGuard();
    const cp = fakeCheckpoints(true);
    bootAttempt('/ws', cp.store, stateDir);
    bootAttempt('/ws', cp.store, stateDir);
    const third = bootAttempt('/ws', cp.store, stateDir); // 3rd boot in-window → restore
    expect(third.restored).toBe(true);
    expect(cp.calls.rollbackWorkspace).toBe(1);
  });

  it('resets the counter after a restore (no repeated rollback next boot)', () => {
    const stateDir = freshGuard();
    const cp = fakeCheckpoints(true);
    bootAttempt('/ws', cp.store, stateDir);
    bootAttempt('/ws', cp.store, stateDir);
    bootAttempt('/ws', cp.store, stateDir); // restores, resets attempts to []
    const next = bootAttempt('/ws', cp.store, stateDir); // fresh count = 1
    expect(next.restored).toBe(false);
    expect(cp.calls.rollbackWorkspace).toBe(1);
  });

  it('counts each workspace independently', () => {
    const stateDir = freshGuard();
    const cp = fakeCheckpoints(true);
    bootAttempt('/a', cp.store, stateDir);
    bootAttempt('/a', cp.store, stateDir);
    expect(bootAttempt('/b', cp.store, stateDir).restored).toBe(false); // /b has only 1 attempt
  });
});

describe('bootStable', () => {
  it('clears the attempt counter for a workspace', () => {
    const stateDir = freshGuard();
    const cp = fakeCheckpoints(true);
    bootAttempt('/ws', cp.store, stateDir);
    bootAttempt('/ws', cp.store, stateDir);
    bootStable('/ws', stateDir);             // reached stability → reset
    const next = bootAttempt('/ws', cp.store, stateDir);
    expect(next.restored).toBe(false);       // count restarted at 1
    expect(cp.calls.rollbackWorkspace).toBe(0);
  });
});
