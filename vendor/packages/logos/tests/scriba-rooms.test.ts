import { describe, it, expect } from 'vitest';
import { EventEmitter } from 'node:events';
import { ScribaRooms } from '../src';

class Socket extends EventEmitter {
  readyState = 1; bufferedAmount = 0; frames: any[] = [];
  send(raw: string) { this.frames.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.emit('close'); }
}
async function fixture() {
  const { default: Scriba } = await import('../../scriba/src/Scriba.js');
  const scriba = new Scriba();
  scriba.addTenant({ id: 'probe', path: ':memory:' });
  const store = scriba.documents('probe');
  const roles = new Map([['owner', 'owner'], ['editor', 'editor'], ['reader', 'reader']]);
  const rooms = new ScribaRooms({ store, scope: 'test', owner: 'probe', type: 'probe.state',
    resolveIdentity: async req => req.valid ? { principal: { type: 'user', subject: req.subject } } : null,
    authorize: (p, id, action) => {
      const role = id === 'main' && roles.get(p.subject);
      if (!role || (action === 'write' && role === 'reader')) throw new Error('FORBIDDEN');
      return { role };
    },
  });
  const req = (subject = 'owner') => ({ valid: true, subject, headers: { origin: 'https://example.test', host: 'example.test' } });
  const request = { action: 'patch', id: 'main', operationId: 'first', issuedAt: Date.now(), baseVersion: 0,
    patches: [{ op: 'set', path: [], value: { title: 'First', color: 'gray' } }] };
  return { rooms, store, roles, req, request };
}
describe('authenticated Scriba rooms', () => {
  it('authenticates the handshake and ignores claimed identity/session', async () => {
    const { rooms, req } = await fixture();
    for (const request of [req('outsider'), { ...req(), valid: false }, { ...req(), headers: { origin: 'https://evil.test', host: 'example.test' } }]) {
      const ws = new Socket();
      await rooms.handle(ws, request, { action: 'subscribe', id: 'main', subject: 'owner', session: 'owner' });
      expect(ws.frames.some(f => f.action === 'snapshot')).toBe(false);
      expect(ws.frames.at(-1).action).toBe('error');
    }
    rooms.dispose();
  });
  it('delivers durable changes only to members, rejects reader writes and deduplicates lost ACK retries', async () => {
    const { rooms, req, request, store } = await fixture();
    const owner = new Socket(), reader = new Socket();
    await rooms.handle(owner, req(), { action: 'subscribe', id: 'main' });
    await rooms.handle(reader, req('reader'), { action: 'subscribe', id: 'main' });
    await rooms.handle(owner, req(), request);
    await rooms.idle();
    expect(reader.frames.at(-1).snapshot.value.title).toBe('First');
    await rooms.handle(reader, req('reader'), { ...request, operationId: 'reader' });
    expect(reader.frames.at(-1).error).toBe('FORBIDDEN');
    await rooms.handle(owner, req(), request);
    expect(owner.frames.at(-1).snapshot.version).toBe(1);
    expect(store.get(['test', 'probe', 'probe.state', 'main']).version).toBe(1);
    rooms.dispose();
  });
  it('preserves independent patches and rejects overlapping writes', async () => {
    const { rooms, req, request } = await fixture();
    const ws = new Socket();
    await rooms.handle(ws, req(), { action: 'subscribe', id: 'main' });
    await rooms.handle(ws, req(), request);
    for (const [operationId, path, value] of [['a', 'title', 'A'], ['b', 'color', 'B'], ['c', 'title', 'C']]) {
      await rooms.handle(ws, req(), { ...request, operationId, baseVersion: 1, patches: [{ op: 'set', path: [path], value }] });
    }
    expect(ws.frames.at(-1).error).toBe('CONFLICT');
    expect(ws.frames.at(-1).snapshot.value).toEqual({ title: 'A', color: 'B' });
    rooms.dispose();
  });
  it('revalidates membership and expired sessions before delivery, reconnects with latest snapshot', async () => {
    const { rooms, roles, req, request } = await fixture();
    const owner = new Socket(), reader = new Socket();
    const readerReq = req('reader');
    await rooms.handle(owner, req(), { action: 'subscribe', id: 'main' });
    await rooms.handle(reader, readerReq, { action: 'subscribe', id: 'main' });
    readerReq.valid = false;
    await rooms.handle(owner, req(), request);
    await rooms.idle();
    expect(reader.frames.at(-1).action).toBe('revoked');
    expect(reader.frames.some(f => f.snapshot?.version === 1)).toBe(false);
    const reconnect = new Socket();
    await rooms.handle(reconnect, req(), { action: 'subscribe', id: 'main' });
    expect(reconnect.frames.at(-1).snapshot.version).toBe(1);
    roles.delete('owner');
    await rooms.sweep();
    expect(reconnect.frames.at(-1).action).toBe('revoked');
    rooms.dispose();
    expect(rooms.connectionCount).toBe(0);
  });
  it('limits slow clients and requires subscription before commit', async () => {
    const { rooms, req, request } = await fixture();
    const ws = new Socket();
    await rooms.handle(ws, req(), request);
    expect(ws.frames.at(-1).error).toBe('NOT_SUBSCRIBED');
    ws.bufferedAmount = 2 ** 22;
    await rooms.handle(ws, req(), { action: 'subscribe', id: 'main' });
    expect(ws.readyState).toBe(3);
    rooms.dispose();
  });
});

describe('opt-in presence',()=>{
 it('uses a separate channel, authenticated subject, and expires peers without storing cursors',async()=>{
  const {rooms:unused,store,req}=await fixture();unused.dispose();
  const rooms=new ScribaRooms({store,scope:'test',owner:'desktop',type:'desktop.layout',channel:'scriba:layout',presence:v=>v?.area==='work'?{area:'work'}:null,
   resolveIdentity:async r=>({principal:{type:'user',subject:r.subject}}),authorize:()=>({role:'reader'})});
  const a=new Socket(),b=new Socket();
  await rooms.handle(a,req('a'),{action:'subscribe',id:'main'});await rooms.handle(b,req('b'),{action:'subscribe',id:'main'});
  await rooms.handle(a,req('a'),{action:'presence',id:'main',value:{area:'work',subject:'forged'}});await rooms.idle();
  const frame=b.frames.at(-1);expect(frame.channel).toBe('scriba:layout');expect(frame.peers[0].subject).toBe('a');expect(frame.peers[0].value).toEqual({area:'work'});
  expect(store.get(['test','desktop','desktop.layout','main'])).toBeNull();
  a.close();await rooms.sweep();expect(b.frames.at(-1).peers).toEqual([]);rooms.dispose();
 });
});
