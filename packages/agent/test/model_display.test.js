import test from 'node:test';
import assert from 'node:assert/strict';
for (const pkg of ['agent', 'shell']) {
  const m = await import(`../../${pkg}/views/lib/model_display.js`);
  test(`${pkg}: usa o name puro, senão o id puro, sem parsear`, () => {
    assert.equal(m.shortModelLabel({id: 'deepseek-v4-flash-0731@openrouter-primary', label: 'DeepSeek V4 Flash'}), 'DeepSeek V4 Flash');
    assert.equal(m.shortModelLabel({id: 'deepseek-v4-flash-0731@openrouter-primary'}), 'deepseek-v4-flash-0731@openrouter-primary');
    assert.equal(m.shortModelLabel({id: 'stealth/union-alpha'}), 'stealth/union-alpha');
    assert.equal(m.shortModelLabel({id: 'google/gemini-2.5-flash:free', label: 'Gemini 2.5 Flash'}), 'Gemini 2.5 Flash');
    assert.equal(m.shortModelLabel({id: 'google/gemini-2.5-flash:free'}), 'google/gemini-2.5-flash:free');
    assert.equal(m.fullModelLabel({id: 'google/gemini-2.5-flash:free', label: 'Gemini 2.5 Flash'}), 'Gemini 2.5 Flash (Free)');
    assert.equal(m.fullModelLabel({id: 'openai/gpt-5-codex'}), 'openai/gpt-5-codex');
    assert.equal(m.shortModelLabel({id: 'auto', label: 'Auto'}), 'Auto');
  });
  test(`${pkg}: distingue name, model e id de acesso sem modificar texto`, () => {
    const id = 'deepseek/deepseek-v4-flash-0731@openrouter-primary';
    const model = 'deepseek/deepseek-v4-flash-0731';
    assert.equal(m.shortModelLabel({id, model, name: 'DeepSeek V4 Flash 0731'}), 'DeepSeek V4 Flash 0731');
    assert.equal(m.shortModelLabel({id, model, name: ''}), model);
    assert.equal(m.shortModelLabel({id, model, name: '  '}), model);
    assert.equal(m.shortModelLabel({id, name: 'GPT-5.2 Codex'}), 'GPT-5.2 Codex');
    assert.equal(m.shortModelLabel({id, name: 'Union Alpha', label: 'rótulo antigo'}), 'Union Alpha');
    assert.equal(m.shortModelLabel({id}), id);
    const free = {id: 'google/gemini-2.5-flash:free@openrouter-primary', model: 'google/gemini-2.5-flash:free', name: 'Gemini 2.5 Flash'};
    assert.equal(m.shortModelLabel(free), 'Gemini 2.5 Flash');
    assert.equal(m.fullModelLabel(free), 'Gemini 2.5 Flash (Free)');
  });
  test(`${pkg}: o seletor ignora variantes de Batch`, () => {
    const opts = [{id:'a/b-batch'}, {id:'a/b'}, {id:'a/c', label:'Batch mode'}, {id:'auto'}];
    assert.deepEqual(m.visibleModelOptions(opts).map(o=>o.id), ['a/b', 'auto']);
  });
}
