import assert from "node:assert/strict"
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"

import { clearCompiledViewCache } from "../cache.js"

function fixture() {
  const dir = mkdtempSync(join(tmpdir(), "thinkiac-view-cache-"))
  for (const name of [
    "andar__Index.hash.mjs",
    "andar__Index.hash.manifest.json",
    "agent__Home.hash.cjs",
    "tailwind.hash.css",
    "WidgetRegistry.svelte",
  ]) writeFileSync(join(dir, name), name)
  mkdirSync(join(dir, "nested"))
  return dir
}

test("clears only compiled artifacts for one package", () => {
  const dir = fixture()
  try {
    const result = clearCompiledViewCache(dir, "andar")
    assert.equal(result.success, true)
    assert.equal(result.removed, 2)
    assert.deepEqual(readdirSync(dir).sort(), [
      "WidgetRegistry.svelte",
      "agent__Home.hash.cjs",
      "nested",
      "tailwind.hash.css",
    ])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("global cleanup preserves source helpers and directories", () => {
  const dir = fixture()
  try {
    const result = clearCompiledViewCache(dir)
    assert.equal(result.success, true)
    assert.equal(result.removed, 4)
    assert.deepEqual(readdirSync(dir).sort(), ["WidgetRegistry.svelte", "nested"])
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test("rejects package names that could escape or broaden the cache scope", () => {
  const dir = fixture()
  try {
    for (const name of ["../andar", "andar/other", "", "*"]) {
      const result = clearCompiledViewCache(dir, name)
      assert.equal(result.success, false)
      assert.equal(result.removed, 0)
    }
    assert.equal(readdirSync(dir).length, 6)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
