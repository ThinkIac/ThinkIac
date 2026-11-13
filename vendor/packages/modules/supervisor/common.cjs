'use strict';
const fs = require('node:fs');
const path = require('node:path');
const net = require('node:net');
const crypto = require('node:crypto');

function atomic(file, value) {
  const tmp = `${file}.${process.pid}.${crypto.randomUUID()}.tmp`;
  let fd;
  let renamed = false;
  try {
    fd = fs.openSync(tmp, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value));
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = undefined;
    fs.renameSync(tmp, file);
    renamed = true;
    const dir = fs.openSync(path.dirname(file), 'r');
    try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
  } finally {
    if (fd !== undefined) {
      try { fs.closeSync(fd); } catch { /* preserve the original failure */ }
    }
    if (!renamed) {
      try { fs.unlinkSync(tmp); } catch { /* preserve the original failure */ }
    }
  }
}
function read(file, fallback) {
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); }
  catch (e) { if (e.code === 'ENOENT') return fallback; throw new Error(`Invalid state ${file}: ${e.message}`); }
}
function paths(root) {
  root = fs.realpathSync(root);
  const dir = path.join(root, '.logos', 'supervisor');
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stat = fs.lstatSync(dir);
  if (!stat.isDirectory() || stat.uid !== process.getuid() || (stat.mode & 0o077)) throw new Error('Supervisor directory must be private and owned by this user');
  const socket = path.join(dir, 'control.sock');
  if (Buffer.byteLength(socket) > 103) throw new Error('Workspace path too long for supervisor socket');
  return { root, dir, socket, lock: path.join(dir, 'owner.lock'), state: path.join(dir, 'intent.json') };
}
function identity(pid) {
  try {
    const s = fs.readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = s.slice(s.lastIndexOf(')') + 2).split(' ');
    if (fields[0] === 'Z') return null;
    return { pid, birth: fields[19], boot: fs.readFileSync('/proc/sys/kernel/random/boot_id', 'utf8').trim() };
  } catch (e) { if (['ENOENT','ESRCH'].includes(e.code)) return null; throw e; }
}
function alive(id) { const now = id && identity(id.pid); return !!now && now.birth === id.birth && now.boot === id.boot; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function conflictingProcess(service) {
  if (service.command !== 'node' || !service.args.length) return null;
  const script = path.resolve(service.cwd, service.args[0]);
  for (const pid of fs.readdirSync('/proc').filter(p => /^\d+$/.test(p)).map(Number)) {
    if (pid === process.pid) continue;
    try {
      const cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
      const argv = fs.readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean);
      // PM2 changes argv[0] to its process title; compare that title too.
      if (cwd === service.cwd && (argv.some(arg => arg === script || arg === service.args[0]) || argv[0]?.includes(`(${script})`))) return pid;
    } catch (e) { if (!['ENOENT','ESRCH','EACCES'].includes(e.code)) throw e; }
  }
  return null;
}
function policy(raw = {}) {
  const p = { restart: 'always', maxRestarts: 10, windowMs: 60000, minUptimeMs: 30000, delayMs: 500, maxDelayMs: 30000, stopTimeoutMs: 10000, bootTimeoutMs: 120000, heartbeatMs: 0, ...raw };
  if (!['always','on-failure','never'].includes(p.restart)) throw new Error('Invalid restart policy');
  for (const k of Object.keys(p)) {
    if (k === 'restart') continue;
    if (!['maxRestarts','windowMs','minUptimeMs','delayMs','maxDelayMs','stopTimeoutMs','bootTimeoutMs','heartbeatMs'].includes(k)) throw new Error(`Unknown policy field: ${k}`);
    if (!Number.isSafeInteger(p[k]) || p[k] < 0 || p[k] > 2147483647) throw new Error(`Invalid policy: ${k}`);
  }
  if (!p.stopTimeoutMs || !p.bootTimeoutMs || !p.windowMs || p.maxDelayMs < p.delayMs) throw new Error('Invalid policy interval');
  return p;
}
function configuration(root) {
  const raw = read(path.join(root, 'logos.supervisor.json'));
  if (!raw || raw.version !== 1 || !raw.services || Array.isArray(raw.services) || typeof raw.services !== 'object') throw new Error('Expected logos.supervisor.json version 1 with services');
  const services = {};
  for (const [name, s] of Object.entries(raw.services)) {
    if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(name)) throw new Error(`Invalid service name: ${name}`);
    if (!s || typeof s.command !== 'string' || !s.command || !Array.isArray(s.args ?? []) || (s.args ?? []).some(a => typeof a !== 'string')) throw new Error(`Invalid command: ${name}`);
    if (s.ready !== undefined && !['ipc','process'].includes(s.ready)) throw new Error(`Invalid readiness: ${name}`);
    if (s.autostart !== undefined && typeof s.autostart !== 'boolean') throw new Error(`Invalid autostart: ${name}`);
    if (s.env && (typeof s.env !== 'object' || Object.entries(s.env).some(([k,v]) => !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k) || typeof v !== 'string'))) throw new Error(`Invalid environment: ${name}`);
    if (!Array.isArray(s.dependsOn ?? []) || (s.dependsOn ?? []).some(d => typeof d !== 'string')) throw new Error('Invalid dependencies');
    services[name] = { ...s, args: s.args ?? [], cwd: fs.realpathSync(path.resolve(root, s.cwd ?? '.')), ready: s.ready ?? 'process', policy: policy(s.policy), dependsOn: s.dependsOn ?? [] };
  }
  const order = [], visiting = new Set(), visited = new Set();
  function visit(name) {
    if (!services[name]) throw new Error(`Unknown dependency: ${name}`);
    if (visiting.has(name)) throw new Error(`Service dependency cycle: ${name}`);
    if (visited.has(name)) return;
    visiting.add(name); services[name].dependsOn.forEach(visit); visiting.delete(name); visited.add(name); order.push(name);
  }
  Object.keys(services).forEach(visit);
  return { services, order };
}
function request(root, command, target, extra = {}) {
  const p = paths(root);
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(p.socket);
    let buffer = '';
    socket.setTimeout(45000, () => socket.destroy(new Error('Supervisor request timed out')));
    socket.on('connect', () => socket.write(JSON.stringify({ version: 1, command, target, ...extra }) + '\n'));
    socket.on('error', reject);
    socket.on('data', data => {
      buffer += data;
      if (buffer.length > 2 * 1024 * 1024) return socket.destroy(new Error('Response too large'));
      if (!buffer.includes('\n')) return;
      socket.end();
      try { const result = JSON.parse(buffer.split('\n')[0]); if (!result.ok) reject(new Error(result.error)); else resolve(result.result); }
      catch (e) { reject(e); }
    });
    socket.on('end', () => { if (!buffer.includes('\n')) reject(new Error('Supervisor disconnected')); });
  });
}
async function waitForReady(root, target, timeoutMs = 120000) {
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 2147483647) throw new Error('Invalid readiness timeout');
  const deadline = Date.now() + timeoutMs;
  let last;
  while (Date.now() < deadline) {
    const snapshot = await request(root, 'status');
    const service = snapshot.services.find(item => item.name === target);
    if (!service) throw new Error(`Unknown service: ${target}`);
    last = service;
    if (service.state === 'running' && (service.health === 'ready' || service.health === 'unknown')) return service;
    if (service.state === 'failed' || service.state === 'blocked') throw new Error(service.error || `Service ${target} did not start`);
    await sleep(100);
  }
  throw new Error(`Service ${target} did not become ready within ${timeoutMs}ms${last?.error ? `: ${last.error}` : ''}`);
}
module.exports = { atomic, read, paths, identity, alive, sleep, policy, configuration, request, waitForReady, conflictingProcess };
