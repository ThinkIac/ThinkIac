import fs from 'node:fs/promises';
import path from 'node:path';
import { inventory, type InventoryOptions } from './inventory';
import type { GcEntry, GcRunResult } from './types';
export interface RunOptions extends InventoryOptions { execute?: boolean; maxBytes?: number; maxEntriesToRemove?: number }
function sameIdentity(entry: GcEntry, stat: Awaited<ReturnType<typeof fs.lstat>>): boolean {
  const e = entry.identity; return stat.dev === e.dev && stat.ino === e.ino && stat.size === e.size && stat.mtimeMs === e.mtimeMs;
}
export async function runGc(logosRoot: string, options: RunOptions = {}): Promise<GcRunResult> {
  const startedAt = new Date().toISOString(); const scan = await inventory(logosRoot, options);
  if (scan.truncated) throw new Error('GC inventory was truncated; refusing to execute a partial plan');
  const dryRun = !options.execute; const maxBytes = options.maxBytes ?? 512 * 1024 * 1024; const maxEntries = options.maxEntriesToRemove ?? 10_000;
  const result: GcRunResult = { dryRun, startedAt, completedAt: '', considered: 0, planned: 0, plannedBytes: 0, removed: 0, bytesFreed: 0, skipped: [], errors: [...scan.errors] };
  const lockPath = path.join(scan.root, '.gc.lock'); let lock;
  try {
    if (!dryRun) lock = await fs.open(lockPath, 'wx', 0o600);
    for (const entry of scan.entries.filter(item => item.eligible)) {
      result.considered++;
      if (result.planned >= maxEntries) { result.skipped.push({ path: entry.relativePath, reason: 'entry limit reached' }); continue; }
      if (result.plannedBytes + entry.size > maxBytes) { result.skipped.push({ path: entry.relativePath, reason: 'byte limit reached' }); continue; }
      result.planned++; result.plannedBytes += entry.size;
      if (dryRun) continue;
      try {
        const current = await fs.lstat(entry.path);
        if (!sameIdentity(entry, current) || current.isSymbolicLink() || !current.isFile()) { result.skipped.push({ path: entry.relativePath, reason: 'entry changed after inventory' }); continue; }
        await fs.unlink(entry.path); result.removed++; result.bytesFreed += entry.size;
      } catch (error: any) { result.errors.push({ path: entry.relativePath, error: error.message }); }
    }
  } finally {
    if (lock) { await lock.close().catch(() => undefined); await fs.unlink(lockPath).catch(() => undefined); }
  }
  result.completedAt = new Date().toISOString(); return result;
}
