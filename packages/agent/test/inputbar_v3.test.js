import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inputBarPath = new URL("../views/InputBar2.svelte", import.meta.url);
const registryPath = new URL("../views/lib/inputbar_bootstrap.js", import.meta.url);
const governanceManifestPath = new URL("../../governance/package.json", import.meta.url);
const governanceViewPath = new URL("../../governance/views/Approval.svelte", import.meta.url);

test("InputBar v3 exposes three highlights and visibility tabs", async () => {
  const [inputBar, registry] = await Promise.all([
    readFile(inputBarPath, "utf8"),
    readFile(registryPath, "utf8"),
  ]);

  assert.match(registry, /export const DEFAULT_MAX_PINNED = 3;/);
  assert.match(inputBar, /let pinsTab = "active";/);
  assert.match(inputBar, /Active \(\{activeActions\.length\}\)/);
  assert.match(inputBar, /Inactive \(\{inactiveActions\.length\}\)/);
  assert.doesNotMatch(inputBar, /on bar/);
});

test("normaliza uma contribuição de InputBar sem depender do pacote de origem", async () => {
  const [{ normalizePackageInputBarEntry }, inputBar] = await Promise.all([
    import("../views/lib/inputbar_bootstrap.js"),
    readFile(inputBarPath, "utf8"),
  ]);
  const entry = normalizePackageInputBarEntry({
    packageName: "projects",
    name: "Projects",
    url: "/view/projects/ProjectSelector",
    inputbar: {
      id: "projects", kind: "state", label: "Project",
      hint: "Project context for this session", view: "ProjectSelector",
    },
  });

  assert.deepEqual(entry, {
    id: "pkg:projects", kind: "state", label: "Project",
    icon: null, iconSvg: null, iconDark: null, iconDarkSvg: null,
    hint: "Project context for this session",
    url: "/view/projects/ProjectSelector",
    event: null, command: null, defaultHidden: false, kindSource: "package",
  });
  assert.doesNotMatch(inputBar, /ProjectSelector|projectsAvailable|fetchProject|selectProject|project-row/);
});

test("Governance owns the approval state view", async () => {
  const [inputBar, registry, manifestText, governanceView] = await Promise.all([
    readFile(inputBarPath, "utf8"),
    readFile(registryPath, "utf8"),
    readFile(governanceManifestPath, "utf8"),
    readFile(governanceViewPath, "utf8"),
  ]);
  const manifest = JSON.parse(manifestText);

  assert.deepEqual(manifest.manifest.inputbar, {
    id: "approval", kind: "state", label: "Approval",
    hint: "How actions get approved", view: "Approval",
  });
  assert.match(governanceView, /sessionId = typeof payload\.source === "string"/);
  assert.match(governanceView, /`\/governance\/policy\?sessionId=\$\{encodeURIComponent\(sessionId\)\}`/);
  assert.match(governanceView, /mode: selectedMode/);
  assert.match(governanceView, /type: "widget:height"/);
  assert.doesNotMatch(registry, /native:approval/);
  assert.doesNotMatch(inputBar, /governance\/policy|approvalModes|approvalPrompt/);
});
