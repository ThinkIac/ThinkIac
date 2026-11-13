import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inventory, runGc } from '../src/gc';
const roots: string[] = [];
async function fixture() { const root = await fs.mkdtemp(path.join(os.tmpdir(), 'logos-gc-')); roots.push(root); return root; }
afterEach(async () => { await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))); });
describe('logos gc', () => {
  it('classifies old temporaries but protects recent and unknown files', async () => {
    const root = await fixture(); await fs.writeFile(path.join(root, 'old.tmp'), 'old'); await fs.writeFile(path.join(root, 'recent.tmp'), 'recent'); await fs.writeFile(path.join(root, 'state.db'), 'critical');
    const old = new Date(Date.now() - 2 * 60 * 60 * 1000); await fs.utimes(path.join(root, 'old.tmp'), old, old); const result = await inventory(root);
    expect(result.totals.eligibleEntries).toBe(1); expect(result.entries.find(e => e.relativePath === 'state.db')?.classification).toBe('unknown');
  });
  it('is dry-run by default and idempotently removes only eligible files', async () => {
    const root = await fixture(); const target = path.join(root, 'orphan.tmp'); await fs.writeFile(target, 'orphan'); const old = new Date(Date.now() - 2 * 60 * 60 * 1000); await fs.utimes(target, old, old);
    const dryRun = await runGc(root); expect(dryRun.planned).toBe(1); expect(dryRun.removed).toBe(0); expect(await fs.readFile(target, 'utf8')).toBe('orphan'); expect((await runGc(root, { execute: true })).removed).toBe(1);
    await expect(fs.stat(target)).rejects.toMatchObject({ code: 'ENOENT' }); expect((await runGc(root, { execute: true })).removed).toBe(0);
  });
  it('never follows or removes symlinks', async () => {
    const root = await fixture(); const outside = await fixture(); const target = path.join(outside, 'outside.tmp'); await fs.writeFile(target, 'outside'); await fs.symlink(target, path.join(root, 'linked.tmp'));
    expect((await runGc(root, { execute: true, tmpGraceMs: 0 })).removed).toBe(0); expect(await fs.readFile(target, 'utf8')).toBe('outside');
  });
});
