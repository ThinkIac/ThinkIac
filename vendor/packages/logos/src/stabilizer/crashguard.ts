// stabilizer/crashguard.ts — process-level crash-loop protection.
//
// Boot attempts since the last stable state are counted in
// ~/.environments/logos-boot.json. If the process died CRASH_LIMIT times
// within CRASH_WINDOW_MS without ever reaching stability, the next boot
// restores the whole workspace to the last global checkpoint BEFORE wiring.

'use strict';

import fs from 'fs';
import path from 'path';
import os from 'os';
import { CheckpointStore } from './checkpoint';

const CRASH_LIMIT = 3;
const CRASH_WINDOW_MS = 120_000;

function defaultStateDir(): string {
  return path.join(os.homedir(), '.environments');
}

function guardFile(stateDir: string): string {
  return path.join(stateDir, 'logos-boot.json');
}

function readGuard(stateDir: string): any {
  try { return JSON.parse(fs.readFileSync(guardFile(stateDir), 'utf-8')); } catch { return {}; }
}

function writeGuard(data: any, stateDir: string): void {
  fs.mkdirSync(stateDir, { recursive: true });
  fs.writeFileSync(guardFile(stateDir), JSON.stringify(data, null, 2));
}

/** Call at the very start of bootstrap(). May restore the workspace. */
export function bootAttempt(
  workspace: string,
  checkpoints: CheckpointStore,
  stateDir = defaultStateDir(),
): { restored: boolean } {
  const guard = readGuard(stateDir);
  const entry = guard[workspace] ?? { attempts: [], restoredAt: 0 };
  const now = Date.now();

  entry.attempts = (entry.attempts as number[]).filter(t => now - t < CRASH_WINDOW_MS);
  entry.attempts.push(now);
  guard[workspace] = entry;
  writeGuard(guard, stateDir);

  if (entry.attempts.length >= CRASH_LIMIT) {
    console.error(
      `[stabilizer] crash loop detected (${entry.attempts.length} boots in ${CRASH_WINDOW_MS / 1000}s) — ` +
      `restoring workspace to last stable checkpoint`
    );
    const result = checkpoints.rollbackWorkspace();
    entry.attempts = [];
    entry.restoredAt = now;
    guard[workspace] = entry;
    writeGuard(guard, stateDir);
    return { restored: result.ok };
  }
  return { restored: false };
}

/** Call once the runtime reaches a stable state — resets the counter. */
export function bootStable(workspace: string, stateDir = defaultStateDir()): void {
  const guard = readGuard(stateDir);
  guard[workspace] = { attempts: [], stableAt: Date.now() };
  writeGuard(guard, stateDir);
}
