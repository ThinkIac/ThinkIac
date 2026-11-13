import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [sidebar, home] = await Promise.all([
    readFile(new URL("../views/Sidebar.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Home.svelte", import.meta.url), "utf8"),
]);



assert.match(sidebar, /export let rightCollapsed = true/);
assert.match(sidebar, /context="left"/);
assert.match(sidebar, /context="right"/);
assert.match(sidebar, /class="sidebar-reopen sidebar-reopen-right"/);
assert.match(sidebar, /on:click=\{collapseRightSidebar\}/);
assert.match(sidebar, /bind:this=\{rightDesktopScrollEl\}/);
assert.match(sidebar, /in:fly=\{\{ x: 244,[\s\S]*?class="desktop-sidebar-right relative/);
assert.match(sidebar, /\.desktop-sidebar-right \{ order: 2; \}/);
assert.match(home, /let rightSidebarCollapsed = true/);
assert.match(home, /bind:rightCollapsed=\{rightSidebarCollapsed\}/);
assert.match(home, /rightSidebarOpen=\{!rightSidebarCollapsed\}/);
assert.match(home, /rightSidebarWidth=\{244\}/);
assert.match(sidebar, /w-\[244px\] min-w-\[244px\]/);

const tabs = await readFile(new URL("../views/SessionTabs.svelte", import.meta.url), "utf8");
assert.match(tabs, /export let rightSidebarOpen = false/);
assert.match(tabs, /export let rightSidebarWidth = 0/);
assert.match(tabs, /class:right-sidebar-open=\{rightSidebarOpen\}/);
assert.match(tabs, /\.tab-bar\.right-sidebar-open \{ width: calc\(100% - var\(--right-sidebar-width\)\); \}/);

console.log("desktop split sidebar: ok");
