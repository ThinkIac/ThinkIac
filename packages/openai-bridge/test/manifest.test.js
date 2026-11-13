import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manifest = JSON.parse(await readFile(
    new URL("../package.json", import.meta.url),
    "utf8",
)).manifest;

test("o widget e o menu são apresentados como Codex", () => {
    assert.equal(manifest.name, "Codex");
    assert.equal(manifest.widget.title, "Codex");
    assert.equal(manifest.menu.label, "Codex");
});
