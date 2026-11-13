import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const logosRoot = path.dirname(require.resolve("logos/package.json"));
const engineUrl = pathToFileURL(path.join(logosRoot, "dist/src/modules/views/engine.js")).href;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagesRoot = path.dirname(packageRoot);
const workspaceRoot = path.dirname(packagesRoot);

test("renders the runtime widget during SSR without browser globals", async () => {
  const cacheDir = mkdtempSync(path.join(tmpdir(), "reboot-widget-ssr-"));
  const originalCwd = process.cwd();

  try {
    process.chdir(workspaceRoot);
    const engineModule = await import(engineUrl);
    const { SvelteEngine } = engineModule.default ?? engineModule;
    const engine = new SvelteEngine(cacheDir);
    const html = await engine.render(
      path.join(packageRoot, "views/Widget.svelte"),
      "reboot__Widget_ssr",
      {},
      packagesRoot,
    );

    assert.match(html, /Runtime/);
    assert.match(html, /Clear cache/);
    assert.match(html, /Restart/);
  } finally {
    process.chdir(originalCwd);
    rmSync(cacheDir, { recursive: true, force: true });
  }
});
