import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const [source, favoritesSource] = await Promise.all([
  readFile(new URL("./Apps.svelte", import.meta.url), "utf8"),
  readFile(new URL("./lib/favorite_apps.js", import.meta.url), "utf8"),
]);

assert.match(source, /sortAppsWithFavorites\(apps, favoriteIds\)/);
assert.match(source, /let layout = 'list';/);
assert.match(source, /\{ id: 'grid', label: 'Grid' \}/);
assert.match(source, /\{ id: 'compact', label: 'Compact' \}/);
assert.match(source, /\{ id: 'list', label: 'List' \}/);
assert.match(source, /perPage = layout === 'grid' \? 9 : 8/);
assert.match(source, /<AppCell[\s\S]*?\{app\}[\s\S]*?isLauncher=\{true\}[\s\S]*?\{theme\}[\s\S]*?\{layout\}/);
assert.match(source, /showFavorite/);
assert.match(source, /on:favorite=\{\(\) => toggleFavorite\(app\)\}/);
assert.match(favoritesSource, /const FAVORITE_APPS_KEY = 'shell:favorite-packages:v1';/);
assert.match(source, /const APPS_CACHE_KEY = 'shell:apps-cache:v1';/);
assert.match(source, /restoreAppsCache\(\);/);
assert.match(source, /saveAppsCache\(nextApps\);/);
assert.match(source, /function isMenuPreviewApp\(app\)/);
assert.match(source, /toLowerCase\(\) !== 'shell'/);
assert.match(source, /cached\.filter\(isMenuPreviewApp\)/);
assert.match(source, /\.filter\(isMenuPreviewApp\)/);
assert.doesNotMatch(source, /Auto|Manual|New folder|Edit apps|app_folders|app_layout|pinned_apps/);

console.log("menu apps widget: local favorites first with list, grid, and compact: ok");
