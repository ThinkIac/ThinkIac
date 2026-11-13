import { describe, it, expect } from 'vitest';
const { WsHub } = require('../../modules/websocket');
import http from 'node:http';
import { WebSocket } from 'ws';
import { once } from 'node:events';

describe('WebSocket host authorization', () => {
  it('blocks unauthenticated sockets and stops direct sends and inbound actions after revocation', async () => {
    const server = http.createServer(); const hub = new WsHub(); let allowed = true;
    hub.create(server, { authorize: req => allowed && req.headers.authorization === 'test-admin' });
    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    const url = `ws://127.0.0.1:${(server.address() as any).port}/ws?session=known-admin-session`;
    const rejected = new WebSocket(url);
    try {
      const [code] = await once(rejected, 'close'); expect(code).toBe(1008);
      const client = new WebSocket(url, { headers: { authorization: 'test-admin' } });
      const [connected] = await once(client, 'message'); expect(JSON.parse(connected.toString()).type).toBe('connected');
      let actions = 0; hub.onMessage('danger', () => actions++);
      allowed = false;
      const closed = once(client, 'close');
      client.send(JSON.stringify({ type: 'danger' }));
      for (const ws of hub.wss.clients) ws.send(JSON.stringify({ secret: 'must not arrive' }));
      let deliveries = 0; client.on('message', () => deliveries++);
      expect((await closed)[0]).toBe(1008);expect(actions).toBe(0);expect(deliveries).toBe(0);
    } finally {
      for (const ws of hub.wss.clients) ws.terminate();
      await new Promise<void>(resolve => hub.wss.close(() => resolve()));
      await new Promise<void>(resolve => server.close(() => resolve()));
    }
  });
  it('fails closed on errors and rechecks revocation without cached authority', async () => {
    const hub = new WsHub();
    let allowed = true;
    hub.authorize = async () => allowed;
    expect(await hub.isAuthorized({})).toBe(true);
    allowed = false;
    expect(await hub.isAuthorized({})).toBe(false);
    hub.authorize = async () => { throw new Error('identity unavailable'); };
    expect(await hub.isAuthorized({})).toBe(false);
  });
  it('preserves hosts which do not configure a policy', async () => {
    expect(await new WsHub().isAuthorized({})).toBe(true);
  });
});

it('scoped public sockets cannot receive broadcasts or invoke administrative handlers',async()=>{
 const server=http.createServer(),hub=new WsHub();hub.create(server,{authorize:()=>false});
 hub.registerChannel('game',(ws)=>{ws.on('message',()=>ws.send(JSON.stringify({type:'game-only'})));ws.send(JSON.stringify({type:'scoped-ready'}));});
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const client=new WebSocket(`ws://127.0.0.1:${(server.address() as any).port}/ws?channel=game&session=admin`);
 try{
  expect(JSON.parse((await once(client,'message'))[0].toString()).type).toBe('scoped-ready');
  let adminCalls=0;hub.onMessage('danger',()=>adminCalls++);const received:any[]=[];client.on('message',m=>received.push(JSON.parse(m.toString())));
  hub.broadcast({secret:true});expect(hub.pushToSession('admin',{secret:true})).toBe(0);
  const reply=once(client,'message');client.send(JSON.stringify({type:'danger'}));await reply;
  expect(adminCalls).toBe(0);expect(received).toEqual([{type:'game-only'}]);
 }finally{for(const ws of hub.wss.clients)ws.terminate();await new Promise<void>(r=>hub.wss.close(()=>r()));await new Promise<void>(r=>server.close(()=>r()));}
});
