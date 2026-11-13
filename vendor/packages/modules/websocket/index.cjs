'use strict';

const { WebSocketServer } = require('ws');

const OPEN = 1;
const HEARTBEAT_MS = 30_000;

/**
 * Transport-agnostic WebSocket hub. Session identifiers are routing keys, not
 * credentials: hosts may install an asynchronous `authorize` policy.
 */
class WsHub {
  constructor() {
    this.channels = new Map();
    this.connections = new Map();
    this.messageHandlers = new Map();
    this.ownedHandlers = new Map();
    this.requests = new WeakMap();
    this.wss = null;
    this.authorize = undefined;
    this.heartbeatTimer = null;
  }

  registerChannel(name, connect) {
    this.channels.set(name, connect);
    return () => { if (this.channels.get(name) === connect) this.channels.delete(name); };
  }

  async isAuthorized(req) {
    try { return this.authorize ? (await this.authorize(req)) === true : true; }
    catch { return false; }
  }

  getRequest(ws) { return this.requests.get(ws); }

  create(httpServer, options = {}) {
    this.authorize = options.authorize;
    const path = options.path || '/ws';
    this.wss = new WebSocketServer({ server: httpServer, path });

    this.wss.on('connection', async (ws, req) => {
      const url = new URL(req.url, 'http://localhost');
      const channel = url.searchParams.get('channel');
      if (channel) {
        const connect = this.channels.get(channel);
        if (!connect) { ws.close(1008, 'Unknown channel'); return; }
        ws._scopedChannel = channel;
        ws.isAlive = true;
        ws.on('pong', () => { ws.isAlive = true; });
        try { connect(ws, req); } catch { ws.close(1008, 'Channel rejected'); }
        return;
      }

      if (!await this.isAuthorized(req)) { ws.close(1008, 'Unauthorized'); return; }
      if (ws.readyState !== OPEN) return;
      if (this.authorize) this.#guardSend(ws, req);
      this.requests.set(ws, req);

      const sessionId = url.searchParams.get('session') || 'default';
      if (!this.connections.has(sessionId)) this.connections.set(sessionId, new Set());
      this.connections.get(sessionId).add(ws);
      ws._sessionId = sessionId;
      ws.isAlive = true;
      ws.on('pong', () => { ws.isAlive = true; });
      ws.on('message', async raw => {
        if (!await this.isAuthorized(req)) { ws.close(1008, 'Access revoked'); return; }
        try {
          const msg = JSON.parse(raw.toString());
          ws.isAlive = true;
          const handlers = this.messageHandlers.get(msg.channel || msg.type);
          if (handlers) for (const handler of handlers) handler(msg, ws, sessionId);
        } catch { /* Non-JSON frames are intentionally ignored. */ }
      });
      ws.on('close', () => {
        const sockets = this.connections.get(sessionId);
        if (sockets) { sockets.delete(ws); if (!sockets.size) this.connections.delete(sessionId); }
      });
      ws.send(JSON.stringify({ type: 'connected', sessionId }));
    });
    this.startHeartbeat();
    this.wss.on('close', () => this.stopHeartbeat());
    return this.wss;
  }

  #guardSend(ws, req) {
    const send = ws.send.bind(ws);
    let queue = Promise.resolve();
    ws.send = (...args) => {
      queue = queue.then(async () => {
        if (!await this.isAuthorized(req)) { ws.close(1008, 'Access revoked'); return; }
        if (ws.readyState === OPEN) send(...args);
      }).catch(() => ws.close(1011, 'Authorization failed'));
    };
  }

  startHeartbeat() {
    if (this.heartbeatTimer) return;
    this.heartbeatTimer = setInterval(() => this.heartbeatSweep(), HEARTBEAT_MS);
    if (typeof this.heartbeatTimer.unref === 'function') this.heartbeatTimer.unref();
  }

  heartbeatSweep() {
    if (!this.wss) return;
    for (const ws of this.wss.clients) {
      if (ws.isAlive === false) { try { ws.terminate(); } catch {} continue; }
      ws.isAlive = false;
      try { ws.ping(); } catch {}
    }
  }

  stopHeartbeat() {
    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
  }

  onMessage(type, handler, options = {}) {
    if (!this.messageHandlers.has(type)) this.messageHandlers.set(type, new Set());
    this.messageHandlers.get(type).add(handler);
    if (options.owner) {
      if (!this.ownedHandlers.has(options.owner)) this.ownedHandlers.set(options.owner, []);
      this.ownedHandlers.get(options.owner).push({ type, handler });
    }
    let active = true;
    const off = () => {
      if (!active) return;
      active = false;
      const handlers = this.messageHandlers.get(type);
      handlers?.delete(handler);
      if (handlers && !handlers.size) this.messageHandlers.delete(type);
      if (options.owner) {
        const owned = this.ownedHandlers.get(options.owner);
        if (owned) {
          const remaining = owned.filter(item => item.type !== type || item.handler !== handler);
          if (remaining.length) this.ownedHandlers.set(options.owner, remaining);
          else this.ownedHandlers.delete(options.owner);
        }
      }
    };
    try { options.scope?.defer(off, { kind: 'stream-handler', label: type }); }
    catch (error) { off(); throw error; }
    return off;
  }

  offOwner(owner) {
    const owned = this.ownedHandlers.get(owner);
    if (!owned) return 0;
    for (const { type, handler } of owned) {
      const handlers = this.messageHandlers.get(type);
      if (!handlers) continue;
      handlers.delete(handler);
      if (!handlers.size) this.messageHandlers.delete(type);
    }
    this.ownedHandlers.delete(owner);
    return owned.length;
  }

  handlerCount(type) { return this.messageHandlers.get(type)?.size ?? 0; }

  pushToSession(sessionId, payload) {
    const sockets = this.connections.get(sessionId);
    if (!sockets) return 0;
    const message = JSON.stringify(payload);
    let sent = 0;
    for (const ws of sockets) if (ws.readyState === OPEN) { ws.send(message); sent++; }
    return sent;
  }

  broadcast(payload) {
    if (!this.wss) return;
    const message = JSON.stringify(payload);
    for (const ws of this.wss.clients) if (ws.readyState === OPEN && !ws._scopedChannel) ws.send(message);
  }

  isConnected(sessionId) { return (this.connections.get(sessionId)?.size ?? 0) > 0; }
}

module.exports = { WsHub, HEARTBEAT_MS };
