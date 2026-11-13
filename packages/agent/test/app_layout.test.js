import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_APP_LAYOUT, LAYOUTS, normalizeAppLayout } from '../views/lib/app_layout.js';

test('o launcher inicia em grid e preserva preferências válidas', () => {
  assert.deepEqual(DEFAULT_APP_LAYOUT, { layout: 'grid', sort: 'manual' });
  assert.deepEqual(normalizeAppLayout(null), DEFAULT_APP_LAYOUT);
  assert.deepEqual(normalizeAppLayout({ layout: 'compact', sort: 'auto' }), { layout: 'compact', sort: 'auto' });
});

test('a sequência de modos é grid, compact e list', () => {
  assert.deepEqual(LAYOUTS, ['grid', 'compact', 'list']);
  assert.deepEqual(normalizeAppLayout({ layout: 'invalid', sort: 'invalid' }), DEFAULT_APP_LAYOUT);
});
