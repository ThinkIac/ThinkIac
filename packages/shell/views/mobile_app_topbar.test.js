import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./Index.svelte", import.meta.url), "utf8");
const appTopbar = source.match(/\{#if activeIsApp\}([\s\S]*?)\{:else\}/)?.[1] ?? "";

assert.match(source, /\{#if activeIsApp\}/);
assert.match(appTopbar, /aria-label="Docks e sessões"/);
assert.match(appTopbar, /aria-label="Back to chat"/);
assert.match(appTopbar, /\{activeTabName\}/);
assert.match(appTopbar, /aria-label="App options"/);
assert.match(appTopbar, /role="menuitem" on:click=\{refreshMobileApp\}/);
assert.match(appTopbar, /role="menuitem" on:click=\{refreshMobileApp\}[\s\S]*aria-label="Apps"/);
assert.match(source, /function refreshMobileApp\(\)[\s\S]*reloadApp\(activeTab, false\)/);

console.log("mobile app topbar: package title, back and refresh menu: ok");
