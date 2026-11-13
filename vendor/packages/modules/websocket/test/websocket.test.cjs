'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { WsHub } = require('..');
const http = require('node:http');
const WebSocket = require('ws');

function socket() {
  return { isAlive: true, readyState: 1, pings: 0, terminated: false,
    ping() { this.pings++; }, terminate() { this.terminated = true; } };
}

test('heartbeat termina socket sem pong e mantém o vivo', () => {
  const hub = new WsHub(); const dead = socket(); const alive = socket();
  hub.wss = { clients: [dead, alive] };
  hub.heartbeatSweep(); alive.isAlive = true; hub.heartbeatSweep();
  assert.equal(dead.terminated, true); assert.equal(alive.terminated, false);
  assert.equal(alive.pings, 2);
});

test('handlers por dono são substituíveis sem afetar outros', () => {
  const hub = new WsHub(); let calls = 0;
  hub.onMessage('other', () => {}, { owner: 'other' });
  for (let i = 0; i < 3; i++) { hub.offOwner('chat'); hub.onMessage('chat', () => calls++, { owner: 'chat' }); }
  assert.equal(hub.handlerCount('chat'), 1); assert.equal(hub.handlerCount('other'), 1);
  for (const handler of hub.messageHandlers.get('chat')) handler({});
  assert.equal(calls, 1); assert.equal(hub.offOwner('chat'), 1);
});

test('autorização falha fechada e é reavaliada', async () => {
  const hub = new WsHub(); let allowed = true;
  hub.authorize = async () => allowed;
  assert.equal(await hub.isAuthorized({}), true); allowed = false;
  assert.equal(await hub.isAuthorized({}), false);
  hub.authorize = async () => { throw new Error('unavailable'); };
  assert.equal(await hub.isAuthorized({}), false);
});

test('conecta uma sessão autorizada e entrega mensagens direcionadas', async t => {
  const server = http.createServer();
  const hub = new WsHub();
  hub.create(server, { authorize: () => true });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  const client = new WebSocket(`ws://127.0.0.1:${port}/ws?session=contract`);
  t.after(async () => {
    client.terminate();
    await new Promise(resolve => server.close(resolve));
  });
  const messages = [];
  await new Promise((resolve, reject) => {
    client.once('error', reject);
    client.on('message', raw => { messages.push(JSON.parse(raw)); if (messages.length === 2) resolve(); });
    client.once('open', () => hub.pushToSession('contract', { type: 'contract', ok: true }));
  });
  assert.deepEqual(messages, [
    { type: 'connected', sessionId: 'contract' },
    { type: 'contract', ok: true },
  ]);
  assert.equal(hub.isConnected('contract'), true);
});
