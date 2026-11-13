import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');
const readme = readFileSync(fileURLToPath(new URL('../README.md', import.meta.url)), 'utf8');

test('protects the current Runtime core packages', () => {
  for (const name of ['shell', 'auth', 'agent', 'pkgmgr', 'ui-dialogs']) {
    assert.match(source, new RegExp(`['"]${name}['"]`), name);
  }
  assert.doesNotMatch(source, /new Set\(\['aurora', 'auth', 'pkgmgr'\]\)/);
  assert.match(readme, /bootstrap closure/);
});

test('documents the current theme integration contract', () => {
  assert.match(readme, /localStorage\['think:theme'\]/);
  assert.match(readme, /`think:theme-changed`/);
  assert.match(readme, /Do not use the retired `aurora:theme` key/);
});
