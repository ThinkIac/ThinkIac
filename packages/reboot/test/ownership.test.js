import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import { registerTools } from "logos";

const root = new URL("../../", import.meta.url);

test("reboot contributes only a compact runtime widget", async () => {
  const [rebootManifest, widget, legacyIndex] = await Promise.all([
    readFile(new URL("reboot/package.json", root), "utf8").then(JSON.parse),
    readFile(new URL("reboot/views/Widget.svelte", root), "utf8"),
    access(new URL("reboot/views/Index.svelte", root)).then(() => true, () => false),
  ]);
  assert.deepEqual(rebootManifest.manifest.menu, {
    id: "runtime",
    label: "Runtime",
    target: "left",
    view: "Widget",
    order: 85,
    hidden: false,
  });
  assert.match(widget, /\/reboot\/reboot/);
  assert.match(widget, /\/reboot\/clear-cache/);
  assert.match(widget, /confirm: true/);
  assert.match(widget, /open:app/);
  assert.match(widget, /detail: "tasks"/);
  assert.match(widget, /hasTasksPackage/);
  assert.match(widget, /fetch\("\/apps\/list"\)/);
  assert.match(widget, /Clear cache/);
  assert.match(widget, />Restart</);
  assert.match(widget, /function requestAction\(action\)/);
  assert.match(widget, /phase = "confirming"/);
  assert.match(widget, /type: "shell:reload"/);
  assert.match(widget, /basePid == null \|\| next.pid !== basePid \|\| restartWentOffline/);
  assert.match(widget, /function reloadShell\(id\)/);
  assert.match(widget, /localStorage\.clear\(\)/);
  assert.match(widget, /reloadShell\("runtime-cache-reset"\)/);
  assert.match(widget, /reloadShell\("runtime-restart"\)/);
  assert.doesNotMatch(widget, /Package recovery/);
  assert.doesNotMatch(widget, /Maintenance/);
  assert.doesNotMatch(widget, /Waits 15s/);
  assert.match(widget, /shell:loading/);
  assert.match(widget, /source: "thinkiac-shell"/);
  assert.match(widget, /shell:context/);
  assert.match(widget, /emitShellLoading\(false\)/);
  assert.match(widget, /<main data-theme=\{theme\}>/);
  assert.match(widget, /--widget-frame-bg/);
  assert.match(widget, /:global\(html\), :global\(body\), :global\(#app\)/);
  assert.match(widget, /background: var\(--widget-frame-bg\)/);
  assert.equal(legacyIndex, false);
});

test("Agent always receives the unified runtime maintenance tool with a callable schema", async () => {
  const [alwaysInclude, rebootSource] = await Promise.all([
    readFile(new URL("classification/always-include-tools.json", root), "utf8").then(JSON.parse),
    readFile(new URL("reboot/index.js", root), "utf8"),
  ])
  const tools = await registerTools(new URL("reboot", root).pathname)
  const maintenance = tools.find(tool => tool.name === "runtimeMaintenance")

  assert.ok(alwaysInclude.core.includes("runtimeMaintenance"))
  assert.ok(maintenance)
  assert.deepEqual(Object.keys(maintenance.parameters.properties).sort(), [
    "confirm", "delay", "force", "package", "reason", "restart",
  ])
  assert.ok(rebootSource.includes(["@", "register_tool runtimeMaintenance"].join("")))
  assert.match(rebootSource, /@reach always/)
  assert.match(rebootSource, /@param \{string\?\} package/)
  assert.match(rebootSource, /input\?\.restart === true/)
  assert.match(rebootSource, /confirmationRequired/)
  assert.match(rebootSource, /MIN_RESTART_DELAY_MS = 15_000/)
})
