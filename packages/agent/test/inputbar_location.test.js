import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inputBarPath = new URL("../views/InputBar2.svelte", import.meta.url);
const homePath = new URL("../views/Home.svelte", import.meta.url);

test("InputBar2 exposes an explicit one-time location consent card", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /native === "location"/);
  assert.match(source, /Allow once/);
  assert.match(source, /Use approximate location/);
  assert.match(source, /Not now/);
  assert.match(source, /consent:\s*"one_time"/);
});

test("InputBar2 subtly marks a location queued for the next message", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /class:location-shared=\{entry\.native === "location" && !!oneTimeLocation\}/);
  assert.match(source, /class="location-ready-dot"/);
  assert.match(source, /Location ready for the next message/);
  assert.match(source, /oneTimeLocation = null/);
});

test("InputBar2 centers the location consent dialog independently from the action bar", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /class="location-layer" use:portalToBody/);
  assert.match(source, /class="location-backdrop"/);
  assert.match(source, /aria-modal="true"/);
  assert.match(source, /\.location-layer \{ position:fixed; inset:0;[^}]*place-items:center/);
});

test("InputBar2 supports Flutter and web geolocation without persisting coordinates", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(source, /FlutterBridge\?\.postMessage\(JSON\.stringify\(\{[\s\S]*type:\s*"request-location"/);
  assert.match(source, /navigator\.geolocation\.getCurrentPosition/);
  assert.match(source, /window\.ThinkIacLocationResult/);
  assert.doesNotMatch(source, /localStorage\.setItem\([^)]*location/i);
});

test("Home sends temporal and one-time location metadata to chat", async () => {
  const source = await readFile(homePath, "utf8");

  assert.match(source, /metadata:\s*detail\?\.metadata/);
});
