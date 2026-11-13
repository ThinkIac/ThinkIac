'use strict';
// This process owns one process group. IPC loss always tears that group down.
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const { atomic, identity } = require('./common.cjs');
let child, stopping = false, timer, record, config, pendingLogs = 0;
function send(value) {
  if (!process.connected) return;
  if (value.op === 'log') {
    if (pendingLogs >= 8) return; // fixed memory bound when the daemon cannot drain output
    pendingLogs++;
    process.send(value, () => { pendingLogs--; });
  } else process.send(value, () => {});
}
function signal(value) { if (child?.pid) { try { process.kill(-child.pid, value); } catch (e) { if (e.code !== 'ESRCH') send({ op: 'diagnostic', error: e.message }); } } }
function finish(code, sig) {
  clearTimeout(timer);
  signal('SIGKILL'); // descendants must not survive even a clean leader exit
  send({ op: 'exit', code, signal: sig });
  if (record) { try { fs.unlinkSync(record); } catch {} }
  process.exit(0);
}
function stop() {
  if (stopping) return;
  stopping = true;
  if (!child) return finish(null, 'SIGTERM');
  signal('SIGTERM');
  timer = setTimeout(() => signal('SIGKILL'), config.policy.stopTimeoutMs);
}
process.on('disconnect', stop);
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
process.on('message', msg => {
  if (msg.op === 'stop') return stop();
  if (msg.op !== 'start' || config || stopping) return;
  config = msg.service; record = msg.record;
  atomic(record, { guardian: identity(process.pid) });
  child = spawn(config.command === 'node' ? process.execPath : config.command, config.args, {
    cwd: config.cwd, env: { ...process.env, ...config.env, LOGOS_SUPERVISOR_ROOT: msg.root, LOGOS_SUPERVISOR_SERVICE: msg.name },
    detached: true, stdio: ['ignore','pipe','pipe','ipc'],
  });
  child.once('spawn', () => {
    atomic(record, { guardian: identity(process.pid), child: identity(child.pid) });
    send({ op: 'spawn', pid: child.pid });
  });
  child.stdout.on('data', d => send({ op: 'log', stream: 'stdout', text: d.toString().slice(0, 32768) }));
  child.stderr.on('data', d => send({ op: 'log', stream: 'stderr', text: d.toString().slice(0, 32768) }));
  child.on('message', m => { if (m?.type === 'logos:ready' || m?.type === 'logos:heartbeat') send({ op: m.type }); });
  child.once('error', e => { send({ op: 'diagnostic', error: e.message }); finish(1, null); });
  child.once('exit', finish);
});
