import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const logosRoot = path.dirname(require.resolve('logos/package.json'));
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packagesRoot = path.dirname(packageRoot);

describe('SSR do Terminal', () => {
  test('renderiza a saída acessível sem globais do browser', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'thinkiac-terminal-ssr-'));
    try {
      const engineModule = await import(engineUrl);
      const { SvelteEngine } = engineModule.default ?? engineModule;
      const html = await new SvelteEngine(cacheDir).render(
        path.join(packageRoot, 'views/Index.svelte'),
        'terminal__Index_ssr',
        {},
        packagesRoot,
      );
      expect(html).toContain('role="log"');
      expect(html).toContain('Session is not ready yet');
    } finally {
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 20_000);
});
