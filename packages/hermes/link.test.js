import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

// O link precisa ser exercitado contra um registro descartável — o import do
// index.js abre o store na hora, então o caminho é definido antes.
const dir = mkdtempSync(join(tmpdir(), 'hermes-link-'));
process.env.HERMES_DEVICES_FILE = join(dir, 'devices.json');
process.on('exit', () => rmSync(dir, { recursive: true, force: true }));

const { store, deliver, emitToDevice, requestAndroidBridge, requestAndroidTools, requestMobileLlm, handleFrame, releaseSocket, connectedDevices } = await import('./index.js');

const APP_ID = 'aBcDeFgHiJkLmNoPqRsTuVwXyZ012345';
const OUTRO  = 'zZyYxXwWvVuUtTsSrRqQpPoOnNmM01234';

/** Socket de mentira: guarda o que foi enviado em vez de ir pra rede. */
function fakeWs() {
  return {
    readyState: 1,
    enviados: [],
    send(raw) { this.enviados.push(JSON.parse(raw)); },
    on() {},
    close() { this.readyState = 3; },
    ultima() { return this.enviados.at(-1); },
    dosTipo(type) { return this.enviados.filter(m => m.type === type); },
  };
}

async function parear(appId = APP_ID) {
  const { token } = store.register({ appId });
  const ws = fakeWs();
  await handleFrame(ws, { action: 'auth', appId, token });
  return { ws, token };
}

test('socket que não autenticou não entra na entrega', async () => {
  const { token } = store.register({ appId: OUTRO });
  const intruso = fakeWs();

  // Conectar e pedir coisa sem provar quem é não pode render nada.
  const r = await handleFrame(intruso, { action: 'ack', id: 'qualquer' });
  assert.equal(r.ok, false);
  assert.equal(intruso.ultima().type, 'error');

  deliver({ appId: OUTRO, message: 'segredo' });
  assert.equal(intruso.dosTipo('notify').length, 0);

  // E com o token certo, aí sim — inclusive recebendo o que ficou na fila
  // enquanto ele ainda não tinha provado quem era.
  await handleFrame(intruso, { action: 'auth', appId: OUTRO, token });
  assert.equal(intruso.dosTipo('auth').at(-1).ok, true);
  assert.equal(intruso.dosTipo('notify').at(-1).message, 'segredo');

  releaseSocket(intruso);
  store.remove(OUTRO);
});

test('auth com token errado é recusada e o socket não passa a receber', async () => {
  store.register({ appId: OUTRO });
  const ws = fakeWs();

  const r = await handleFrame(ws, { action: 'auth', appId: OUTRO, token: 'token-errado' });
  assert.equal(r.ok, false);
  assert.equal(ws.dosTipo('auth').at(-1).ok, false);

  deliver({ appId: OUTRO, message: 'nada disso' });
  assert.equal(ws.dosTipo('notify').length, 0);
  store.remove(OUTRO);
});

test('aparelho autenticado recebe a notificação no socket', async () => {
  const { ws } = await parear();
  try {
    const r = deliver({ appId: APP_ID, message: 'build terminou', title: 'CI' });
    assert.equal(r.delivered, 1);
    assert.equal(r.queued, 0);

    const notify = ws.dosTipo('notify').at(-1);
    assert.equal(notify.message, 'build terminou');
    assert.equal(notify.title, 'CI');
    assert.equal(notify.channel, 'hermes:link');
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('com o aparelho fora, a mensagem espera e sai inteira na reconexão', async () => {
  const { token } = store.register({ appId: APP_ID });
  try {
    // Ninguém conectado: vai pra fila em vez de evaporar (era o que o ntfy
    // fazia, assinando com since=<agora>).
    const r = deliver({ appId: APP_ID, message: 'deploy terminou' });
    assert.equal(r.delivered, 0);
    assert.equal(r.queued, 1);

    const ws = fakeWs();
    await handleFrame(ws, { action: 'auth', appId: APP_ID, token });

    const notify = ws.dosTipo('notify');
    assert.equal(notify.length, 1);
    assert.equal(notify[0].message, 'deploy terminou');

    releaseSocket(ws);
  } finally {
    store.remove(APP_ID);
  }
});

test('device com notificações desativadas não recebe nem acumula fila', async () => {
  store.register({ appId: APP_ID });
  try {
    store.updateNotifications(APP_ID, { enabled: false });
    const r = deliver({ appId: APP_ID, message: 'não deve aparecer' });
    assert.equal(r.success, false);
    assert.equal(r.delivered, 0);
    assert.equal(r.queued, 0);
    assert.equal(r.reason, 'nenhum device com notificações ativas');
    assert.equal(store.list().find(d => d.appId === APP_ID).queued, 0);
  } finally {
    store.remove(APP_ID);
  }
});

test('ping responde pong e ack é aceito', async () => {
  const { ws } = await parear();
  try {
    await handleFrame(ws, { action: 'ping' });
    assert.equal(ws.ultima().type, 'pong');

    const r = await handleFrame(ws, { action: 'ack', id: 'msg-1' });
    assert.equal(r.ok, true);
    assert.equal(r.ack.id, 'msg-1');
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('respond confirma de volta pro aparelho', async () => {
  const { ws } = await parear();
  try {
    const r = await handleFrame(ws, { action: 'respond', id: 'pergunta-1', response: 'confirm' });
    assert.equal(r.ok, true);
    assert.equal(ws.ultima().type, 'responded');
    assert.equal(ws.ultima().id, 'pergunta-1');
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('evento fora do namespace do device é barrado mesmo autenticado', async () => {
  const { ws } = await parear();
  try {
    const r = await handleFrame(ws, { action: 'event', event: 'reload:all' });
    assert.equal(r.ok, false);
    assert.equal(ws.ultima().type, 'error');
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('evento do barramento chega no aparelho conectado', async () => {
  const { ws } = await parear();
  try {
    const r = emitToDevice({ event: 'build:done', payload: { pkg: 'agent' }, appId: APP_ID });
    assert.equal(r.delivered, 1);

    const evt = ws.dosTipo('event').at(-1);
    assert.equal(evt.event, 'build:done');
    assert.deepEqual(evt.payload, { pkg: 'agent' });
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('evento de barramento não vai pra fila quando o aparelho está fora', async () => {
  store.register({ appId: APP_ID });
  try {
    // Ao contrário de notificação, evento descreve algo de agora: entregar
    // meia hora depois confundiria o app.
    const r = emitToDevice({ event: 'build:done', appId: APP_ID });
    assert.equal(r.delivered, 0);
    assert.equal(store.list().find(d => d.appId === APP_ID).queued, 0);
  } finally {
    store.remove(APP_ID);
  }
});

test('ponte Android Cloud usa socket autenticado e correlaciona a resposta', async () => {
  const { ws } = await parear();
  try {
    const pending = requestAndroidBridge({ appId: APP_ID, action: 'status' });
    const request = ws.dosTipo('event').at(-1);
    assert.equal(request.event, 'android:bridge.request');
    assert.equal(request.payload.action, 'status');

    await handleFrame(ws, {
      action: 'event',
      event: 'device:android.bridge.result',
      payload: {
        requestId: request.payload.requestId,
        action: 'status',
        ok: true,
        result: { state: 'active' },
      },
    });
    assert.deepEqual(await pending, {
      success: true,
      action: 'status',
      result: { state: 'active' },
      error: null,
    });
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('ponte Android Cloud recusa ações fora da lista permitida', () => {
  assert.throws(
    () => requestAndroidBridge({ appId: APP_ID, action: 'shell', params: { command: 'id' } }),
    /não permitida/,
  );
});

test('tools nativas Android usam canal próprio, autenticado e correlacionado', async () => {
  const { ws } = await parear();
  try {
    const pending = requestAndroidTools({ appId: APP_ID, operation: 'flashlight.set', params: { enabled: true } });
    const request = ws.dosTipo('event').at(-1);
    assert.equal(request.event, 'android:tools.request');
    assert.equal(request.payload.operation, 'flashlight.set');
    await handleFrame(ws, { action: 'event', event: 'device:android.tools.result', payload: {
      requestId: request.payload.requestId, operation: 'flashlight.set', ok: true, result: { success: true, evidence: { enabled: true } },
    } });
    assert.deepEqual(await pending, {
      success: true, action: 'flashlight.set', result: { success: true, evidence: { enabled: true } }, error: null,
    });
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('ponte Android Cloud permite captura como ação ADB explícita', async () => {
  const { ws } = await parear();
  try {
    const pending = requestAndroidBridge({ appId: APP_ID, action: 'screenshot' });
    const request = ws.dosTipo('event').at(-1);
    assert.equal(request.payload.action, 'screenshot');
    await handleFrame(ws, { action: 'event', event: 'device:android.bridge.result', payload: {
      requestId: request.payload.requestId, action: 'screenshot', ok: true, result: { pngBase64: 'iVBORw0KGgo=' },
    } });
    assert.equal((await pending).success, true);
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('ponte LLM móvel mantém a inferência no aparelho autenticado', async () => {
  const { ws } = await parear();
  try {
    const pending = requestMobileLlm({ appId: APP_ID, action: 'models' });
    const request = ws.dosTipo('event').at(-1);
    assert.equal(request.event, 'mobile:llm.request');
    await handleFrame(ws, { action: 'event', event: 'device:mobile.llm.result', payload: {
      requestId: request.payload.requestId,
      ok: true,
      result: { data: [{ id: 'local:qwen' }] },
    } });
    assert.deepEqual(await pending, { data: [{ id: 'local:qwen' }] });
  } finally {
    releaseSocket(ws);
    store.remove(APP_ID);
  }
});

test('releaseSocket tira o aparelho da lista de conectados', async () => {
  const { ws } = await parear();
  assert.ok(connectedDevices().includes(APP_ID));
  releaseSocket(ws);
  assert.equal(connectedDevices().includes(APP_ID), false);
  store.remove(APP_ID);
});
