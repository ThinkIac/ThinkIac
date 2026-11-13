import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseInput,
  extractReferences,
  suggest,
  mergeCommands,
  NATIVE_COMMANDS,
} from './commands.js';

test('texto normal continua sendo mensagem', () => {
  const r = parseInput('como faço um loop em dart?');
  assert.equal(r.kind, 'message');
  assert.deepEqual(r.refs, []);
});

test('vazio não vira comando', () => {
  assert.equal(parseInput('').kind, 'message');
  assert.equal(parseInput('    ').kind, 'message');
});

test('! roda shell na sessão e !! roda isolado', () => {
  const um = parseInput('!ls -la');
  assert.equal(um.kind, 'shell');
  assert.equal(um.isolated, false);
  assert.equal(um.command, 'ls -la');

  const dois = parseInput('!!rm -rf /tmp/x');
  assert.equal(dois.kind, 'shell');
  assert.equal(dois.isolated, true);
  assert.equal(dois.command, 'rm -rf /tmp/x');
});

test('!! é reconhecido antes de ! (senão todo isolado viraria sessão)', () => {
  
  
  const r = parseInput('!!echo oi');
  assert.equal(r.isolated, true);
  assert.equal(r.command, 'echo oi');
});

test('shell aceita espaço depois do prefixo', () => {
  const r = parseInput('!  echo   oi');
  assert.equal(r.command, 'echo   oi');
});

test('/usage e /btw são reconhecidos', () => {
  const usage = parseInput('/usage');
  assert.equal(usage.kind, 'command');
  assert.equal(usage.name, 'usage');
  assert.equal(usage.args, '');

  const btw = parseInput('/btw qual era o nome daquele pacote?');
  assert.equal(btw.kind, 'command');
  assert.equal(btw.name, 'btw');
  assert.equal(btw.args, 'qual era o nome daquele pacote?');
});

test('comando é case-insensitive no nome', () => {
  assert.equal(parseInput('/USAGE').name, 'usage');
});

test('comando desconhecido não vira mensagem silenciosamente', () => {
  
  
  const r = parseInput('/deploi agora');
  assert.equal(r.kind, 'unknown-command');
  assert.equal(r.name, 'deploi');
});

test('barra no meio da frase não é comando', () => {
  const r = parseInput('use o caminho /etc/hosts aqui');
  assert.equal(r.kind, 'message');
});

test('@arquivo e #pacote viram referências sem sumir do texto', () => {
  const r = parseInput('olha o @lib/main.dart junto do #agent');
  assert.equal(r.kind, 'message');
  assert.deepEqual(r.refs, [
    { kind: 'file', target: 'lib/main.dart' },
    { kind: 'package', target: 'agent' },
  ]);
  
  assert.equal(r.text, 'olha o lib/main.dart junto do agent');
});

test('e-mail não vira referência', () => {
  const { refs } = extractReferences('manda pra fulano@empresa.com');
  assert.deepEqual(refs, []);
});

test('referência no começo da linha é capturada', () => {
  const { refs } = extractReferences('@README.md explica isso');
  assert.deepEqual(refs, [{ kind: 'file', target: 'README.md' }]);
});

test('autocomplete filtra pelo que já foi digitado', () => {
  const todos = suggest('/');
  assert.ok(todos.length >= 2);

  const us = suggest('/us');
  assert.deepEqual(us.map((s) => s.insert), ['/usage']);

  assert.deepEqual(suggest('/zzz'), []);
  assert.deepEqual(suggest('oi'), []);
});

test('autocomplete de shell oferece as duas formas', () => {
  const s = suggest('!');
  assert.deepEqual(s.map((x) => x.insert), ['!', '!!']);
});

test('pacote acrescenta comando, mas não sequestra um nativo', () => {
  const merged = mergeCommands([
    { name: '/deploy', summary: 'Publica', pkg: 'store' },
    { name: 'usage', summary: 'sequestro', pkg: 'malicioso' },
  ]);

  const usage = merged.filter((c) => c.name === 'usage');
  assert.equal(usage.length, 1);
  assert.equal(usage[0].summary, NATIVE_COMMANDS.find((c) => c.name === 'usage').summary);

  assert.ok(merged.find((c) => c.name === 'deploy'));
});

test('comando de pacote é reconhecido pelo parser quando passado na lista', () => {
  const commands = mergeCommands([{ name: 'deploy', summary: 'Publica', pkg: 'store' }]);
  const r = parseInput('/deploy prod', { commands });
  assert.equal(r.kind, 'command');
  assert.equal(r.name, 'deploy');
  assert.equal(r.args, 'prod');
});
