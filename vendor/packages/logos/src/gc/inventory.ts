import fs from 'node:fs/promises';
import path from 'node:path';
import { classify, DEFAULT_TMP_GRACE_MS } from './policies';
import type { GcEntry, GcInventory } from './types';
export interface InventoryOptions { now?: number; tmpGraceMs?: number; maxEntries?: number }
export async function inventory(logosRoot: string, options: InventoryOptions = {}): Promise<GcInventory> {
  const now = options.now ?? Date.now(); const maxEntries = options.maxEntries ?? 250_000;
  const root = path.resolve(logosRoot); await fs.mkdir(root, { recursive: true, mode: 0o700 }); const realRoot = await fs.realpath(root);
  const entries: GcEntry[] = []; const errors: GcInventory['errors'] = []; let truncated = false;
  async function walk(dir: string): Promise<void> {
    if (entries.length >= maxEntries) { truncated = true; return; }
    let children; try { children = await fs.readdir(dir, { withFileTypes: true }); } catch (error: any) { errors.push({ path: dir, error: error.message }); return; }
    for (const child of children) {
      if (entries.length >= maxEntries) { truncated = true; return; }
      const absolute = path.join(dir, child.name); let stat;
      try { stat = await fs.lstat(absolute); } catch (error: any) { errors.push({ path: absolute, error: error.message }); continue; }
      const relativePath = path.relative(realRoot, absolute);
      if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) { errors.push({ path: absolute, error: 'entry escaped GC root' }); continue; }
      const decision = classify(relativePath, stat, now, options.tmpGraceMs ?? DEFAULT_TMP_GRACE_MS);
      entries.push({ path: absolute, relativePath, kind: stat.isSymbolicLink() ? 'symlink' : stat.isDirectory() ? 'directory' : stat.isFile() ? 'file' : 'other', ...decision, size: stat.size, blocks: stat.blocks ?? 0, mtimeMs: stat.mtimeMs, identity: { dev: stat.dev, ino: stat.ino, size: stat.size, mtimeMs: stat.mtimeMs } });
      if (stat.isDirectory() && !stat.isSymbolicLink()) await walk(absolute);
    }
  }
  await walk(realRoot); const files = entries.filter(entry => entry.kind !== 'directory'); const eligible = files.filter(entry => entry.eligible);
  return { root: realRoot, scannedAt: new Date(now).toISOString(), entries, errors, truncated, totals: {
    entries: entries.length, bytes: files.reduce((s, e) => s + e.size, 0), diskBytes: files.reduce((s, e) => s + e.blocks * 512, 0),
    eligibleEntries: eligible.length, eligibleBytes: eligible.reduce((s, e) => s + e.size, 0),
    protectedBytes: files.filter(e => e.classification === 'protected').reduce((s, e) => s + e.size, 0),
    unknownBytes: files.filter(e => e.classification === 'unknown').reduce((s, e) => s + e.size, 0),
  } };
}
