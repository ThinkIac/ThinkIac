'use strict';

const { spawn: defaultSpawn } = require('node:child_process');
const readline = require('node:readline');

const RUNTIME_BIN = Object.freeze({
  python: ['python3'], python3: ['python3'], node: ['node'],
  deno: ['deno', 'run', '--allow-all'], ruby: ['ruby'], bun: ['bun'], rust: [],
});
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_BACKOFF_MS = 500;
const MAX_BACKOFF_MS = 30_000;

/** A newline-delimited JSON bridge to a process owned by a package host. */
class ProcessBridge {
  constructor(options = {}) {
    if (!options.name || !options.runtime || !options.main) throw new TypeError('name, runtime and main are required');
    this.name = options.name;
    this.runtime = options.runtime;
    this.main = options.main;
    this.cwd = options.cwd || process.cwd();
    this.timeoutMs = options.timeoutMs || DEFAULT_TIMEOUT_MS;
    this.spawn = options.spawn || defaultSpawn;
    this.onRegister = options.onRegister || (() => {});
    this.onEmit = options.onEmit || (() => {});
    this.onLog = options.onLog || (() => {});
    this.onError = options.onError || (() => {});
    this.onExit = options.onExit;
    this.child = null;
    this.pending = new Map();
    this.nextId = 1;
    this.backoff = DEFAULT_BACKOFF_MS;
    this.stopped = false;
    this.restartTimer = null;
  }

  get pid() { return this.child?.pid; }

  start() {
    if (this.stopped) return false;
    const bin = RUNTIME_BIN[this.runtime];
    if (!bin) { this.onError(new Error(`unsupported runtime "${this.runtime}"`)); return false; }
    const [command, ...baseArgs] = bin;
    const executable = this.runtime === 'rust' ? this.main : command;
    const args = this.runtime === 'rust' ? baseArgs : [...baseArgs, this.main];
    try { this.child = this.spawn(executable, args, { cwd: this.cwd, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch (error) { this.onError(error); this.scheduleRestart({ code: null, signal: null }); return false; }
    const child = this.child;
    if (child.stdout) readline.createInterface({ input: child.stdout }).on('line', line => this.onLine(line));
    child.stderr?.on('data', data => this.onLog(String(data), 'stderr'));
    child.on('error', error => this.onError(error));
    child.on('close', (code, signal) => {
      if (this.child !== child) return;
      this.child = null;
      this.rejectAll(`process exited with code ${code}`);
      if (!this.stopped) this.scheduleRestart({ code, signal });
    });
    this.onLog(`started (${this.runtime} ${this.main}, pid ${child.pid})`, 'lifecycle');
    return true;
  }

  scheduleRestart(exit) {
    let handled = false;
    try { handled = this.onExit?.(exit) === true; } catch (error) { this.onError(error); }
    if (handled || this.stopped) return;
    const wait = this.backoff;
    this.backoff = Math.min(this.backoff * 2, MAX_BACKOFF_MS);
    this.onLog(`exited (${exit.code}) — restarting in ${wait}ms`, 'lifecycle');
    this.restartTimer = setTimeout(() => { this.restartTimer = null; this.start(); }, wait);
    this.restartTimer.unref?.();
  }

  onLine(line) {
    let message;
    try { message = JSON.parse(line); } catch { return; }
    switch (message.op) {
      case 'result': {
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); pending.resolve(message.payload); }
        this.backoff = DEFAULT_BACKOFF_MS;
        break;
      }
      case 'error': {
        const pending = this.pending.get(message.id);
        if (pending) { clearTimeout(pending.timer); this.pending.delete(message.id); pending.reject(new Error(message.message || 'process error')); }
        break;
      }
      case 'register': this.onRegister(Array.isArray(message.events) ? message.events : []); break;
      case 'emit': this.onEmit(message.event, message.payload); break;
      case 'log': this.onLog(String(message.message || ''), 'process'); break;
    }
  }

  call(event, payload) {
    if (!this.child?.stdin?.writable) return Promise.reject(new Error(`[proc] module "${this.name}" is not running`));
    const id = String(this.nextId++);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`[proc] "${this.name}" timed out on "${event}" (${this.timeoutMs}ms)`));
      }, this.timeoutMs);
      this.pending.set(id, { resolve, reject, timer });
      try { this.child.stdin.write(`${JSON.stringify({ op: 'event', id, event, payload })}\n`); }
      catch (error) { clearTimeout(timer); this.pending.delete(id); reject(error); }
    });
  }

  rejectAll(reason) {
    for (const pending of this.pending.values()) { clearTimeout(pending.timer); pending.reject(new Error(`[proc] ${this.name}: ${reason}`)); }
    this.pending.clear();
  }

  stop() {
    this.stopped = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = null;
    this.rejectAll('bridge stopped');
    this.child?.kill();
    this.child = null;
  }
}

module.exports = { ProcessBridge, RUNTIME_BIN, DEFAULT_TIMEOUT_MS, DEFAULT_BACKOFF_MS, MAX_BACKOFF_MS };
