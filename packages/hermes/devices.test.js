import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  createDeviceStore,
  isValidAppId,
  tokenMatches,
  pruneDevices,
  pruneOutbox,
  DEVICE_TTL_MS,
  OUTBOX_TTL_MS,
  OUTBOX_MAX,
} from './devices.js';

const APP_ID = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';

function novoStore() {
  const dir = mkdtempSync(join(tmpdir(), 'hermes-'));
  const store = createDeviceStore(join(dir, 'devices.json'));
  return { store, limpar: () => rmSync(dir, { recursive: true, force: true }) };
}

test('appId só é aceito no formato que o aparelho gera', () => {
  assert.equal(isValidAppId(APP_ID), true);
  assert.equal(isValidAppId('curto'), false);
  assert.equal(isValidAppId('tem espaço aqui dentro!!!!!!'), false);
  assert.equal(isValidAppId(null), false);
});

test('tokenMatches recusa tamanho diferente sem estourar', () => {
  assert.equal(tokenMatches('abc', 'abc'), true);
  assert.equal(tokenMatches('abc', 'abcd'), false);
  assert.equal(tokenMatches('abc', undefined), false);
});

test('registro cria o device e cunha um token', () => {
  const { store, limpar } = novoStore();
  try {
    const r = store.register({ appId: APP_ID, name: 'Pixel' });
    assert.equal(r.created, true);
    assert.equal(r.appId, APP_ID);
    assert.ok(r.token.length > 20);
  } finally { limpar(); }
});

test('re-registro sem o token vigente é recusado (não dá pra sequestrar o stream)', () => {
  const { store, limpar } = novoStore();
  try {
    store.register({ appId: APP_ID, name: 'Pixel' });
    assert.throws(
      () => store.register({ appId: APP_ID, name: 'Impostor' }),
      err => err.status === 409,
    );
  } finally { limpar(); }
});

test('re-registro com o token vigente renova o nome e mantém o token', () => {
  const { store, limpar } = novoStore();
  try {
    const first = store.register({ appId: APP_ID, name: 'Pixel' });
    const again = store.register({ appId: APP_ID, name: 'Pixel 8', token: first.token });
    assert.equal(again.created, false);
    assert.equal(again.token, first.token);
    assert.equal(again.name, 'Pixel 8');
  } finally { limpar(); }
});

test('authenticate só passa com o par (appId, token) correto', () => {
  const { store, limpar } = novoStore();
  try {
    const { token } = store.register({ appId: APP_ID });
    assert.ok(store.authenticate(APP_ID, token));
    assert.equal(store.authenticate(APP_ID, 'token-errado'), null);
    assert.equal(store.authenticate('outroAppIdQueNaoExiste00000000000', token), null);
  } finally { limpar(); }
});

test('list nunca vaza o token', () => {
  const { store, limpar } = novoStore();
  try {
    store.register({ appId: APP_ID });
    const [device] = store.list();
    assert.equal('token' in device, false);
    assert.equal(device.appId, APP_ID);
  } finally { limpar(); }
});

test('notificações iniciam habilitadas e o diagnóstico não vaza token de push', () => {
  const { store, limpar } = novoStore();
  try {
    store.register({ appId: APP_ID });
    const updated = store.updateNotifications(APP_ID, {
      enabled: false,
      push: { provider: 'fcm', token: 'segredo-do-push' },
    });
    assert.equal(updated.notificationsEnabled, false);
    assert.equal(updated.pushConfigured, true);

    const [device] = store.list();
    assert.equal(device.notificationsEnabled, false);
    assert.equal(device.pushConfigured, true);
    assert.equal('push' in device, false);
    assert.equal(JSON.stringify(device).includes('segredo-do-push'), false);
  } finally { limpar(); }
});

test('mensagem enfileirada com o aparelho fora sai inteira quando ele volta', () => {
  const { store, limpar } = novoStore();
  try {
    store.register({ appId: APP_ID });
    store.enqueue(APP_ID, { id: 'a', sentAt: Date.now(), message: 'build terminou' });
    store.enqueue(APP_ID, { id: 'b', sentAt: Date.now(), message: 'deploy ok' });

    const pendentes = store.drain(APP_ID);
    assert.deepEqual(pendentes.map(m => m.id), ['a', 'b']);
    // Segunda passada já vem vazia — drenar consome.
    assert.deepEqual(store.drain(APP_ID), []);
  } finally { limpar(); }
});

test('enqueue em device desconhecido não cria device fantasma', () => {
  const { store, limpar } = novoStore();
  try {
    assert.equal(store.enqueue(APP_ID, { id: 'x', sentAt: Date.now() }), false);
    assert.equal(store.list().length, 0);
  } finally { limpar(); }
});

test('ack registra a última entrega confirmada', () => {
  const { store, limpar } = novoStore();
  try {
    store.register({ appId: APP_ID });
    store.recordDelivery(APP_ID, { id: 'msg-1', status: 'sent' }, 1000);
    const ack = store.ack(APP_ID, 'msg-1', 1125);
    assert.equal(ack.id, 'msg-1');
    assert.ok(Number.isFinite(ack.at));
    assert.equal(ack.latencyMs, 125);
  } finally { limpar(); }
});

test('device parado além do TTL some do registro', () => {
  const agora = Date.now();
  const vivos = pruneDevices([
    { appId: APP_ID, lastSeenAt: agora },
    { appId: 'zZyYxXwWvVuUtTsSrRqQpPoOnNmM0123', lastSeenAt: agora - DEVICE_TTL_MS - 1 },
  ], agora);
  assert.deepEqual(vivos.map(d => d.appId), [APP_ID]);
});

test('fila descarta o que envelheceu e, no teto, mantém as mais novas', () => {
  const agora = Date.now();

  const semVelhas = pruneOutbox([
    { id: 'velha', sentAt: agora - OUTBOX_TTL_MS - 1 },
    { id: 'nova', sentAt: agora },
  ], agora);
  assert.deepEqual(semVelhas.map(m => m.id), ['nova']);

  const muitas = Array.from({ length: OUTBOX_MAX + 10 }, (_, i) => ({ id: `m${i}`, sentAt: agora }));
  const cortada = pruneOutbox(muitas, agora);
  assert.equal(cortada.length, OUTBOX_MAX);
  // Perdeu as antigas, não as recentes.
  assert.equal(cortada.at(-1).id, `m${OUTBOX_MAX + 9}`);
});
