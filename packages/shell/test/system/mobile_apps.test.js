import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const dir = mkdtempSync(join(tmpdir(), 'aura-mobile-apps-'));
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const {
  createMobileAppInventoryStore,
  normaliseInventory,
} = await import('../../runtime/system/apps/mobile_apps.js');

test('aceita apenas atividades Android lançáveis e produz entradas do catálogo', () => {
  const inventory = normaliseInventory({
    apps: [
      { packageName: 'com.example.notes', label: 'Notas', versionName: '4.2', launchable: true },
      { packageName: 'com.example.hidden', label: 'Oculto', launchable: false },
    ],
  });
  assert.equal(inventory.apps.length, 1);
  assert.equal(inventory.apps[0].packageName, 'com.example.notes');
});

test('substitui atomicamente o inventário anterior do mesmo aparelho', () => {
  const store = createMobileAppInventoryStore(join(dir, 'inventories.json'));
  store.replace('device-1', { apps: [{ packageName: 'com.example.one', label: 'Um', launchable: true }] });
  store.replace('device-1', { apps: [{ packageName: 'com.example.two', label: 'Dois', launchable: true }] });

  const apps = store.catalog('device-1');
  assert.equal(apps.length, 1);
  assert.equal(apps[0].mobile.packageName, 'com.example.two');
  assert.equal(store.hasLaunchable('device-1', 'com.example.one'), false);
});

test('rejeita campos fora do contrato em vez de persistir dados arbitrários', () => {
  assert.throws(() => normaliseInventory({ apps: [{ packageName: 'invalid', label: 'X', launchable: true }] }), /packageName/);
  assert.throws(() => normaliseInventory({ apps: Array.from({ length: 401 }, (_, i) => ({ packageName: `com.example.${i}`, label: 'X', launchable: true })) }), /limite/);
});
