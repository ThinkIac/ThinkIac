import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
    new URL("../views/components/PackageWidget.svelte", import.meta.url),
    "utf8",
);

test("inline package widgets have breathing room without affecting flat widgets", () => {
    assert.match(source, /\.pkg-widget:not\(\.flat\)\s*\{[^}]*margin:\s*4px 0;/s);
    assert.doesNotMatch(source, /\.pkg-widget\.flat\s*\{[^}]*margin:\s*4px 0;/s);
});
