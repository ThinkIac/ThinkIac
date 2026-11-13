import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inputBarPath = new URL("../views/InputBar2.svelte", import.meta.url);
const filePickerPath = new URL("../../file-manager/views/FilePicker.svelte", import.meta.url);

test("workspace picker is portaled and rendered as a centered modal", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /function portalToBody\(node\)[\s\S]*document\.body\.appendChild\(node\)/);
  assert.match(source, /<div class="workspace-layer" use:portalToBody[^>]*>/);
  assert.match(source, /\.workspace-layer \{[^}]*display:grid;[^}]*place-items:center;/s);
  assert.match(source, /\.workspace-modal \{[^}]*width:min\(calc\(100vw - 32px\),560px\);/s);
  assert.match(source, /\.workspace-modal \{[^}]*border-radius:var\(--r-lg\);/s);
  assert.doesNotMatch(source, /\.workspace-modal::before/);
});

test("workspace picker closes its parent drawer and starts at authorized roots", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /function openWorkspacePicker\(\)[\s\S]*stateOpen = false;[\s\S]*workspaceBrowser = null;[\s\S]*workspacePickerOpen = true;[\s\S]*browseWorkspace\(\)/);
});

test("workspace picker explains empty roots and empty folders", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /workspaceBrowser\.roots\.length/);
  assert.match(source, /No authorized folders are available/);
  assert.match(source, /workspaceBrowser\.entries\.length/);
  assert.match(source, /This folder has no subfolders/);
});

test("workspace picker always offers recovery and a textual exit", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /workspaceError[\s\S]*Try again/);
  assert.match(source, /No authorized folders are available[\s\S]*Try again/);
  assert.match(source, /class="workspace-footer"[\s\S]*Cancel/);
  assert.match(source, /on:click=\{closeWorkspacePicker\}/);
});

test("workspace picker closes itself and the development drawer", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /function closeWorkspacePicker\(\)\s*\{\s*workspacePickerOpen = false;\s*stateOpen = false;\s*\}/);
  assert.doesNotMatch(source, /function closeWorkspacePicker\(\)[\s\S]*stateOpen = true;/);
  assert.match(source, /function onWorkspacePickerKeydown\(event\)[\s\S]*event\.key !== "Escape"[\s\S]*closeWorkspacePicker\(\)/);
  assert.match(source, /class="workspace-layer"[^>]*on:keydown=\{onWorkspacePickerKeydown\}/);
  assert.match(source, /class="workspace-backdrop"[^>]*on:click=\{closeWorkspacePicker\}/);
  assert.match(source, /on:click=\{openWorkspacePicker\}>Choose folder/);
});

test("file picker is a bottom drawer on mobile and a centered dialog on desktop", async () => {
  const source = await readFile(filePickerPath, "utf8");

  assert.match(source, /<div class="fp" use:portal>/);
  assert.match(source, /\.fp-modal \{[\s\S]*left: 0; right: 0; bottom: 0;/);
  assert.match(source, /@media \(min-width: 640px\)[\s\S]*\.fp-modal \{[^}]*left: 50%;[^}]*top: 50%;/);
});

test("input bar ordering menus are portaled bottom drawers", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /class="inputbar-drawer-layer" use:portalToBody/);
  assert.match(source, /aria-label="Organize tools"/);
  assert.match(source, /aria-label="Development settings"/);
  assert.match(source, /\.inputbar-drawer \{[^}]*left:0;[^}]*right:0;[^}]*bottom:0;[^}]*width:100vw;/s);
  assert.match(source, /\.inputbar-drawer \{[^}]*border-radius:var\(--r-lg\) var\(--r-lg\) 0 0;/s);
  assert.match(source, /class="inputbar-drawer-backdrop"[^>]*on:click=/);
});

test("portaled drawers retain the computed theme aliases from InputBar", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /const inherited = getComputedStyle\(node\)/);
  assert.match(source, /"--sheet", "--raised"/);
  assert.match(source, /node\.style\.setProperty\(property, value\)/);
  assert.match(source, /document\.body\.appendChild\(node\)/);
});
