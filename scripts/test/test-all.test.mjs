import test from 'node:test';
import assert from 'node:assert/strict';
import { runSuites } from '../test-all.mjs';
const suite = (name, code, extra = {}) => ({ name, cwd: process.cwd(), command: process.execPath, args: ['-e', code], timeoutMs: 3000, ...extra });
const quiet = () => {};
test('success and failure continue through every suite', async () => {
  const result = await runSuites([suite('ok', ''), suite('bad', 'process.exit(2)'), suite('last', '')], { log: quiet, stdio: 'ignore' });
  assert.deepEqual(result.map(r => r.status), ['PASS', 'FAIL', 'PASS']);
});
test('missing executable and directory fail explicitly', async () => {
  for (const extra of [{ command: '/missing/test-command' }, { cwd: '/missing/test-directory' }]) {
    const [r] = await runSuites([suite('missing', '', extra)], { log: quiet, stdio: 'ignore' });
    assert.equal(r.status, 'FAIL');
  }
});
test('empty selection and missing required files fail', async () => {
  await assert.rejects(runSuites([], { log: quiet }), /empty/i);
  const [r] = await runSuites([suite('missing file', '', { files: ['/missing/test.js'] })], { log: quiet });
  assert.equal(r.status, 'FAIL');
});
test('timeout kills a process that ignores SIGTERM', async () => {
  const [r] = await runSuites([suite('timeout', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)", { timeoutMs: 200 })], { log: quiet, stdio: 'ignore' });
  assert.equal(r.status, 'TIMEOUT');
});
test('abort stops active child and prevents subsequent suites', async () => {
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 150);
  const results = await runSuites([suite('active', 'setInterval(()=>{},1000)'), suite('next', '')], { log: quiet, stdio: 'ignore', signal: controller.signal });
  assert.deepEqual(results.map(r => r.status), ['INTERRUPTED']);
});
test('manifest includes mandatory domains and configuration regression', async () => {
  const { loadSuites } = await import('../test-all.mjs');
  const suites = loadSuites();
  for (const name of ['logos', 'auth', 'agent', 'governance', 'pkgmgr', 'process-manager', 'terminal', 'cloud', 'reboot']) {
    assert.ok(suites.some(s => s.name.split(':')[0] === name), name);
  }
  assert.ok(suites.find(s => s.name === 'agent:node').files.includes('utils/config.test.js'));
  for (const s of suites) { assert.ok(s.command, `${s.name}: ${s.error}`); assert.ok(s.files.length); }
});
