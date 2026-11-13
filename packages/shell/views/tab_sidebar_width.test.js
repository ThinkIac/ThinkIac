import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const index = readFileSync(resolve(here, "Index.svelte"), "utf8");
const sidebar = readFileSync(resolve(here, "Sidebar.svelte"), "utf8");

assert.match(sidebar, /export let sidebarWidth = null/);
assert.match(sidebar, /export let rightSidebarWidth = null/);
assert.match(index, /bind:sidebarWidth=\{desktopSidebarWidth\}/);
assert.match(index, /bind:rightSidebarWidth=\{desktopRightSidebarWidth\}/);
assert.match(index, /--shell-right-rail:/);
assert.match(index, /!floatingShell && !isMobile && !rightSidebarCollapsed/);
assert.match(index, /width: calc\(100% - var\(--shell-left-rail, 0px\) - var\(--shell-right-rail, 0px\)\)/);

console.log("shell tab strip reserves the resizable right sidebar width");
