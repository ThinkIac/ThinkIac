import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';
const read = p => readFileSync(new URL(p, import.meta.url), 'utf8');
for (const pkg of ['shell', 'agent']) {
  const input = read(`../../${pkg}/views/${pkg === 'shell' ? 'InputBar' : 'InputBar2'}.svelte`);
  test(`${pkg}: seções fechadas sem restaurar estado de abertura`, () => {
    assert.match(input, /let openSection = null;/);
    assert.match(input, /\$: if \(!stateOpen\) openSection = null;/);
    assert.doesNotMatch(input, /openSectionInit|saved\.openSection/);
    assert.match(input, /on:selection=\{\(\) => closeSelectedSection\(entry.id\)\}/);
  });
  test(`${pkg}: seleção atual e salva recolhem, falha permanece aberta`, async () => {
    const fn = input.slice(input.indexOf('  async function selectModel(id)'), input.indexOf('  async function fetchSpecialist'));
    const closes = [];
    let ok = true;
    const request = async () => ({ok, status: 500, json: async () => ({model: 'chosen'})});
    const ctx = vm.createContext({modelSaving: false, modelOverride: 'auto', sessionId: 'test',
      agentRuntime: {request}, fetch: request, unwrapRouteData: x => x,
      closeSelectedSection: id => closes.push(id), console: {error() {}}});
    vm.runInContext(fn, ctx);
    await ctx.selectModel('auto');
    assert.deepEqual(closes, ['native:model']);
    await ctx.selectModel('chosen');
    assert.equal(closes.length, 2);
    ok = false;
    await ctx.selectModel('failed');
    assert.equal(closes.length, 2);
    assert.equal(ctx.modelOverride, 'chosen');
    assert.equal(ctx.modelSaving, false);
  });
  test(`${pkg}: widget só recolhe com iframe, origem e sessão correspondentes`, () => {
    const widget = read(`../../${pkg}/views/components/PackageWidget.svelte`);
    const fn = widget.slice(widget.indexOf('    function onMessage(ev)'), widget.indexOf('    // Cleanup'));
    const frame = {}, events = [];
    const ctx = vm.createContext({iframeEl: {contentWindow: frame}, source: 'test',
      window: {location: {origin: 'https://test.local'}}, dispatch: e => events.push(e)});
    vm.runInContext(fn, ctx);
    const event = {source: frame, origin: 'https://test.local', data: {source:'agent', type:'widget:selection', detail: {sessionId: 'test'}}};
    ctx.onMessage({...event, source: {}});
    ctx.onMessage({...event, origin:'https://other.local'});
    ctx.onMessage({...event, data:{...event.data, detail:{sessionId:'other'}}});
    assert.equal(events.length, 0);
    ctx.onMessage(event);
    assert.deepEqual(events, ['selection']);
    ctx.onMessage({...event, data: {...event.data, source: 'aurora', type: 'widget:state', detail: {sessionId: 'test', label: 'Semi · Custom'}}});
    assert.deepEqual(events, ['selection', 'state']);
  });
}
