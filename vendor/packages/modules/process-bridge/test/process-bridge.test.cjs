'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { ProcessBridge } = require('..');

function bridge(program, options = {}) {
  return new ProcessBridge({ name: 'fixture', runtime: 'node', main: '-e', cwd: process.cwd(), timeoutMs: 80, ...options,
    spawn: (command, args, spawnOptions) => require('node:child_process').spawn(command, [...args, program], spawnOptions) });
}

test('forwards JSONL events and resolves their correlated result', async t => {
  const subject = bridge("require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);process.stdout.write(JSON.stringify({op:'result',id:x.id,payload:{event:x.event,value:x.payload.value}})+'\\n')})");
  t.after(() => subject.stop());
  assert.equal(subject.start(), true);
  assert.deepEqual(await subject.call('python:echo', { value: 7 }), { event: 'python:echo', value: 7 });
});

test('routes process registration and emitted events to the host', async t => {
  const registrations = []; const emitted = [];
  let ready; let emittedReady;
  const registered = new Promise(resolve => { ready = resolve; });
  const emittedEvent = new Promise(resolve => { emittedReady = resolve; });
  const subject = bridge("process.stdout.write(JSON.stringify({op:'register',events:['python:*']})+'\\n');process.stdout.write(JSON.stringify({op:'emit',event:'python:ready',payload:{ok:true}})+'\\n');setInterval(()=>{},1000)", {
    onRegister: events => { registrations.push(events); ready(); }, onEmit: (event, payload) => { emitted.push({ event, payload }); emittedReady(); },
  });
  t.after(() => subject.stop()); subject.start();
  await Promise.all([registered, emittedEvent]);
  assert.deepEqual(registrations, [['python:*']]);
  assert.deepEqual(emitted, [{ event: 'python:ready', payload: { ok: true } }]);
});

test('rejects an unanswered call at its configured timeout', async t => {
  const subject = bridge("require('node:readline').createInterface({input:process.stdin}).on('line',()=>{})");
  t.after(() => subject.stop()); subject.start();
  await assert.rejects(subject.call('python:slow', {}), /timed out/);
});

test('propagates a process error and rejects calls after stop', async t => {
  const subject = bridge("require('node:readline').createInterface({input:process.stdin}).on('line',line=>{const x=JSON.parse(line);process.stdout.write(JSON.stringify({op:'error',id:x.id,message:'denied'})+'\\n')})", { timeoutMs: 500 });
  t.after(() => subject.stop());
  subject.start();
  await assert.rejects(subject.call('python:protected', {}), /denied/);
  subject.stop();
  await assert.rejects(subject.call('python:protected', {}), /not running/);
});

test('fails closed for unsupported runtimes without spawning', () => {
  let spawned = false;
  const subject = new ProcessBridge({ name: 'fixture', runtime: 'unknown', main: 'main', spawn: () => { spawned = true; } });
  assert.equal(subject.start(), false);
  assert.equal(spawned, false);
});
