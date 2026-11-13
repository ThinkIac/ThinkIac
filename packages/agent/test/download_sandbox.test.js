import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('iframes que exibem apps permitem downloads iniciados pelo usuário', async () => {
  const [home, widget] = await Promise.all([
    read('../views/Home.svelte'),
    read('../views/components/PackageWidget.svelte'),
  ]);

  for (const view of [home, widget]) {
    assert.match(view, /sandbox="[^"]*allow-downloads/);
  }
});
