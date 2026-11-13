'use strict';

// Opt-in collaborative state transport. It is deliberately independent from
// the kernel: identity, authorization and persistence are supplied by its host.
class ScribaRooms {
  constructor(options) { this.options = options; this.connections = new Map(); this.disposed = false; this.sequence = 0; }
  get connectionCount() { return this.connections.size; }
  key(id) {
    if (typeof id !== 'string' || !id || id.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('INVALID_ADDRESS');
    return [this.options.scope, this.options.owner, this.options.type, id];
  }
  send(connection, frame) {
    if (connection.closed || connection.ws.readyState !== 1) return;
    if (connection.ws.bufferedAmount > 1048576) return this.close(connection);
    try { connection.ws.send(JSON.stringify({ channel: this.options.channel || 'scriba:state', ...frame })); } catch { this.close(connection); }
  }
  close(connection) { this.remove(connection); try { connection.ws.close(1008, 'Scriba connection ended'); } catch {} }
  remove(connection) {
    if (connection.closed) return;
    connection.closed = true; connection.presence.clear();
    for (const off of connection.rooms.values()) off && off();
    connection.rooms.clear(); connection.ws.off('close', connection.onClose); this.connections.delete(connection.ws);
  }
  enqueue(connection, task) {
    if (connection.closed) return Promise.resolve();
    if (++connection.pending > 32) { this.close(connection); return Promise.resolve(); }
    const run = connection.tail.then(async () => { if (!connection.closed) await task(); }).catch(() => this.close(connection)).finally(() => { connection.pending--; });
    connection.tail = run; return run;
  }
  async principal(connection) {
    let origin; try { origin = new URL(connection.req?.headers?.origin); } catch {}
    if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== connection.req?.headers?.host) throw new Error('ORIGIN_DENIED');
    const resolved = await this.options.resolveIdentity(connection.req); const principal = resolved?.principal;
    if (principal?.type !== 'user' || !principal.subject || (connection.subject && principal.subject !== connection.subject)) throw new Error('UNAUTHENTICATED');
    connection.subject = principal.subject; return principal;
  }
  revoke(connection, id) { connection.rooms.get(id)?.(); connection.rooms.delete(id); connection.presence.delete(id); this.send(connection, { action: 'revoked', id, error: 'ACCESS_REVOKED' }); }
  async deliver(connection, id) {
    if (!connection.rooms.has(id)) return;
    try { const principal = await this.principal(connection); if (connection.closed || !connection.rooms.has(id)) return; const { role } = this.options.authorize(principal, id, 'read'); this.send(connection, { action: 'snapshot', id, role, snapshot: this.options.store.get(this.key(id)) }); this.sendPresence(connection, id); }
    catch { this.revoke(connection, id); }
  }
  sendPresence(connection, id) {
    if (!this.options.presence) return;
    const peers = [];
    for (const peer of this.connections.values()) { const entry = peer.presence.get(id); if (peer !== connection && peer.rooms.has(id) && entry && Date.now() - entry.at < 10000) peers.push({ peerId: peer.peerId, subject: peer.subject, ...entry }); }
    this.send(connection, { action: 'presence', id, peers });
  }
  handle(ws, req, input) {
    if (this.disposed || ws.readyState !== 1) return Promise.resolve();
    let connection = this.connections.get(ws);
    if (!connection) { if (this.connections.size >= 256) { ws.close(1013, 'Scriba connection limit'); return Promise.resolve(); } connection = { ws, req, peerId: String(++this.sequence), presence: new Map(), rooms: new Map(), tail: Promise.resolve(), pending: 0, closed: false }; connection.onClose = () => this.remove(connection); ws.on('close', connection.onClose); this.connections.set(ws, connection); }
    return this.enqueue(connection, async () => {
      let id;
      try {
        if (!input || JSON.stringify(input).length > 65536) throw new Error('INVALID_FRAME');
        id = input.id; const key = this.key(id); const principal = await this.principal(connection); if (connection.closed) return; const { role } = this.options.authorize(principal, id, 'read');
        if (input.action === 'subscribe') { if (!connection.rooms.has(id)) { if (connection.rooms.size >= 8) throw new Error('ROOM_LIMIT'); connection.rooms.set(id, this.options.watch?.(principal, id, () => this.revoke(connection, id))); } this.send(connection, { action: 'snapshot', id, role, snapshot: this.options.store.get(key) }); }
        else if (input.action === 'presence' && this.options.presence) { if (!connection.rooms.has(id)) throw new Error('NOT_SUBSCRIBED'); const previous = connection.presence.get(id); if (previous && Date.now() - previous.at < 80) return; const value = this.options.presence(input.value); if (!value) throw new Error('INVALID_PRESENCE'); connection.presence.set(id, { at: Date.now(), value }); for (const peer of this.connections.values()) if (peer.rooms.has(id)) void this.enqueue(peer, async () => { try { const identity = await this.principal(peer); this.options.authorize(identity, id, 'read'); if (!peer.closed && peer.rooms.has(id)) this.sendPresence(peer, id); } catch { this.revoke(peer, id); } }); }
        else if (input.action === 'unsubscribe') { connection.rooms.get(id)?.(); connection.rooms.delete(id); connection.presence.delete(id); this.send(connection, { action: 'unsubscribed', id }); }
        else if (input.action === 'patch') { if (!connection.rooms.has(id)) throw new Error('NOT_SUBSCRIBED'); this.options.authorize(principal, id, 'write'); const { operationId, issuedAt, baseVersion, patches } = input; const snapshot = this.options.store.commit(key, { operationId, issuedAt, baseVersion, patches, author: principal.subject }, { validate: this.options.validate }); this.send(connection, { action: 'ack', id, operationId, snapshot, role }); for (const peer of this.connections.values()) if (peer !== connection && peer.rooms.has(id)) void this.enqueue(peer, () => this.deliver(peer, id)); }
        else throw new Error('INVALID_ACTION');
      } catch (error) {
        const code = error.message; const safe = /^(INVALID_[A-Z_]+|FORBIDDEN|UNAUTHENTICATED|ORIGIN_DENIED|NOT_SUBSCRIBED|ROOM_LIMIT|CONFLICT|RESYNC_REQUIRED|OPERATION_ID_REUSED|OPERATION_EXPIRED|SCHEMA_INVALID|MISSING_PARENT|ATOMIC_ARRAY)$/;
        const frame = { action: 'error', id: typeof id === 'string' ? id.slice(0, 256) : null, operationId: typeof input?.operationId === 'string' ? input.operationId.slice(0, 128) : null, error: safe.test(code) ? code : 'STATE_UNAVAILABLE' };
        if (['CONFLICT', 'RESYNC_REQUIRED'].includes(code)) frame.snapshot = this.options.store.get(this.key(id)); this.send(connection, frame);
        if (['UNAUTHENTICATED', 'ORIGIN_DENIED'].includes(code)) this.close(connection); else if (code === 'FORBIDDEN' && connection.rooms.has(id)) { try { this.options.authorize({ type: 'user', subject: connection.subject }, id, 'read'); } catch { this.revoke(connection, id); } }
      }
    });
  }
  async idle() { await Promise.all([...this.connections.values()].map(connection => connection.tail)); }
  async sweep() { await Promise.all([...this.connections.values()].map(connection => this.enqueue(connection, async () => { for (const id of [...connection.rooms.keys()]) await this.deliver(connection, id); }))); }
  dispose() { this.disposed = true; for (const connection of [...this.connections.values()]) this.close(connection); }
}
module.exports = { ScribaRooms };
