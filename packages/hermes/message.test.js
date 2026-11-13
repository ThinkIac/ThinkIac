import assert from 'node:assert/strict';
import test from 'node:test';

import {
  normaliseMessage,
  normaliseDisplay,
  normaliseInteraction,
  parseDeviceFrame,
  DEFAULT_HOLD_SEC,
  MAX_MESSAGE,
} from './message.js';

test('mensagem sem corpo é recusada', () => {
  assert.throws(() => normaliseMessage({}), /message/);
  assert.throws(() => normaliseMessage({ message: '   ' }), /message/);
});

test('mensagem ganha id, carimbo e título padrão', () => {
  const msg = normaliseMessage({ message: 'build terminou' });
  assert.equal(msg.type, 'notify');
  assert.equal(msg.title, 'ThinkIac');
  assert.ok(msg.id);
  assert.ok(Number.isFinite(msg.sentAt));
});

test('discreteId atualiza o cartão sem reutilizar o id de interação', () => {
  const a = normaliseMessage({ message: 'oi', discreteId: 'sessao-42' });
  const b = normaliseMessage({ message: 'oi de novo', discreteId: 'sessao-42' });
  assert.deepEqual(a.display, { mode: 'discrete', key: 'sessao-42' });
  assert.notEqual(a.id, b.id);
  const explicit = normaliseMessage({ message: 'oi', discreteId: 'sessao-42', id: 'turno-7' });
  assert.equal(explicit.id, 'turno-7');
});

test('contexto estruturado acompanha a entrega', () => {
  const msg = normaliseMessage({ message: 'oi', context: { kind: 'chat-response', sessionId: 's1' } });
  assert.deepEqual(msg.context, { kind: 'chat-response', sessionId: 's1' });
});

test('sem discreteId o display é a notificação principal com hold', () => {
  assert.deepEqual(normaliseDisplay({}), { mode: 'principal', holdSec: DEFAULT_HOLD_SEC });
  assert.deepEqual(normaliseDisplay({ hold: 15 }), { mode: 'principal', holdSec: 15 });
  // hold absurdo é limitado, não aceito de olhos fechados
  assert.equal(normaliseDisplay({ hold: 999999 }).holdSec, 3600);
  assert.equal(normaliseDisplay({ hold: -5 }).holdSec, DEFAULT_HOLD_SEC);
});

test('interaction só aceita os dois tipos previstos', () => {
  assert.deepEqual(normaliseInteraction('confirm'), { type: 'confirm' });
  assert.deepEqual(normaliseInteraction({ type: 'prompt' }), { type: 'prompt' });
  assert.equal(normaliseInteraction('excluir-tudo'), null);
  assert.equal(normaliseInteraction(null), null);
});

test('corpo gigante é truncado em vez de passar direto', () => {
  const msg = normaliseMessage({ message: 'x'.repeat(MAX_MESSAGE + 500) });
  assert.equal(msg.message.length, MAX_MESSAGE);
});

test('frame sem action é rejeitado', () => {
  assert.equal(parseDeviceFrame({}).ok, false);
  assert.equal(parseDeviceFrame({ action: 'voar' }).ok, false);
});

test('auth exige appId e token', () => {
  assert.equal(parseDeviceFrame({ action: 'auth', appId: 'a' }).ok, false);
  const r = parseDeviceFrame({ action: 'auth', appId: 'abc', token: 'xyz' });
  assert.equal(r.ok, true);
  assert.equal(r.frame.appId, 'abc');
});

test('respond valida a resposta e exige texto no submit', () => {
  assert.equal(parseDeviceFrame({ action: 'respond', id: '1', response: 'talvez' }).ok, false);
  assert.equal(parseDeviceFrame({ action: 'respond', id: '1', response: 'submit' }).ok, false);
  assert.equal(parseDeviceFrame({ action: 'respond', id: '1', response: 'confirm' }).ok, true);

  const r = parseDeviceFrame({ action: 'respond', id: '1', response: 'submit', value: 'pode publicar' });
  assert.equal(r.frame.value, 'pode publicar');
});

test('device só emite evento no próprio namespace', () => {
  // O aparelho não pode mexer no runtime inteiro a partir do bolso de alguém.
  assert.equal(parseDeviceFrame({ action: 'event', event: 'auth:check' }).ok, false);
  assert.equal(parseDeviceFrame({ action: 'event', event: 'reload:all' }).ok, false);

  const r = parseDeviceFrame({ action: 'event', event: 'device:location', payload: { lat: 1 } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.frame.payload, { lat: 1 });
});

test('payload não-objeto no event vira objeto vazio em vez de vazar tipo estranho', () => {
  const r = parseDeviceFrame({ action: 'event', event: 'device:x', payload: 'texto' });
  assert.deepEqual(r.frame.payload, {});
});
