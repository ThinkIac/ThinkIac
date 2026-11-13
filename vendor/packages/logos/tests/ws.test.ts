// tests/ws.test.ts — heartbeat/liveness do WsHub.
//
// Cobre a invariante que evita o "chat travado": um socket morto em silêncio
// (readyState OPEN mas sem responder ao ping) é terminado no ciclo seguinte,
// disparando 'close' → o cliente reconecta e replaya. Um socket vivo (que deu
// pong) sobrevive e recebe o próximo ping.

import { describe, it, expect } from 'vitest';
const { WsHub } = require('../../modules/websocket');

function fakeWs() {
  return {
    isAlive: true,
    readyState: 1,
    pinged: 0,
    terminated: false,
    ping() { this.pinged++; },
    terminate() { this.terminated = true; },
  };
}

describe('WsHub.heartbeatSweep', () => {
  it('termina sockets que não deram pong e re-pinga os vivos', () => {
    const hub = new WsHub();
    const dead = fakeWs();
    const alive = fakeWs();
    hub.wss = { clients: [dead, alive] } as any;

    // Ciclo 1: nenhum foi marcado morto ainda → ambos recebem ping e viram
    // isAlive=false (aguardando pong).
    hub.heartbeatSweep();
    expect(dead.pinged).toBe(1);
    expect(alive.pinged).toBe(1);
    expect(dead.isAlive).toBe(false);
    expect(alive.isAlive).toBe(false);
    expect(dead.terminated).toBe(false);

    // Só o socket vivo responde ao ping (pong remarca isAlive=true).
    alive.isAlive = true;

    // Ciclo 2: o morto (isAlive ainda false) é terminado; o vivo é re-pingado.
    hub.heartbeatSweep();
    expect(dead.terminated).toBe(true);
    expect(alive.terminated).toBe(false);
    expect(alive.pinged).toBe(2);
    expect(alive.isAlive).toBe(false);
  });

  it('é no-op sem servidor', () => {
    const hub = new WsHub();
    expect(() => hub.heartbeatSweep()).not.toThrow();
  });

  it('startHeartbeat é idempotente e stopHeartbeat limpa o timer', () => {
    const hub = new WsHub();
    hub.wss = { clients: [] } as any;
    hub.startHeartbeat();
    const t1 = hub.heartbeatTimer;
    hub.startHeartbeat();
    expect(hub.heartbeatTimer).toBe(t1); // não recria
    hub.stopHeartbeat();
    expect(hub.heartbeatTimer).toBe(null);
  });
});

// Handlers de @stream por dono: a invariante que impedia reload isolado de um
// pacote com stream. Cada reload re-registrava os handlers sem tirar os
// antigos, então o mesmo frame do cliente rodava uma vez por reload acumulado
// e só um restart do processo limpava — o oposto de isolar o pacote.
describe('WsHub — handlers por dono', () => {
  it('offOwner remove só os handlers daquele dono', () => {
    const hub = new WsHub();
    const doTerminal = () => {};
    const doOther = () => {};
    hub.onMessage('terminal', doTerminal, { owner: 'terminal' });
    hub.onMessage('chat', doOther, { owner: 'chat' });

    expect(hub.offOwner('terminal')).toBe(1);
    expect(hub.handlerCount('terminal')).toBe(0);
    expect(hub.handlerCount('chat')).toBe(1);
  });

  it('re-registrar N vezes mantém UM handler vivo por canal', () => {
    const hub = new WsHub();
    let calls = 0;
    for (let i = 0; i < 5; i++) {
      hub.offOwner('terminal');                       // o que mountStreamRoutes faz
      hub.onMessage('terminal', () => { calls++; }, { owner: 'terminal' });
    }
    expect(hub.handlerCount('terminal')).toBe(1);

    for (const handler of (hub as any).messageHandlers.get('terminal')) handler({});
    expect(calls).toBe(1); // sem o offOwner seriam 5
  });

  it('handler sem dono não é afetado por offOwner', () => {
    const hub = new WsHub();
    hub.onMessage('sistema', () => {});
    hub.offOwner('sistema');
    expect(hub.handlerCount('sistema')).toBe(1);
  });

  it('offOwner é no-op para dono desconhecido', () => {
    const hub = new WsHub();
    expect(hub.offOwner('nao-existe')).toBe(0);
  });

});
