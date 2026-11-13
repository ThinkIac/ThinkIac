import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [sidebar, index] = await Promise.all([
    readFile(new URL("./Sidebar.svelte", import.meta.url), "utf8"),
    readFile(new URL("./Index.svelte", import.meta.url), "utf8"),
]);

assert.match(sidebar, /export let rightCollapsed = false/);
assert.match(sidebar, /context="left"/);
assert.match(sidebar, /context="right"/);
assert.match(sidebar, /data-menu-context="right"/);
assert.match(sidebar, /<span class="sigma-loose" aria-label="Sigma">Σ<\/span>/);
assert.doesNotMatch(sidebar, /<span class="sidebar-context-label">Sigma<\/span>/);
assert.match(sidebar, /context="right"[\s\S]{0,100}appsLauncher/);
assert.match(sidebar, /class="sidebar-toggle sidebar-toggle-right"/);
assert.match(sidebar, /class="sidebar-resize-handle sidebar-resize-handle-right"/);
assert.match(sidebar, /moveEvent\.altKey/);
assert.match(sidebar, /RIGHT_WIDTH_KEY/);
assert.match(sidebar, /RIGHT_COLLAPSED_KEY/);
assert.match(sidebar, /editMode=\{leftEditMode\}/);
assert.match(sidebar, /editMode=\{rightEditMode\}/);
assert.match(sidebar, /function toggleLeftEditMode\(\)/);
assert.match(sidebar, /function toggleRightEditMode\(\)/);
assert.match(sidebar, /on:click=\{rightCollapsed \? openRightSidebar : collapseRightSidebar\}/);
assert.match(sidebar, /function showRightHoverPreview\(\)/);
assert.match(sidebar, /on:mouseenter=\{showRightHoverPreview\}/);
assert.match(sidebar, /class:hover-preview=\{rightCollapsed && rightHoverPreview\}/);
assert.match(sidebar, /\.desktop-sidebar-right-slot \.sidebar-edge-trigger \{ left: auto; right: 0; \}/);
assert.match(sidebar, /context="right"[\s\S]{0,180}appsLauncher/);
assert.match(sidebar, /\.desktop-sidebar-right-slot \{ order: 2; \}/);
assert.ok(
    sidebar.indexOf(".desktop-sidebar.sidebar-hidden") < sidebar.indexOf(".desktop-sidebar-right.sidebar-hidden"),
    "the right sidebar hidden transform must override the generic left-side transform"
);
assert.match(index, /let rightSidebarCollapsed = false/);
assert.match(index, /bind:rightCollapsed=\{rightSidebarCollapsed\}/);

console.log("shell desktop split sidebar: ok");
