import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VALID_ID = /^[A-Za-z0-9:_-]+$/;
const VALID_VIEW = /^[A-Za-z][A-Za-z0-9_-]*$/;

// `systemTab` é o contrato legado. `settingsTab` é a declaração canônica
// para novas integrações. Os dois formatos compartilham os mesmos campos,
// para que um pacote possa migrar sem quebrar o System existente.
function entriesFor(manifest, key) {
  const value = manifest?.[key];
  return Array.isArray(value) ? value : [value];
}

export function normalizeSettingsTab(tab, packageName, fallbackLabel) {
  if (!tab || typeof tab !== 'object') return null;
  const view = String(tab.view || '').replace(/\.svelte$/i, '');
  const id = String(tab.id || `${packageName}:${view}`);
  if (!VALID_ID.test(id) || !VALID_VIEW.test(view)) return null;

  const renderer = tab.renderer === 'schema' || tab.renderer === 'extra' ? tab.renderer : 'iframe';
  const surface = String(tab.surface || '').replace(/[^A-Za-z0-9_-]/g, '');
  if (renderer === 'schema' && !surface) return null;

  return {
    id,
    label: String(tab.label || fallbackLabel || packageName),
    packageName,
    view,
    renderer,
    surface,
    order: Number(tab.order) || 100,
  };
}

function listTabs({ packagesDir = packageRoot, keys }) {
  let folders = [];
  try { folders = fs.readdirSync(packagesDir, { withFileTypes: true }); } catch { return []; }

  const tabs = folders.flatMap((entry) => {
    if (!entry.isDirectory() || entry.name === 'settings') return [];
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(packagesDir, entry.name, 'package.json'), 'utf8'));
      const manifest = packageJson.manifest || {};
      const declared = keys.flatMap((key) => entriesFor(manifest, key));
      return declared.map((tab) => normalizeSettingsTab(tab, packageJson.name || entry.name, manifest.name || packageJson.name || entry.name)).filter(Boolean);
    } catch { return []; }
  });

  // Um pacote que declarou ambos os protocolos aparece uma única vez.
  return [...new Map(tabs.map((tab) => [tab.id, tab])).values()]
    .sort((a, b) => a.order - b.order || a.label.localeCompare(b.label));
}

export function listSettingsTabs(options = {}) {
  return listTabs({ ...options, keys: ['settingsTab', 'systemTab'] });
}

// `keysTab` é reservado para configurações de credenciais de integrações.
// Ele mantém essas telas separadas das configurações administrativas, sem
// impedir que pacotes mais antigos continuem usando settingsTab/systemTab.
export function listKeyTabs(options = {}) {
  return listTabs({ ...options, keys: ['keysTab'] });
}

export function listLegacySystemTabs(options = {}) {
  return listTabs({ ...options, keys: ['systemTab'] });
}
