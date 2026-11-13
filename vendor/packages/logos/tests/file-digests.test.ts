import fs from 'fs';
import os from 'os';
import path from 'path';
import { it, expect } from 'vitest';
import { FileDigests } from '../../modules/svelte';

it('detects same-length edits with restored mtime and file removal', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'digests-'));
  try {
    const file = path.join(dir, 'source'); fs.writeFileSync(file, 'before');
    const old = fs.statSync(file); const cache = new FileDigests();
    const first = await cache.hash(file);
    expect(await cache.hash(file)).toBe(first);
    fs.writeFileSync(file, 'edited'); fs.utimesSync(file, old.atime, old.mtime);
    expect(await cache.hash(file)).not.toBe(first);
    fs.unlinkSync(file); expect(await cache.hash(file)).toBe('gone');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
