import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { configureInstance, parseArgs } from './instance.mjs';

test('first invocation stores the locked profile and private credentials; restart reuses both', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkiac-instance-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const output = { write() {} };
  const args = { cwd, base: process.cwd(), input: {}, output };
  const instance = await configureInstance({ ...args, ...parseArgs(['--name', 'demo', '--port', '15040']) });
  assert.equal(instance.config.port, 15040);
  assert.equal(instance.config.profile, 'default');
  assert.equal(instance.home, path.join(cwd, '.thinkiac'));
  const file = path.join(instance.home, '.env');
  const env = await fs.readFile(file, 'utf8');
  assert.match(env, /^INITIAL_AUTH_PASSWORD=[\w-]{32}$/m);
  if (process.platform !== 'win32') assert.equal((await fs.stat(file)).mode & 0o777, 0o600);
  assert.deepEqual(await configureInstance(args), instance);
  assert.equal(await fs.readFile(file, 'utf8'), env);
  await assert.rejects(configureInstance({ ...args, name: 'other' }), /já existe/);
});

test('rejects missing non-interactive name, duplicate ports and invalid options', async t => {
  const cwd = await fs.mkdtemp(path.join(os.tmpdir(), 'thinkiac-instance-'));
  t.after(() => fs.rm(cwd, { recursive: true, force: true }));
  const args = { cwd, base: process.cwd(), input: {}, output: { write() {} } };
  assert.throws(() => parseArgs(['--profile', '--install-only']), /inválida/);
  await assert.rejects(configureInstance(args), /--name/);
  await assert.rejects(configureInstance({ ...args, name: 'demo', port: '3333' }), /portas distintas/);
  assert.deepEqual(await fs.readdir(cwd), []);
});
