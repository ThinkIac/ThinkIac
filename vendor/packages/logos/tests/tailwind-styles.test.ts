import fs from 'fs';
import os from 'os';
import path from 'path';
import { it, expect } from 'vitest';
import { TailwindStyles } from '../../modules/svelte';

let available = true;
try { require.resolve('@tailwindcss/postcss'); } catch { available = false; }
it.skipIf(!available)('compiles initial CSS in a worker, shares concurrent builds and keys by theme', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-css-'));
  try {
    const source = path.join(dir, 'Home.svelte'); fs.writeFileSync(source, '<div class="flex p-4 text-primary">Ready</div>');
    const builder = new TailwindStyles(dir);
    const manifest = { hash: 'source-version', files: { [source]: 'hash' } };
    const theme = { 'color-primary': '#112233' };
    const [first, duplicate] = await Promise.all([builder.build(manifest, theme, dir), builder.build(manifest, theme, dir)]);
    expect(first).toBeTruthy(); expect(first).toBe(duplicate);
    const css = fs.readFileSync(path.join(dir, first!), 'utf8');
    expect(css).toContain('display:flex'); expect(css).toContain('.p-4'); expect(css).toContain('text-primary');
    const changed = await builder.build(manifest, { 'color-primary': '#445566' }, dir);
    expect(changed).not.toBe(first);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}, 60000);
