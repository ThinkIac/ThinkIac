'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { BROWSER_TOOLS, inferCapabilities } = require('./capability-profiles');

test('pedido de navegação garante o fluxo GeckoView completo', () => {
    const result = inferCapabilities('Abra o site, pesquise o produto e preencha o formulário');
    assert.deepEqual(result.capabilities, ['browser.operate']);
    assert.deepEqual(result.tools, BROWSER_TOOLS);
});

test('menção ao GeckoView garante as tools mesmo se o classificador LLM falhar', () => {
    const result = inferCapabilities('Navegue no GeckoView e clique em Entrar');
    assert.deepEqual(result.capabilities, ['browser.operate']);
    assert.ok(result.tools.includes('browser_list_tabs'));
    assert.ok(result.tools.includes('browser_get_page_state'));
    assert.ok(result.tools.includes('browser_click'));
    assert.ok(result.tools.includes('browser_wait'));
});

test('capacidade Browser respeita o catálogo vivo', () => {
    const result = inferCapabilities('Acesse o site', new Set(['browser_list_tabs', 'browser_navigate']));
    assert.deepEqual(result.tools, ['browser_list_tabs', 'browser_navigate']);
});

test('pedido explícito de criação garante as tools de Tasks', () => {
    const result = inferCapabilities('Crie duas tarefas para revisar o mobile');
    assert.deepEqual(result.capabilities, ['tasks.create']);
    assert.deepEqual(result.tools, ['listBoards', 'createTask', 'createTaskFromText']);
});

test('capacidade respeita o catálogo elegível', () => {
    const result = inferCapabilities('Crie uma task', new Set(['createTaskFromText']));
    assert.deepEqual(result.tools, ['createTaskFromText']);
});

test('conversa sobre tarefas não vira intenção de criação', () => {
    assert.deepEqual(inferCapabilities('Quero pensar sobre como tarefas funcionam').capabilities, []);
});
