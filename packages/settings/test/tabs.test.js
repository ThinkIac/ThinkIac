import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { listKeyTabs, listLegacySystemTabs, listSettingsTabs, normalizeSettingsTab } from '../lib/tabs.js';

const packagesRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..', '..');

function packageAt(root, name, manifest) {
  const folder = path.join(root, name);
  mkdirSync(folder);
  writeFileSync(path.join(folder, 'package.json'), JSON.stringify({ name, manifest }));
}

test('settings tabs accept the native protocol and legacy systemTab declarations', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'thinkiac-settings-'));
  try {
    packageAt(root, 'auth', { name: 'Access', settingsTab: { id: 'access', label: 'Access', view: 'Index', order: 10 } });
    packageAt(root, 'providers', { systemTab: { id: 'providers', label: 'Providers', view: 'Index', order: 70 } });
    packageAt(root, 'pexels', { keysTab: { id: 'keys:pexels', label: 'Pexels', view: 'Index', order: 10 } });
    assert.deepEqual(listSettingsTabs({ packagesDir: root }).map((tab) => tab.id), ['access', 'providers']);
    assert.deepEqual(listLegacySystemTabs({ packagesDir: root }).map((tab) => tab.id), ['providers']);
    assert.deepEqual(listKeyTabs({ packagesDir: root }).map((tab) => tab.id), ['keys:pexels']);
  } finally { rmSync(root, { recursive: true, force: true }); }
});

test('settings tabs reject unsafe view and schema declarations', () => {
  assert.equal(normalizeSettingsTab({ id: 'bad', view: '../secrets' }, 'test', 'Test'), null);
  assert.equal(normalizeSettingsTab({ id: 'bad', view: 'Index', renderer: 'schema' }, 'test', 'Test'), null);
});

test('Settings renders declarative tabs with the shared UI schema renderer', async () => {
  const view = await readFile(new URL('../views/Index.svelte', import.meta.url), 'utf8');
  assert.match(view, /import SystemSurface from ['"]\.\.\/\.\.\/ui-schema\/views\/SystemSurface\.svelte['"]/);
  assert.match(view, /fetch\(`\/\$\{tab\.packageName\}\/system\/view\?tab=\$\{encodeURIComponent\(tab\.id\)\}`\)/);
  assert.match(view, /current\.renderer === 'schema' && surface/);
  assert.match(view, /<SystemSurface \{surface\} state=\{surfaceState\} actionUrl=\{`\/\$\{current\.packageName\}\/system\/action\?tab=\$\{encodeURIComponent\(current\.id\)\}`\}/);
});

test('integrações formam uma seção independente com painéis expansíveis', async () => {
  const view = await readFile(new URL('../views/Index.svelte', import.meta.url), 'utf8');
  assert.match(view, /<h2 id="integration-keys-title">Integrações<\/h2>/);
  assert.match(view, /let openKeyTab = ''/);
  assert.match(view, /function toggleKeyTab\(id\)/);
  assert.match(view, /openKeyTab = openKeyTab === id \? '' : id/);
  assert.match(view, /aria-expanded=\{openKeyTab === tab\.id\}/);
  assert.match(view, /\{#if openKeyTab === tab\.id\}/);
  assert.match(view, /src=\{`\/view\/\$\{tab\.packageName\}\/\$\{tab\.view\}`\}/);
});

test('Auth is settings-only and each administrative tab targets the shared schema surface', async () => {
  const manifest = JSON.parse(await readFile(path.join(packagesRoot, 'auth', 'package.json'), 'utf8')).manifest;
  assert.equal(manifest.launch, false);
  assert.ok(manifest.settingsTab.every((tab) => tab.renderer === 'schema' && tab.surface === 'auth-administration'));
});

test('Specialists is settings-only and uses the declarative specialist surface', async () => {
  const manifest = JSON.parse(await readFile(path.join(packagesRoot, 'specialists', 'package.json'), 'utf8')).manifest;
  assert.equal(manifest.launch, false);
  assert.deepEqual(manifest.settingsTab, {
    id: 'specialists', label: 'Especialistas', view: 'Index', renderer: 'schema', surface: 'specialists-catalog', order: 60,
  });
});
