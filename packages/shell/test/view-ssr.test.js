import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, test } from 'vitest';

const require = createRequire(import.meta.url);
const logosRoot = path.dirname(require.resolve('logos/package.json'));
const engineUrl = pathToFileURL(path.join(logosRoot, 'dist/src/modules/views/engine.js')).href;
const packageRoot = fileURLToPath(new URL('..', import.meta.url));
const packagesRoot = path.dirname(packageRoot);
const workspaceRoot = path.dirname(packagesRoot);

describe('SSR do ThinkIac Shell', () => {
  test('renderiza sem globais de browser, inclusive WebSocket', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'thinkiac-main-shell-'));
    const originalCwd = process.cwd();
    const webSocketDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'WebSocket');
    try {
      Object.defineProperty(globalThis, 'WebSocket', {
        configurable: true,
        writable: true,
        value: undefined,
      });
      process.chdir(workspaceRoot);
      const engineModule = await import(engineUrl);
      const { SvelteEngine } = engineModule.default ?? engineModule;
      const engine = new SvelteEngine(cacheDir);
      const html = await engine.render(
        path.join(packageRoot, 'views/Index.svelte'),
        'shell__Index_ssr',
        {},
        packagesRoot,
      );
      expect(html).toContain('<title>ThinkIac</title>');
      expect(html).toContain('ThinkIac');
    } finally {
      if (webSocketDescriptor) Object.defineProperty(globalThis, 'WebSocket', webSocketDescriptor);
      else delete globalThis.WebSocket;
      process.chdir(originalCwd);
      rmSync(cacheDir, { recursive: true, force: true });
    }
  }, 60_000);
});
