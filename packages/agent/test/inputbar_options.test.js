import test from 'node:test';
import assert from 'node:assert/strict';
import { get } from 'svelte/store';

for (const pkg of ['agent', 'shell']) {
  const options = await import(`../../${pkg}/views/lib/inputbar_options.js`);
  test(`${pkg}: SSR, valores inválidos e storage bloqueado`, () => {
    assert.deepEqual(options.loadInputBarOptions(null), options.DEFAULT_OPTIONS);
    const blocked = { getItem() { throw Error('blocked'); }, setItem() { throw Error('quota'); } };
    assert.deepEqual(options.loadInputBarOptions(blocked), options.DEFAULT_OPTIONS);
    assert.doesNotThrow(() => options.saveInputBarOptions({}, blocked));
    assert.deepEqual(options.loadInputBarOptions({ getItem: () => '{' }), options.DEFAULT_OPTIONS);
    assert.deepEqual(options.normalizeInputBarOptions({ moeEnabled: 'false', reasoningMode: 'tot', approximation: 'bad' }), options.DEFAULT_OPTIONS);
  });
  test(`${pkg}: preferências sobrevivem ao reload sem salvar dados sensíveis`, () => {
    const map = new Map();
    const storage = { getItem: k => map.get(k), setItem: (k,v) => map.set(k,v) };
    const value = { moeEnabled: false, reasoningMode: 'cot', approximation: 'compact', locationApproximate: false, pinsTab: 'inactive', model: 'chosen-model' };
    options.saveInputBarOptions({ ...value, model: 'chosen-model', openSection: "native:model", location: { latitude: 1 }, workspace: '/secret' }, storage);
    assert.deepEqual(options.loadInputBarOptions(storage), value);
    assert.ok(!map.get(options.INPUTBAR_OPTIONS_KEY).includes('openSection'));
    assert.ok(!map.get(options.INPUTBAR_OPTIONS_KEY).includes('latitude'));
    assert.ok(!map.get(options.INPUTBAR_OPTIONS_KEY).includes('/secret'));
  });
  const registry = await import(`../../${pkg}/views/lib/inputbar_bootstrap.js`);
  test(`${pkg}: três destaques no máximo e estados sempre disponíveis`, () => {
    registry.maxPinned.set(99);
    assert.equal(get(registry.pinnedActions).length, 3);
    registry.maxPinned.set(NaN);
    assert.equal(get(registry.pinnedActions).length, 3);
    registry.setEntryVisible('native:model', false);
    registry.setEntryVisible('native:specialist', false);
    assert.deepEqual(get(registry.stateEntries).map(e => e.id), ['native:model', 'native:specialist']);
    assert.ok(get(registry.allInputBarEntries).filter(e => e.kind === 'state').every(e => e.visible));
    registry.setEntryVisible('native:attach', false);
    assert.equal(get(registry.pinnedActions).length, 2);
    registry.resetInputBarConfig();
    registry.maxPinned.set(3);
  });
}
