import fs from 'fs';
import os from 'os';
import path from 'path';
import { performance } from 'perf_hooks';
import { it, expect } from 'vitest';
import { SvelteEngine } from '../../modules/svelte';
import { loadMiddlewareSnapshot, resolveMiddlewares } from '../src/kernel/middleware';
import { makeWorkspace } from './helpers';

it.skipIf(!process.env.THINKIAC_PROFILE)('profiles real Desktop/Shell assets and middleware discovery', async () => {
  const root = process.env.THINKIAC_PROFILE!;
  const cache = fs.mkdtempSync(path.join(os.tmpdir(), 'thinkiac-profile-assets-'));
  const engine = new SvelteEngine(cache);
  engine.buildWidgetRegistry(path.join(root, 'apps/thinkiac/packages'));
  const report: any = { environment: 'isolated local build; not production HTTP', bundles: {}, middleware: {} };
  for (const pkg of ['desktop', 'shell']) {
    const source = path.join(root, 'apps/thinkiac/packages', pkg, 'views/Index.svelte');
    const begin = performance.now();
    const built = await (engine as any).build(source, `${pkg}__Index`, 'profile', false, path.join(root, 'apps/thinkiac/packages'));
    const seen = new Set<string>();
    function visit(file: string) {
      if (seen.has(file)) return 0;
      seen.add(file);
      const text = fs.readFileSync(file, 'utf8');
      let bytes = Buffer.byteLength(text);
      const imports = /(?:import|export)\s*(?:[^;"']*?from\s*)?["'](\.\/[^"']+\.mjs)["']/g;
      for (const match of text.matchAll(imports)) bytes += visit(path.resolve(path.dirname(file), match[1]));
      return bytes;
    }
    report.bundles[pkg] = { buildMs: performance.now() - begin, entryBytes: fs.statSync(built.outPath).size, initialStaticBytes: visit(built.outPath), initialFiles: seen.size };
  }
  const ws = makeWorkspace();
  try {
    const files: Record<string, string> = {};
    for (let i = 0; i < 200; i++) files[`nested/file${i}.js`] = `exports.value = ${i};`;
    const dir = ws.pkg('sample', files);
    const snapshot = await loadMiddlewareSnapshot(dir);
    for (const [name, value] of [['discovery', undefined], ['snapshot', snapshot]] as const) {
      const times = [];
      for (let n = 0; n < 20; n++) {
        const start = performance.now(); await resolveMiddlewares(dir, {}, value); times.push(performance.now() - start);
      }
      times.sort((a, b) => a - b);
      report.middleware[name] = { p50Ms: times[9], p95Ms: times[18] };
    }
  } finally { ws.cleanup(); }
  fs.writeFileSync('/tmp/thinkiac-performance-results.json', JSON.stringify(report, null, 2));
  expect(report.bundles.shell.initialStaticBytes).toBeLessThan(11133009 * .4);
}, 240000);
