'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { request, waitForReady, sleep, identity, alive, configuration, policy, atomic } = require('../common.cjs');

test('atomic removes its temporary file when rename fails', t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-supervisor-atomic-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const destination = path.join(root, 'state.json');
  const renameSync = fs.renameSync;
  fs.renameSync = () => { throw new Error('simulated rename failure'); };
  try { assert.throws(() => atomic(destination, { version: 1 }), /simulated rename failure/); }
  finally { fs.renameSync = renameSync; }
  assert.deepEqual(fs.readdirSync(root), []);
});
const cli = path.resolve(__dirname, '../cli.cjs');
async function until(fn, timeout = 8000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const result = await fn(); if (result) return result; await sleep(25); }
  throw new Error('Condition timed out');
}
async function fixture(t, source, overrides = {}) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-sup-'));
  fs.writeFileSync(path.join(root,'fixture.cjs'),source);
  fs.writeFileSync(path.join(root,'logos.supervisor.json'), JSON.stringify({ version:1, services: { fixture: { command:'node', args:['fixture.cjs'], ready:'ipc', policy: { delayMs:30, maxDelayMs:100, stopTimeoutMs:100, bootTimeoutMs:1000, minUptimeMs:1000, ...overrides.policy }, ...Object.fromEntries(Object.entries(overrides).filter(([k]) => k !== 'policy')) } } }));
  const runs=[];
  async function start() {
    const proc=spawn(process.execPath,[cli,'run','--root',root],{stdio:['ignore','pipe','pipe']});
    let error=''; proc.stderr.on('data', d => error += d); runs.push(proc);
    await until(async()=> {try {return await request(root,'status');}catch(e){if(proc.exitCode !== null)throw new Error(error || `Daemon exit ${proc.exitCode}`);return false;}});
    return proc;
  }
  t.after(async()=>{
    try {await request(root,'shutdown');} catch {}
    await Promise.all(runs.map(p=>p.exitCode !== null ? null : new Promise(r=> {p.once('exit',r);setTimeout(()=>p.kill('SIGTERM'),200).unref();})));
    fs.rmSync(root,{recursive:true,force:true});
  });
  await start();
  return {root,start,status:async()=> (await request(root,'status')).services[0]};
}
const ready="process.send({type:'logos:ready'}); setInterval(()=>{},1000);";
test('real crash recovery and manual stop persisted across daemon restart', async t=>{
  const f=await fixture(t,ready);
  const first=await until(async()=>{const s=await f.status();return s.health==='ready' && s;});
  process.kill(first.pid,'SIGKILL');
  const second=await until(async()=>{const s=await f.status();return s.health==='ready'&&s.pid!==first.pid&&s;});
  assert.equal(second.restarts,1);
  await request(f.root,'stop','fixture');
  assert.equal((await f.status()).desired,'stopped');
  await request(f.root,'shutdown'); await sleep(250); await f.start();
  assert.equal((await f.status()).state,'stopped');
  await request(f.root,'start','fixture');
  await until(async()=> (await f.status()).health==='ready');
});
test('crash loop reaches restart budget', async t=>{
  const f=await fixture(t,"process.exit(3)",{policy:{maxRestarts:2}});
  const s=await until(async()=>{const s=await f.status();return s.state==='failed'&&s;});
  assert.equal(s.restarts,2); assert.equal(s.lastExit.code,3);
});
test('on-failure does not restart successful exit', async t=>{
  const f=await fixture(t,"process.exit(0)",{policy:{restart:'on-failure'}});
  await until(async()=> (await f.status()).lastExit);
  assert.equal((await f.status()).restarts,0);
});
test('boot timeout terminates a live process without readiness', async t=>{
  const f=await fixture(t,'setInterval(()=>{},1000)',{policy:{bootTimeoutMs:100,maxRestarts:0}});
  const s=await until(async()=>{const s=await f.status();return s.state==='failed'&&s;});
  assert.match(s.error,/timeout/); assert.equal(s.pid,null);
});
test('stop cancels backoff and escalates ignored SIGTERM', async t=>{
  const f=await fixture(t,"process.on('SIGTERM',()=>{});"+ready);
  const s=await until(async()=>{const s=await f.status();return s.health==='ready'&&s;});
  const id=identity(s.pid);
  await request(f.root,'stop','fixture'); assert.equal(alive(id),false);
  await request(f.root,'start','fixture');
  const next=await until(async()=>{const s=await f.status();return s.health==='ready'&&s;});
  process.kill(next.pid,'SIGKILL');
  await request(f.root,'stop','fixture'); await sleep(250);
  assert.equal((await f.status()).state,'stopped');
});
test('supervisor SIGKILL cleans orphan group and restores desired service', async t=>{
  const f=await fixture(t,ready);
  const s=await until(async()=>{const s=await f.status();return s.health==='ready'&&s;});
  const id=identity(s.pid), daemon=await request(f.root,'status');
  process.kill(daemon.pid,'SIGKILL');
  await until(()=>!alive(id));
  await f.start();
  const next=await until(async()=>{const s=await f.status();return s.health==='ready'&&s;});
  assert.notEqual(next.pid,s.pid);
});
test('OS lock rejects second supervisor and commands serialize', async t=>{
  const f=await fixture(t,ready);
  const pid=(await request(f.root,'status')).pid;
  const other=spawn(process.execPath,[cli,'run','--root',f.root],{stdio:'ignore'});
  assert.notEqual(await new Promise(r=>other.once('exit',r)),0);
  assert.equal((await request(f.root,'status')).pid,pid);
  await Promise.all([request(f.root,'restart','fixture'),request(f.root,'restart','fixture'),request(f.root,'stop','fixture')]);
  assert.equal((await f.status()).pid,null);
  assert.equal((await f.status()).desired,'stopped');
});
test('manual restart has a readiness receipt instead of only accepting the request', async t => {
  const f = await fixture(t, ready);
  const first = await waitForReady(f.root, 'fixture', 2000);
  await request(f.root, 'restart', 'fixture');
  const next = await waitForReady(f.root, 'fixture', 2000);
  assert.notEqual(next.pid, first.pid);
  assert.equal(next.health, 'ready');
});
test('bounded logs and private IPC', async t=>{
  const f=await fixture(t,"console.log('hello supervisor');"+ready);
  await until(async()=> (await f.status()).health==='ready');
  assert.match(await request(f.root,'logs','fixture'),/hello supervisor/);
  assert.equal(fs.statSync(path.join(f.root,'.logos/supervisor/control.sock')).mode & 0o777,0o600);
  await assert.rejects(request(f.root,'stop','../../anything'),/Unknown service/);
});
test('invalid policies and dependency cycles fail before spawn', ()=>{
  assert.throws(()=>policy({maxRestarts:-1})); assert.throws(()=>policy({restart:'sometimes'}));
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'logos-conf-'));
  try {
    fs.writeFileSync(path.join(root,'logos.supervisor.json'),JSON.stringify({version:1,services:{a:{command:'node',dependsOn:['b']},b:{command:'node',dependsOn:['a']}}}));
    assert.throws(()=>configuration(root),/cycle/);
  } finally {fs.rmSync(root,{recursive:true,force:true});}
});
test('heartbeat expiry recovers an unresponsive ready service', async t => {
  const f = await fixture(t, ready, { policy: { heartbeatMs: 100, maxRestarts: 0 } });
  const s = await until(async () => { const s = await f.status(); return s.state === 'failed' && s; });
  assert.match(s.error, /heartbeat/);
  assert.equal(s.pid, null);
});
test('manual stop terminates descendants in the owned process group', async t => {
  const f = await fixture(t, "const fs=require('node:fs'); const {spawn}=require('node:child_process'); const c=spawn(process.execPath,['-e','setInterval(()=>{},1000)']); fs.writeFileSync('descendant',String(c.pid));" + ready);
  await until(async () => (await f.status()).health === 'ready');
  const descendant = identity(Number(fs.readFileSync(path.join(f.root, 'descendant'), 'utf8')));
  assert.ok(descendant);
  await request(f.root, 'stop', 'fixture');
  await until(() => !alive(descendant));
});
test('service remains blocked when its dependency has persisted stopped intent', async t => {
  const f = await fixture(t, ready);
  await request(f.root, 'stop', 'fixture');
  await request(f.root, 'shutdown'); await sleep(250);
  const file = path.join(f.root, 'logos.supervisor.json');
  const config = JSON.parse(fs.readFileSync(file));
  config.services.dependent = { ...config.services.fixture, dependsOn: ['fixture'] };
  fs.writeFileSync(file, JSON.stringify(config));
  await f.start();
  const status = await request(f.root, 'status');
  assert.equal(status.services.find(s => s.name === 'dependent').state, 'blocked');
  assert.equal(status.services.find(s => s.name === 'dependent').pid, null);
});
