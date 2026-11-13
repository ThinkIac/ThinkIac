import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';
import { compile } from 'svelte/compiler';
import { JSDOM } from 'jsdom';

for (const [pkg, component] of [['agent', 'InputBar2'], ['shell', 'InputBar']]) {
  test(`${pkg}: seleção aparece ao lado da seta e abaixo da barra`, async () => {
    const bundle = await build({
      entryPoints: [new URL(`../../${pkg}/views/${component}.svelte`, import.meta.url).pathname],
      bundle: true, write: false, format: 'iife', globalName: 'ComposerModule', platform: 'browser',
      conditions: ['browser'],
      plugins: [{name: 'svelte', setup(build) {
        build.onLoad({filter: /\.svelte$/}, ({path}) => ({
          contents: compile(readFileSync(path, 'utf8'), {filename: path, generate: 'dom', css: false}).js.code,
          loader: 'js',
        }));
      }}],
    });
    const dom = new JSDOM('<!doctype html><div id="app"></div>', {
      url: 'https://test.local', runScripts: 'outside-only', pretendToBeVisual: true,
    });
    const win = dom.window;
    let savedModel = 'auto';
    const accessId = 'deepseek/deepseek-v4-flash-0731@openrouter-primary';
    let modelName = 'DeepSeek V4 Flash 0731';
    win.fetch = async (url, init = {}) => {
      let data = {};
      if (String(url).includes('/session/model')) {
        if (init.method === 'POST') savedModel = JSON.parse(init.body).model;
        data = {model: savedModel, catalog: {accesses: [{
          id: accessId, name: modelName, model: 'deepseek/deepseek-v4-flash-0731', enabled: true, authenticated: true, available: true,
        }]}};
      } else if (String(url).includes('/apps/list')) data = [];
      else if (String(url).includes('/specialists/catalog')) data = {specialists: []};
      return {ok: true, status: 200, json: async () => data};
    };
    win.matchMedia = () => ({matches: false, addEventListener() {}, removeEventListener() {}});
    win.ResizeObserver = class { observe() {} disconnect() {} };
    let composer;
    const settle = () => new Promise(resolve => setTimeout(resolve, 35));
    try {
      win.eval(bundle.outputFiles[0].text);
      composer = new win.ComposerModule.default({target: win.document.querySelector('#app'), props: {sessionId: 'summary-test'}});
      await settle();
      const doc = win.document;
      const trigger = doc.querySelector('.state-trigger');
      assert.ok(trigger);
      trigger.click();
      await settle();
      const modelHeading = [...doc.querySelectorAll('.acc-head')].find(el => el.textContent.includes('Model'));
      assert.equal(modelHeading.getAttribute('aria-expanded'), 'false');
      modelHeading.click();
      await settle();
      const choice = [...doc.querySelectorAll('.model-row')].find(el => el.textContent.includes(modelName));
      assert.ok(choice);
      choice.click();
      await settle();
      assert.equal(savedModel, accessId);
      assert.equal(modelHeading.getAttribute('aria-expanded'), 'false');
      assert.match(trigger.querySelector('.selection-inline').textContent, /DeepSeek V4 Flash 0731/);
      const footer = doc.querySelector('.selection-footer');
      assert.match(footer.textContent, /DeepSeek V4 Flash 0731/);
      assert.equal(footer.closest('.ib-shell'), null, 'Resumo fica fora da caixa de entrada');
      assert.equal(footer.parentElement, doc.querySelector('.ib-wrap'));
      trigger.click();
      await settle();
      assert.match(footer.textContent, /DeepSeek V4 Flash 0731/, 'Fechar gaveta preserva o resumo');
      assert.equal(trigger.querySelector('.selection-inline').textContent, modelName);
      assert.ok(!trigger.textContent.includes('@openrouter'));
      
      modelName = '';
      trigger.click();
      await settle();
      modelHeading.click();
      await settle();
      assert.equal(trigger.querySelector('.selection-inline').textContent, 'deepseek/deepseek-v4-flash-0731');
      assert.match(footer.textContent, /deepseek\/deepseek-v4-flash-0731/);
      assert.equal(savedModel, accessId, 'Formatação nunca muda o id usado no envio');
    } finally {
      composer?.$destroy();
      dom.window.close();
    }
  });
}
