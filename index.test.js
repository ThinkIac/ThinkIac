import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('serves main-site Index as the runtime homepage', () => {
  const source = readFileSync(new URL('./index.js', import.meta.url), 'utf8');

  assert.match(source, /index:\s*\{\s*package:\s*'main-site',\s*page:\s*'Index'\s*\}/);
  assert.doesNotMatch(source, /index:\s*'\/redirect\/home'/);
});
