import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { chdir, cwd } from "node:process";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const manifestPath = new URL("../package.json", import.meta.url);
const viewPath = new URL("../views/Approval.svelte", import.meta.url);
const enginePath = new URL("../lib/engine.js", import.meta.url);
const require = createRequire(import.meta.url);
const logosRoot = path.dirname(require.resolve("logos/package.json"));
const svelteEngineUrl = pathToFileURL(path.join(logosRoot, "dist/src/modules/views/engine.js")).href;
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const workspaceRoot = path.resolve(packageRoot, "../..");

test("approval policy is contributed as a session-scoped InputBar state", async () => {
  const [manifestText, view, engine] = await Promise.all([
    readFile(manifestPath, "utf8"),
    readFile(viewPath, "utf8"),
    readFile(enginePath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.equal(manifest.manifest.inputbar.kind, "state");
  assert.equal(manifest.manifest.inputbar.view, "Approval");
  assert.deepEqual(manifest.manifest.systemTab, {
    id: "governance",
    label: "Governance",
    view: "Approval",
    renderer: "schema",
    surface: "governance-defaults",
    order: 80,
  });
  assert.match(view, /think:theme/);
  assert.match(view, /addEventListener\("storage"/);
  assert.match(view, /removeEventListener\("storage"/);
  assert.match(view, /Auto/);
  assert.match(view, /Semi/);
  assert.match(view, /Manual/);
  assert.match(view, /Read only/);
  assert.match(view, /Workspace edits/);
  assert.match(view, /Custom/);
  assert.match(view, /Confirmations/);
  assert.match(view, /confirmations\/settings/);
  assert.match(view, /Save confirmations/);
  assert.match(engine, /submitEvent:\s*'logos:governance:resolve'/);
  assert.match(engine, /responseEvent:\s*'structured-input:resolved'/);
});

test("approval policy view renders without browser globals", async () => {
  const cacheDir = await mkdtemp(path.join(tmpdir(), "governance-ssr-"));
  const originalCwd = cwd();
  try {
    chdir(workspaceRoot);
    const engineModule = await import(svelteEngineUrl);
    const { SvelteEngine } = engineModule.default ?? engineModule;
    const html = await new SvelteEngine(cacheDir).render(
      path.join(packageRoot, "views/Approval.svelte"),
      "cognitive_governance__Approval_ssr",
      {},
      path.dirname(packageRoot),
    );
    assert.match(html, /Loading policy/);
  } finally {
    chdir(originalCwd);
    await rm(cacheDir, { recursive: true, force: true });
  }
});
