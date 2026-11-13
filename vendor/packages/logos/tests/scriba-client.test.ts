import { describe, it, expect, vi, afterEach } from 'vitest';
import { createScribaClient } from '../src/modules/views/scriba-client.js';
class Socket {
  static all: Socket[] = [];
  readyState = 1; sent: any[] = []; onopen: any; onmessage: any; onclose: any; onerror: any;
  constructor(url: string) { Socket.all.push(this); }
  send(raw: string) { this.sent.push(JSON.parse(raw)); }
  close() { this.readyState = 3; this.onclose?.(); }
  receive(frame: any) { this.onmessage({ data: JSON.stringify({ channel: 'scriba:state', id: 'main', ...frame }) }); }
}
afterEach(() => { vi.useRealTimers(); Socket.all = []; });
describe('Scriba acceptance client', () => {
  it('retries the exact unacknowledged operation after reconnect and never rolls a snapshot back', async () => {
    vi.useFakeTimers();
    const client = createScribaClient({ url: 'ws://test', id: 'main', WebSocket: Socket as any });
    const first = Socket.all.at(-1)!; first.onopen();
    first.receive({ action: 'snapshot', role: 'owner', snapshot: { version: 1, value: { title: 'A' } } });
    client.patch([{ op: 'set', path: ['title'], value: 'B' }]);
    const operation = first.sent.at(-1);
    first.close();
    expect(() => client.patch([])).toThrow('STATE_OFFLINE');
    await vi.advanceTimersByTimeAsync(1000);
    const second = Socket.all.at(-1)!; second.onopen();
    second.receive({ action: 'snapshot', role: 'owner', snapshot: { version: 3, value: { title: 'C' } } });
    expect(second.sent.at(-1)).toEqual(operation);
    second.receive({ action: 'ack', operationId: operation.operationId, snapshot: { version: 2, value: { title: 'B' } } });
    expect(client.state.snapshot.version).toBe(3);
    expect(client.state.pending).toBe(false);
    client.destroy();
  });
  it('clears sensitive state on revocation and prevents reader writes', () => {
    const client = createScribaClient({ url: 'ws://test', id: 'main', WebSocket: Socket as any });
    const socket = Socket.all.at(-1)!; socket.onopen();
    socket.receive({ action: 'snapshot', role: 'reader', snapshot: { version: 1, value: { title: 'A' } } });
    expect(() => client.patch([])).toThrow('FORBIDDEN');
    socket.receive({ action: 'revoked', error: 'ACCESS_REVOKED' });
    expect(client.state.snapshot).toBeNull();
    expect(client.state.status).toBe('denied');
    expect(socket.readyState).toBe(3);
    client.destroy();
  });
  it('surfaces conflict with current snapshot and stops retrying a rejected operation', () => {
    const client = createScribaClient({ url: 'ws://test', id: 'main', WebSocket: Socket as any });
    const socket = Socket.all.at(-1)!; socket.onopen();
    socket.receive({ action: 'snapshot', role: 'owner', snapshot: { version: 1, value: { title: 'A' } } });
    client.patch([{ op: 'set', path: ['title'], value: 'B' }]);
    socket.receive({ action: 'error', error: 'CONFLICT', operationId: socket.sent.at(-1).operationId,
      snapshot: { version: 2, value: { title: 'Remote' } } });
    expect(client.state.pending).toBe(false);
    expect(client.state.error).toBe('CONFLICT');
    expect(client.state.snapshot.value.title).toBe('Remote');
    client.destroy();
  });
});
