import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const { renderTemplate } = require('../lib/template.cjs');

test('renderiza o contexto de um gatilho sem dependência externa', () => {
  assert.equal(renderTemplate('Evento {{eventName}} para {{specialist.name}}', {
    eventName: 'tasks:completed',
    specialist: { name: 'Operações' },
  }), 'Evento tasks:completed para Operações');
});

test('preserva os blocos condicionais e de coleção dos gatilhos', () => {
  assert.equal(renderTemplate('{#if enabled}{{items.length}} item(ns){:else}desligado{/if}', {
    enabled: true,
    items: ['a', 'b'],
  }), '2 item(ns)');
  assert.equal(renderTemplate('{#each items as item, index}[{{index}}:{{item}}]{/each}', {
    items: ['a', 'b'],
  }), '[0:a][1:b]');
});
