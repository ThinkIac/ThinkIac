// Testes do Dialogs. Rodar: node packages/ui-dialogs/test/dialogs.test.js
//
// Compila o .svelte de verdade (compilador do repo) e monta o componente num
// DOM mínimo, então o que é testado é o contrato que as views usam:
// askConfirm/askPrompt resolvem com o valor certo, e uma chamada disparada
// enquanto outra está aberta não perde a Promise.

const fs = require('fs');
const path = require('path');
const assert = require('assert');
const Module = require('module');

const REPO_ROOT = '/root/code/ThinkIac';
const { compile } = require(path.join(REPO_ROOT, 'node_modules/svelte/src/compiler/index.js'));

const COMPONENT = path.join(__dirname, '..', 'views', 'components', 'Dialogs.svelte');

// Compila o componente e carrega em memória, resolvendo `svelte/*` contra o
// node_modules do repo. O Svelte 4 só emite ESM; quem carrega é o suporte a
// require(esm) do Node 22, por isso `exports` traz `default` + as nomeadas.
function loadComponent(file) {
  const { js } = compile(fs.readFileSync(file, 'utf8'), {
    filename: file,
    generate: 'dom',
  });
  const mod = new Module(file, null);
  mod.filename = file;
  mod.paths = Module._nodeModulePaths(path.join(REPO_ROOT, 'node_modules'));
  mod._compile(js.code, file);
  return mod.exports;
}

let passed = 0;
async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log(`PASS  ${name}`);
  } catch (e) {
    console.error(`FAIL  ${name}\n      ${e.message}`);
    process.exitCode = 1;
  }
}

(async () => {
  // DOM mínimo
  let jsdom;
  try {
    jsdom = require(path.join(REPO_ROOT, 'node_modules/jsdom'));
  } catch {
    console.log('SKIP  jsdom não disponível — testes de DOM pulados');
    return;
  }
  const dom = new jsdom.JSDOM('<!doctype html><html><body></body></html>');
  global.window = dom.window;
  global.document = dom.window.document;
  global.navigator = dom.window.navigator;
  global.Element = dom.window.Element;
  global.HTMLElement = dom.window.HTMLElement;
  global.SVGElement = dom.window.SVGElement;
  global.Node = dom.window.Node;
  global.CustomEvent = dom.window.CustomEvent;
  global.Event = dom.window.Event;
  global.requestAnimationFrame = (cb) => setTimeout(cb, 0);

  const Dialogs = loadComponent(COMPONENT);
  const { askConfirm, askPrompt, askAlert } = Dialogs;
  const target = document.body;
  new Dialogs.default({ target });

  const flush = () => new Promise((r) => setTimeout(r, 0));
  const buttons = () => [...target.querySelectorAll('.dlg-btn')];
  const clickLabel = (label) => {
    const btn = buttons().find((b) => b.textContent.trim() === label);
    assert.ok(btn, `botão "${label}" não encontrado; visíveis: ${buttons().map(b => b.textContent.trim())}`);
    btn.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true }));
  };

  await test('askConfirm resolve true ao confirmar', async () => {
    const p = askConfirm('Remover?');
    await flush();
    clickLabel('Confirmar');
    assert.strictEqual(await p, true);
  });

  await test('askConfirm resolve false ao cancelar', async () => {
    const p = askConfirm('Remover?');
    await flush();
    clickLabel('Cancelar');
    assert.strictEqual(await p, false);
  });

  await test('askPrompt cancelado resolve null, como o nativo', async () => {
    const p = askPrompt('Nome:', 'Nova Lista');
    await flush();
    clickLabel('Cancelar');
    assert.strictEqual(await p, null);
  });

  await test('askPrompt resolve o valor default sem edição', async () => {
    const p = askPrompt('Nome:', 'Nova Lista');
    await flush();
    clickLabel('OK');
    assert.strictEqual(await p, 'Nova Lista');
  });

  await test('askPrompt resolve o texto digitado', async () => {
    const p = askPrompt('Nome:', 'x');
    await flush();
    const input = target.querySelector('.dlg-input');
    input.value = 'Feira do mês';
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    await flush();
    clickLabel('OK');
    assert.strictEqual(await p, 'Feira do mês');
  });

  await test('duas chamadas concorrentes não perdem Promise (fila)', async () => {
    // O bug clássico do estado único: a segunda sobrescreve a primeira e a
    // primeira Promise nunca resolve — o botão trava para sempre.
    const p1 = askConfirm('Primeira?');
    const p2 = askConfirm('Segunda?');
    await flush();
    assert.ok(target.textContent.includes('Primeira?'), 'a primeira deve aparecer antes');
    clickLabel('Confirmar');
    await flush();
    assert.ok(target.textContent.includes('Segunda?'), 'a segunda entra depois que a primeira sai');
    clickLabel('Cancelar');
    assert.strictEqual(await p1, true);
    assert.strictEqual(await p2, false);
  });

  await test('askAlert tem só um botão e resolve ao fechar', async () => {
    const p = askAlert('Deu ruim');
    await flush();
    assert.strictEqual(buttons().length, 1, 'alert não tem Cancelar');
    clickLabel('OK');
    await p;
  });

  await test('nada renderizado quando não há diálogo aberto', async () => {
    await flush();
    assert.strictEqual(target.querySelector('.dlg-backdrop'), null);
  });

  console.log(`\n${passed} testes passaram`);
})();
