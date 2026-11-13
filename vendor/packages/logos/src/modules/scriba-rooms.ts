// Generic, opt-in transport. The host owns identity, membership and schemas.
// No global broadcast and no browser-selected bus events.
export class ScribaRooms {
  private connections = new Map<any, any>();
  private options: any;
  private disposed = false;
  private sequence = 0;
  constructor(options: any) { this.options = options; }
  get connectionCount() { return this.connections.size; }
  private key(id: string) {
    if (typeof id !== 'string' || !id || id.length > 256 || ['__proto__', 'constructor', 'prototype'].includes(id)) throw new Error('INVALID_ADDRESS');
    return [this.options.scope, this.options.owner, this.options.type, id];
  }
  private send(connection: any, frame: any) {
    if (connection.closed || connection.ws.readyState !== 1) return;
    if (connection.ws.bufferedAmount > 1048576) { this.close(connection); return; }
    try { connection.ws.send(JSON.stringify({ channel: this.options.channel || 'scriba:state', ...frame })); }
    catch { this.close(connection); }
  }
  private close(connection: any) {
    this.remove(connection);
    try { connection.ws.close(1008, 'Scriba connection ended'); } catch {}
  }
  private remove(connection: any) {
    connection.closed = true;
    connection.presence.clear();
    for (const off of connection.rooms.values()) off?.();
    connection.rooms.clear();
    connection.ws.off('close', connection.onClose);
    this.connections.delete(connection.ws);
  }
  private enqueue(connection: any, task: () => any) {
    if (connection.closed) return Promise.resolve();
    if (++connection.pending > 32) { this.close(connection); return Promise.resolve(); }
    const run = connection.tail.then(async () => {
      if (!connection.closed) await task();
    }).catch(() => { this.close(connection); }).finally(() => { connection.pending--; });
    connection.tail = run;
    return run;
  }
  private async principal(connection: any) {
    const req = connection.req;
    let origin;
    try { origin = new URL(req?.headers?.origin); } catch {}
    if (!origin || !['http:', 'https:'].includes(origin.protocol) || origin.host !== req?.headers?.host) throw new Error('ORIGIN_DENIED');
    const resolved = await this.options.resolveIdentity(req);
    const principal = resolved?.principal;
    if (principal?.type !== 'user' || !principal.subject || (connection.subject && principal.subject !== connection.subject)) throw new Error('UNAUTHENTICATED');
    connection.subject = principal.subject;
    return principal;
  }
  private revoke(connection: any, id: string) {
    connection.rooms.get(id)?.();
    connection.rooms.delete(id);
    connection.presence.delete(id);
    this.send(connection, { action: 'revoked', id, error: 'ACCESS_REVOKED' });
  }
  private async deliver(connection: any, id: string) {
    if (!connection.rooms.has(id)) return;
    try {
      const principal = await this.principal(connection);
      if (connection.closed || !connection.rooms.has(id)) return;
      const { role } = this.options.authorize(principal, id, 'read');
      this.send(connection, { action: 'snapshot', id, role, snapshot: this.options.store.get(this.key(id)) });
      this.sendPresence(connection, id);
    } catch { this.revoke(connection, id); }
  }
  private sendPresence(connection: any, id: string) {
    if (!this.options.presence) return;
    const peers: any[] = [];
    for (const peer of this.connections.values()) {
      const entry = peer.presence.get(id);
      if (peer !== connection && peer.rooms.has(id) && entry && Date.now() - entry.at < 10000)
        peers.push({ peerId: peer.peerId, subject: peer.subject, ...entry });
    }
    this.send(connection, { action: 'presence', id, peers });
  }
  handle(ws: any, req: any, input: any): Promise<any> {
    if (this.disposed || ws.readyState !== 1) return Promise.resolve();
    let connection = this.connections.get(ws);
    if (!connection) {
      if (this.connections.size >= 256) { ws.close(1013, 'Scriba connection limit'); return Promise.resolve(); }
      connection = { ws, req, peerId: String(++this.sequence), presence: new Map(), rooms: new Map(), tail: Promise.resolve(), pending: 0, closed: false };
      connection.onClose = () => this.remove(connection);
      ws.on('close', connection.onClose);
      this.connections.set(ws, connection);
    }
    return this.enqueue(connection, async () => {
      let id;
      try {
        if (!input || JSON.stringify(input).length > 65536) throw new Error('INVALID_FRAME');
        id = input.id;
        const key = this.key(id);
        const principal = await this.principal(connection);
        if (connection.closed) return;
        const { role } = this.options.authorize(principal, id, 'read');
        if (input.action === 'subscribe') {
          if (!connection.rooms.has(id)) {
            if (connection.rooms.size >= 8) throw new Error('ROOM_LIMIT');
            const off = this.options.watch?.(principal, id, () => this.revoke(connection, id));
            connection.rooms.set(id, off);
          }
          // No await between subscription and snapshot: one atomic cut.
          this.send(connection, { action: 'snapshot', id, role, snapshot: this.options.store.get(key) });
        } else if (input.action === 'presence' && this.options.presence) {
          if (!connection.rooms.has(id)) throw new Error('NOT_SUBSCRIBED');
          const previous = connection.presence.get(id);
          if (previous && Date.now() - previous.at < 80) return;
          const value = this.options.presence(input.value);
          if (!value) throw new Error('INVALID_PRESENCE');
          connection.presence.set(id, { at: Date.now(), value });
          for (const peer of this.connections.values()) if (peer.rooms.has(id)) {
            void this.enqueue(peer, async () => {
              try {
                const identity = await this.principal(peer);
                this.options.authorize(identity, id, 'read');
                if (!peer.closed && peer.rooms.has(id)) this.sendPresence(peer, id);
              } catch { this.revoke(peer, id); }
            });
          }
        } else if (input.action === 'unsubscribe') {
          connection.rooms.get(id)?.(); connection.rooms.delete(id); connection.presence.delete(id);
          this.send(connection, { action: 'unsubscribed', id });
        } else if (input.action === 'patch') {
          if (!connection.rooms.has(id)) throw new Error('NOT_SUBSCRIBED');
          this.options.authorize(principal, id, 'write');
          const { operationId, issuedAt, baseVersion, patches } = input;
          const snapshot = this.options.store.commit(key, { operationId, issuedAt, baseVersion, patches, author: principal.subject },
            { validate: this.options.validate });
          this.send(connection, { action: 'ack', id, operationId, snapshot, role });
          for (const peer of this.connections.values()) if (peer !== connection && peer.rooms.has(id)) {
            void this.enqueue(peer, () => this.deliver(peer, id));
          }
        } else throw new Error('INVALID_ACTION');
      } catch (error: any) {
        const code = error.message;
        const safe = /^(INVALID_[A-Z_]+|FORBIDDEN|UNAUTHENTICATED|ORIGIN_DENIED|NOT_SUBSCRIBED|ROOM_LIMIT|CONFLICT|RESYNC_REQUIRED|OPERATION_ID_REUSED|OPERATION_EXPIRED|SCHEMA_INVALID|MISSING_PARENT|ATOMIC_ARRAY)$/;
        const frame: any = { action: 'error', id: typeof id === 'string' ? id.slice(0, 256) : null,
          operationId: typeof input?.operationId === 'string' ? input.operationId.slice(0, 128) : null,
          error: safe.test(code) ? code : 'STATE_UNAVAILABLE' };
        if (['CONFLICT', 'RESYNC_REQUIRED'].includes(code)) frame.snapshot = this.options.store.get(this.key(id));
        this.send(connection, frame);
        if (['UNAUTHENTICATED', 'ORIGIN_DENIED'].includes(code)) this.close(connection);
        else if (code === 'FORBIDDEN' && connection.rooms.has(id)) {
          // A reader's write denial does not revoke their read membership.
          try { this.options.authorize({ type: 'user', subject: connection.subject }, id, 'read'); }
          catch { this.revoke(connection, id); }
        }
      }
    });
  }
  async idle() { await Promise.all([...this.connections.values()].map(c => c.tail)); }
  async sweep() {
    await Promise.all([...this.connections.values()].map(c => this.enqueue(c, async () => {
      for (const id of [...c.rooms.keys()]) await this.deliver(c, id);
    })));
  }
  dispose() { this.disposed = true; for (const connection of [...this.connections.values()]) this.close(connection); }
}
