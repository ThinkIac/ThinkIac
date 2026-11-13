import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const inputBarPath = new URL("../views/InputBar2.svelte", import.meta.url);

test("InputBar2 leaves Enter available for a new line on mobile", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(
    source,
    /function onKeydown\(e\) \{[\s\S]*window\.matchMedia\("\(max-width: 820px\)"\)\.matches\) return;[\s\S]*e\.preventDefault\(\);[\s\S]*onSend\(\);/,
  );
});

test("InputBar2 hides desktop keyboard guidance on mobile", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(
    source,
    /@media \(max-width: 820px\) \{\s*\.ib-caption \{\s*display: none;/,
  );
});

test("InputBar2 surfaces JSON and non-JSON transcription API errors", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(
    source,
    /const responseText = await res\.text\(\);[\s\S]*try \{[\s\S]*JSON\.parse\(responseText\)[\s\S]*if \(!res\.ok\) \{[\s\S]*json\?\.data\?\.error[\s\S]*json\?\.error[\s\S]*`Rota de transcrição indisponível \(HTTP \$\{res\.status\}\)`[\s\S]*throw new Error\(message\);/,
  );
});

test("InputBar2 uses Ubuntu for the recording timer", async () => {
  const source = await readFile(inputBarPath, "utf8");

  assert.match(
    source,
    /\.rec \{[\s\S]*font-family: var\(--tk-font, "Ubuntu", system-ui, sans-serif\);/,
  );
});
