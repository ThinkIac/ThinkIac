import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const source = readFileSync(fileURLToPath(new URL('../index.js', import.meta.url)), 'utf8');

test('package listings consolidate renamed folders by manifest identity', () => {
  assert.match(source, /function packageIdentity/);
  assert.match(source, /function consolidatePackages/);
  assert.match(source, /duplicateFolders/);
  assert.match(source, /duplicates,/);
});
