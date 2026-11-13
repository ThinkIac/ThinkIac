import { mkdtempSync, readFileSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { afterEach, describe, expect, it } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';

const temporary: string[] = [];

afterEach(() => {
  for (const dir of temporary.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('mdsvex compatibility', () => {
  it('does not load mdsvex while preprocessing a plain Svelte view', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'logos-mdsvex-'));
    temporary.push(dir);
    const engine = new SvelteEngine(dir) as any;
    const preprocess = engine.mdsvexPreprocess();

    await expect(preprocess.markup({ content: '<h1>Olá</h1>', filename: 'Home.svelte' }))
      .resolves.toBeUndefined();
  });

  it('never compiles mdsvex back to a CommonJS require', () => {
    const source = readFileSync(join(__dirname, '../../modules/svelte/lib/engine.cjs'), 'utf8');
    expect(source).not.toMatch(/require\(['"]mdsvex['"]\)/);
  });

  it('keeps the native dynamic loader in the CommonJS source', () => {
    const source = readFileSync(join(__dirname, '../../modules/svelte/lib/engine.cjs'), 'utf8');
    expect(source).toContain("new Function('specifier', 'return import(specifier)')");
  });
});
