'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createRuntimeModule } = require('../runtime.cjs');
const { sleep } = require('../common.cjs');
function setup(t, restart = 'on-failure') {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-adapter-'));
  const states = new Map();
  const pkg = { folder: 'worker', name: 'worker', runtime: { supervision: { restart, delayMs: 10 } } };
  const container = { workspace, state(name) { if (!states.has(name)) states.set(name, new Map()); return states.get(name); },
    registry: { getPackage: () => pkg, discover: () => [pkg], getState: () => ({ state: 'active' }) },
    bus: { on() {} } };
  createRuntimeModule().install(container);
  const controller = container.state('supervisor').get('controller');
  t.after(() => { controller.close(); fs.rmSync(workspace, { recursive: true, force: true }); });
  return { controller, workspace };
}
test('proc on-failure respects successful exit and manual stop cancels recovery', async t => {
  const { controller } = setup(t);
  let starts = 0;
  const recover = async () => { starts++; return { health: 'unknown' }; };
  await controller.scheduleProc('worker', recover, { code: 0, signal: null });
  await sleep(40); assert.equal(starts, 0);
  await controller.scheduleProc('worker', recover, { code: 1 });
  await controller.beforeStop('worker');
  await sleep(40); assert.equal(starts, 0);
  await controller.beforeStart('worker');
  await controller.scheduleProc('worker', recover, { code: 1 });
  await sleep(40); assert.equal(starts, 1);
  assert.equal(controller.snapshot('worker').health, 'unknown');
});
test('failed intent write does not change in-memory desired state', async t => {
  const { controller, workspace } = setup(t);
  fs.mkdirSync(path.join(workspace, '.logos/supervisor/packages.json'));
  await assert.rejects(controller.beforeStop('worker'));
  assert.equal(controller.wantsRunning('worker'), true);
});
