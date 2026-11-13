import fs from 'fs';
import path from 'path';
import os from 'os';
import { it, expect } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';

it('publishes a valid nonempty module for an empty dynamic import', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'view-empty-chunk-'));
  try {
    const views = path.join(dir, 'pkg/views');
    fs.mkdirSync(views, { recursive: true });
    const source = path.join(views, 'Home.svelte');
    fs.writeFileSync(path.join(views, 'empty.js'), '');
    fs.writeFileSync(source, '<script>async function load() { return import("./empty.js"); }</script><button on:click={load}>Load</button>');
    const engine = new SvelteEngine(path.join(dir, 'cache'));
    await engine.prewarm(source, 'pkg__Home', dir);
    const chunk = fs.readdirSync(engine.cacheDir).find(file => file.includes('.chunk.') && file.endsWith('.mjs'));
    expect(chunk).toBeDefined();
    expect(fs.readFileSync(path.join(engine.cacheDir, chunk!), 'utf8')).toContain('export {};');
    expect(JSON.parse(fs.readFileSync(path.join(engine.cacheDir, 'pkg__Home.manifest.json'), 'utf8')).format).toBe(3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
