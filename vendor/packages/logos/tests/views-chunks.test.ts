import fs from 'fs';
import path from 'path';
import os from 'os';
import { it, expect } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';

it('emits real lazy chunks and retains them after rebuilding for already-open clients', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-chunks-'));
  try {
    const views = path.join(dir, 'pkg/views'); fs.mkdirSync(views, { recursive: true });
    const source = path.join(views, 'Home.svelte');
    fs.writeFileSync(path.join(views, 'heavy.js'), 'export const text = "lazy-only-payload-marker";');
    fs.writeFileSync(source, '<script>async function load() { return import("./heavy.js"); }</script><button on:click={load}>Load</button>');
    const engine = new SvelteEngine(path.join(dir, 'cache'));
    await engine.prewarm(source, 'pkg__Home', dir);
    const files = fs.readdirSync(engine.cacheDir);
    const entry = files.find(f => f.includes('.DOM.'))!;
    const chunks = files.filter(f => f.includes('.chunk.'));
    expect(chunks.length).toBeGreaterThan(0);
    expect(fs.readFileSync(path.join(engine.cacheDir, entry), 'utf8')).not.toContain('lazy-only-payload-marker');
    expect(chunks.some(f => fs.readFileSync(path.join(engine.cacheDir, f), 'utf8').includes('lazy-only-payload-marker'))).toBe(true);
    fs.appendFileSync(source, '<p>new version</p>');
    await engine.prewarm(source, 'pkg__Home', dir);
    for (const file of chunks) expect(fs.existsSync(path.join(engine.cacheDir, file))).toBe(true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
