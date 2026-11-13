import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { resolveIconPreset } = require('../../runtime/system/apps/icon_presets');

test('resolve os presets Lucide declarados pelo manifesto', () => {
  assert.match(resolveIconPreset({ pack: 'lucide', name: 'Package' }), /viewBox="0 0 24 24"/);
  assert.match(resolveIconPreset({ provider: 'lucide', icon: 'Code' }), /stroke="currentColor"/);
  assert.match(resolveIconPreset({ pack: 'lucide', name: 'Terminal' }), /m4 17 6-6-6-6/);
  assert.match(resolveIconPreset({ pack: 'lucide', name: 'ToyBrick' }), /<rect/);
  assert.match(resolveIconPreset({ pack: 'lucide', name: 'Settings' }), /<circle/);
  assert.match(resolveIconPreset({ pack: 'lucide', name: 'Folder' }), /<path/);
});

test('presets desconhecidos não geram SVG arbitrário', () => {
  assert.equal(resolveIconPreset({ pack: 'outro', name: 'Package' }), null);
  assert.equal(resolveIconPreset({ pack: 'lucide', name: '<script>' }), null);
});
