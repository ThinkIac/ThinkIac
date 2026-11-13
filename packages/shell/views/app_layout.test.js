import { describe, expect, test } from 'vitest';
import { DEFAULT_APP_LAYOUT, LAYOUTS, normalizeAppLayout } from './lib/app_layout.js';

describe('layout do launcher', () => {
  test('inicia em grid e preserva preferências válidas', () => {
    expect(DEFAULT_APP_LAYOUT).toEqual({ layout: 'grid', sort: 'manual' });
    expect(normalizeAppLayout(null)).toEqual(DEFAULT_APP_LAYOUT);
    expect(normalizeAppLayout({ layout: 'compact', sort: 'auto' })).toEqual({ layout: 'compact', sort: 'auto' });
  });

  test('segue grid, compact e list', () => {
    expect(LAYOUTS).toEqual(['grid', 'compact', 'list']);
    expect(normalizeAppLayout({ layout: 'invalid', sort: 'invalid' })).toEqual(DEFAULT_APP_LAYOUT);
  });
});
