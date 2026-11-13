#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { paths, configuration, sleep, request } = require('./common.cjs');
const { Supervisor } = require('./index.cjs');
function rootFrom(start) {
  let root = path.resolve(start);
  while (!fs.existsSync(path.join(root, 'logos.supervisor.json'))) {
    const parent = path.dirname(root); if (root === parent) throw new Error('logos.supervisor.json not found'); root = parent;
  }
  return fs.realpathSync(root);
}
async function main(argv = process.argv.slice(2), context = {}) {
  const args = [...argv]; let root = context.root ?? process.cwd();
  const i = args.indexOf('--root');
  if (i !== -1) { if (!args[i + 1]) throw new Error('--root requires a path'); root = args[i + 1]; args.splice(i, 2); }
  const [command = 'help', target] = args;
  if (command === 'help' || command === '--help') { console.log('logos supervisor run|start|stop|restart|status|pid|logs|shutdown|validate|systemd [service] [--root workspace]'); return 0; }
  if (args.length > 2) throw new Error('Unexpected arguments');
  root = rootFrom(root);
  const p = paths(root);
  if (command === 'validate') { const c = configuration(root); console.log(JSON.stringify({ valid: true, services: c.order })); return 0; }
  if (command === 'systemd') {
    const q = value => '"' + value.replaceAll('%','%%').replaceAll('\\','\\\\').replaceAll('"','\\"').replaceAll('$','$$') + '"';
    console.log(`[Unit]\nDescription=Logos workspace supervisor\nAfter=network-online.target\nWants=network-online.target\n\n[Service]\nType=simple\nWorkingDirectory=${q(root)}\nExecStart=${q(process.execPath)} ${q(path.join(__dirname, 'systemd-entry.cjs'))} --root ${q(root)}\nRestart=on-failure\nRestartSec=2\nKillMode=control-group\nTimeoutStopSec=180\nUMask=0077\n\n[Install]\nWantedBy=multi-user.target`); return 0;
  }
  if (command === '--serve') {
    if (process.env.LOGOS_SUPERVISOR_LOCK !== p.lock) throw new Error('Use run to acquire the supervisor lock');
    const daemon = new Supervisor(root); await daemon.listen();
    const close = () => daemon.close().catch(e => { console.error(e.message); process.exitCode = 1; });
    process.once('SIGTERM', close); process.once('SIGINT', close); return 0;
  }
  if (command === 'run') {
    configuration(root);
    // flock holds an OS lock across exec, released on process death, no stale-PID guessing.
    const child = spawn('flock', ['--nonblock','--no-fork',p.lock,process.execPath,__filename,'--serve','--root',root], { stdio: 'inherit', env: { ...process.env, LOGOS_SUPERVISOR_LOCK: p.lock } });
    const term = () => child.kill('SIGTERM'), int = () => child.kill('SIGINT');
    process.once('SIGTERM', term); process.once('SIGINT', int);
    try { return await new Promise((resolve, reject) => { child.once('error', reject); child.once('exit', (code, signal) => resolve(code ?? (signal ? 1 : 0))); }); }
    finally { process.removeListener('SIGTERM', term); process.removeListener('SIGINT', int); }
  }
  if (command === 'pid') {
    const status = await request(root, 'status');
    const service = status.services.find(s => s.name === target);
    if (!service) throw new Error(`Unknown service: ${target}`);
    if (!service.pid) throw new Error(`Service not running: ${target}`);
    console.log(service.pid); return 0;
  }
  if (command === 'start') {
    configuration(root);
    try { await request(root, 'status'); }
    catch (e) {
      if (!['ENOENT','ECONNREFUSED'].includes(e.code)) throw e;
      const child = spawn(process.execPath, [__filename,'run','--root',root], { detached: true, stdio: 'ignore' }); child.unref();
      let connected = false;
      for (let n = 0; n < 400; n++) { await sleep(100); try { await request(root,'status'); connected = true; break; } catch (err) { if (!['ENOENT','ECONNREFUSED'].includes(err.code)) throw err; } }
      if (!connected) throw new Error('Supervisor did not start; run in foreground for diagnostics');
    }
  }
  const result = await request(root, command === 'start' && !target ? 'status' : command, target);
  console.log(typeof result === 'string' ? result : JSON.stringify(result, null, 2)); return 0;
}
module.exports = { main, rootFrom };
if (require.main === module) main().then(code => { process.exitCode = code; }, e => { console.error(`[supervisor] ${e.message}`); process.exitCode = 1; });
