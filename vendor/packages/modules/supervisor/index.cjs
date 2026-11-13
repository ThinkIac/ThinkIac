'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const { fork } = require('node:child_process');
const { atomic, read, paths, configuration, identity, alive, sleep, request, conflictingProcess } = require('./common.cjs');

function memory(pid) {
  if (!pid) return null;
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, 'utf8');
    const rss = status.match(/^VmRSS:\s+(\d+) kB/m);
    return rss ? { rssBytes: Number(rss[1]) * 1024 } : null;
  } catch { return null; }
}

class Supervisor {
  constructor(root) {
    this.paths = paths(root);
    this.config = configuration(this.paths.root);
    this.intent = read(this.paths.state, { version: 1, services: {} });
    if (this.intent?.version !== 1 || !this.intent.services || Object.values(this.intent.services).some(v => !['running','stopped'].includes(v))) throw new Error('Invalid supervisor intent; restore a valid snapshot before starting');
    this.states = new Map();
    this.closing = false;
    this.queue = Promise.resolve();
    this.sockets = new Set();
    for (const name of this.config.order) {
      this.intent.services[name] ??= this.config.services[name].autostart === false ? 'stopped' : 'running';
      this.states.set(name, { name, state: 'stopped', health: 'unknown', generation: 0, restarts: 0, failures: [], pid: null, startedAt: null, lastExit: null, error: null });
    }
  }
  persist() { atomic(this.paths.state, this.intent); }
  serialize(fn) { const next = this.queue.catch(() => {}).then(fn); this.queue = next; return next; }
  snapshot() {
    return { version: 1, pid: process.pid, root: this.paths.root, services: [...this.states.values()].map(s => ({
      name: s.name, desired: this.intent.services[s.name], state: s.state, health: s.health, pid: s.pid,
      generation: s.generation, restarts: s.restarts, startedAt: s.startedAt, lastExit: s.lastExit, error: s.error, logError: s.logError ?? null,
      memory: memory(s.pid), uptimeMs: s.pid ? Date.now() - s.startedAt : 0,
    })) };
  }
  log(name, text) {
    const file = path.join(this.paths.dir, `${name}.log`);
    try {
      // Three files, at most 1 MiB each, without an unbounded write queue.
      const chunk = Buffer.from(text).subarray(0, 32768);
      if ((fs.existsSync(file) ? fs.statSync(file).size : 0) + chunk.length > 1024 * 1024) {
        for (let i = 2; i >= 1; i--) {
          const src = i === 1 ? file : `${file}.${i - 1}`;
          if (fs.existsSync(src)) fs.renameSync(src, `${file}.${i}`);
        }
      }
      fs.appendFileSync(file, chunk, { mode: 0o600 });
    } catch (e) { this.states.get(name).logError = e.code ?? e.message; }
  }
  event(s, event, detail = {}) { this.log(s.name, JSON.stringify({ version: 1, at: new Date().toISOString(), event, name: s.name, generation: s.generation, ...detail }) + '\n'); }
  async recoverOrphans() {
    for (const file of fs.readdirSync(this.paths.dir).filter(f => f.endsWith('.owner.json'))) {
      const record = path.join(this.paths.dir, file), owner = read(record);
      if (alive(owner.guardian)) {
        process.kill(owner.guardian.pid, 'SIGTERM');
        const deadline = Date.now() + 35000;
        while (alive(owner.guardian) && Date.now() < deadline) await sleep(25);
        if (alive(owner.guardian)) throw new Error(`Previous guardian did not stop: ${file}`);
      }
      // Birth time + boot ID prevent signaling a recycled PID.
      if (alive(owner.child)) {
        process.kill(-owner.child.pid, 'SIGKILL');
        for (let i = 0; i < 100 && alive(owner.child); i++) await sleep(20);
        if (alive(owner.child)) throw new Error(`Previous service did not stop: ${file}`);
      }
      try { fs.unlinkSync(record); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    }
  }
  async listen() {
    // Caller must hold the OS flock for the entire daemon lifetime.
    await this.recoverOrphans();
    this.persist();
    try { fs.unlinkSync(this.paths.socket); } catch (e) { if (e.code !== 'ENOENT') throw e; }
    this.server = net.createServer(socket => {
      this.sockets.add(socket); socket.once('close', () => this.sockets.delete(socket));
      socket.on('error', () => {});
      socket.setTimeout(5000, () => socket.destroy());
      let data = '', handled = false;
      socket.on('data', bytes => {
        if (handled) return;
        data += bytes;
        if (data.length > 8192) return socket.destroy();
        if (!data.includes('\n')) return;
        handled = true; socket.setTimeout(60000, () => socket.destroy());
        let msg;
        try { msg = JSON.parse(data.split('\n')[0]); } catch { return socket.end('{"ok":false,"error":"Invalid JSON"}\n'); }
        this.serialize(() => this.command(msg)).then(result => socket.end(JSON.stringify({ ok: true, result }) + '\n'), e => socket.end(JSON.stringify({ ok: false, error: e.message }) + '\n'));
      });
    });
    await new Promise((resolve, reject) => { this.server.once('error', reject); this.server.listen(this.paths.socket, resolve); });
    fs.chmodSync(this.paths.socket, 0o600);
    for (const name of this.config.order) this.launch(name);
  }
  launch(name) {
    const s = this.states.get(name), service = this.config.services[name];
    if (this.closing || s.child || s.timer || this.intent.services[name] !== 'running') return;
    const blocked = service.dependsOn.find(d => this.states.get(d).state !== 'running');
    if (blocked) { s.state = 'blocked'; s.error = `Dependency not running: ${blocked}`; return; }
    const conflict = conflictingProcess(service);
    if (conflict) { s.state = 'failed'; s.error = `Service already running outside this supervisor (PID ${conflict}); migrate its owner first`; return; }
    const generation = ++s.generation;
    s.state = 'starting'; s.health = 'unknown'; s.error = null; s.startedAt = Date.now(); s.lastHeartbeat = Date.now();
    const child = fork(path.join(__dirname, 'guardian.cjs'), [], { stdio: ['ignore','ignore','ignore','ipc'], execArgv: [] });
    s.child = child;
    this.event(s, 'starting');
    let result = { code: 1, signal: null };
    child.on('message', msg => {
      if (s.generation !== generation || s.child !== child) return;
      if (msg.op === 'spawn') { s.pid = msg.pid; if (service.ready === 'process') this.ready(s, false); }
      if (msg.op === 'logos:ready') this.ready(s, true);
      if (msg.op === 'logos:heartbeat') s.lastHeartbeat = Date.now();
      if (msg.op === 'diagnostic') s.error = msg.error;
      if (msg.op === 'log') this.log(name, msg.text);
      if (msg.op === 'exit') result = { code: msg.code, signal: msg.signal };
    });
    child.once('error', e => { s.error = e.message; });
    s.done = new Promise(resolve => child.once('exit', () => {
      if (s.child === child) {
        clearInterval(s.monitor); s.child = null; s.pid = null; s.health = 'unknown';
        s.lastExit = { ...result, at: Date.now(), cause: s.stopCause ?? 'exit' };
        this.event(s, 'exit', s.lastExit);
        s.state = 'stopped';
        if (!s.stopCause && !this.closing && this.intent.services[name] === 'running') this.retry(s, result.code !== 0 || !!result.signal);
        s.stopCause = null;
      }
      resolve();
    }));
    child.send({ op: 'start', root: this.paths.root, name, service, record: path.join(this.paths.dir, `${name}.owner.json`) }, e => { if (e) s.error = e.message; });
    s.monitor = setInterval(() => {
      if (s.child !== child || s.stopCause) return;
      const now = Date.now(), p = service.policy;
      if ((s.state === 'starting' && now - s.startedAt > p.bootTimeoutMs) || (s.health === 'ready' && p.heartbeatMs && now - s.lastHeartbeat > p.heartbeatMs)) {
        s.health = 'unhealthy'; s.error = 'Readiness/heartbeat timeout'; child.send({ op: 'stop' }, () => {});
      }
    }, 100);
  }
  ready(s, verified) {
    if (s.state !== 'starting') return;
    s.state = 'running'; s.health = verified ? 'ready' : 'unknown'; s.lastHeartbeat = Date.now();
    this.event(s, 'running', { health: s.health });
    for (const name of this.config.order) if (this.states.get(name).state === 'blocked') this.launch(name);
  }
  retry(s, failed) {
    const p = this.config.services[s.name].policy, now = Date.now();
    if (p.restart === 'never' || (p.restart === 'on-failure' && !failed && !s.error)) return;
    s.failures = now - s.startedAt >= p.minUptimeMs && !s.error ? [] : s.failures.filter(t => now - t < p.windowMs);
    if (s.failures.length >= p.maxRestarts) { s.state = 'failed'; s.error ??= 'Restart limit reached'; this.event(s, 'failed'); return; }
    s.failures.push(now); s.restarts++;
    const delay = Math.min(p.maxDelayMs, p.delayMs * 2 ** Math.min(s.failures.length - 1, 30));
    s.state = 'backoff'; this.event(s, 'backoff', { delayMs: delay });
    s.timer = setTimeout(() => { s.timer = null; this.launch(s.name); }, delay);
  }
  async halt(name, cause) {
    const s = this.states.get(name);
    clearTimeout(s.timer); s.timer = null;
    if (!s.child) { s.state = 'stopped'; return; }
    s.stopCause = cause; s.state = 'stopping';
    s.child.send({ op: 'stop' }, () => {});
    await s.done;
  }
  async command(msg) {
    if (msg.version !== 1) throw new Error('Unsupported protocol version');
    const { command, target } = msg;
    if (command === 'status') return this.snapshot();
    if (this.closing) throw new Error('Supervisor is shutting down');
    if (command === 'shutdown') { setImmediate(() => this.close()); return { shuttingDown: true }; }
    if (!this.states.has(target)) throw new Error(`Unknown service: ${target}`);
    if (command === 'logs') {
      const file = path.join(this.paths.dir, `${target}.log`);
      if (!fs.existsSync(file)) return '';
      const fd = fs.openSync(file, 'r');
      try { const size = fs.fstatSync(fd).size, b = Buffer.alloc(Math.min(size, 65536)); fs.readSync(fd, b, 0, b.length, size - b.length); return b.toString(); }
      finally { fs.closeSync(fd); }
    }
    if (!['start','stop','restart'].includes(command)) throw new Error(`Unknown command: ${command}`);
    const s = this.states.get(target);
    if (command === 'stop') {
      const dependents = this.config.order.filter(n => this.config.services[n].dependsOn.includes(target) && this.intent.services[n] === 'running');
      if (dependents.length) throw new Error(`Stop dependents first: ${dependents.join(', ')}`);
    }
    const next = { ...this.intent, services: { ...this.intent.services, [target]: command === 'stop' ? 'stopped' : 'running' } };
    atomic(this.paths.state, next); this.intent = next;
    if (command !== 'start') await this.halt(target, command);
    if (command !== 'stop') { s.failures = []; clearTimeout(s.timer); s.timer = null; this.launch(target); }
    return this.snapshot();
  }
  async close() {
    if (this.closing) return this.closed;
    this.closing = true;
    this.closed = this.serialize(async () => {
      for (const name of [...this.config.order].reverse()) await this.halt(name, 'supervisor-shutdown');
      for (const socket of this.sockets) socket.destroy();
      await new Promise(r => this.server.close(r));
    });
    return this.closed;
  }
}
module.exports = { Supervisor, request };
