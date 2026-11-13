'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { parseEnvFile, loadPackageEnv } = require('../index.cjs');

test('parses quoted, multiline and commented values', () => {
  assert.deepEqual(parseEnvFile('A=one # note\nB="two\\nthree"\nC=\'x#y\''), { A: 'one', B: 'two\nthree', C: 'x#y' });
});

test('keeps the process value and exposes the package-scoped value', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'logos-env-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, '.env'), 'SHARED=file\nTOKEN=secret\n');
  const env = { SHARED: 'shell' };
  const loaded = loadPackageEnv({ folder: 'my-package', dir }, { env, log() {} });
  assert.equal(env.SHARED, 'shell');
  assert.equal(env.MY_PACKAGE_ENV_SHARED, 'file');
  assert.equal(env.MY_PACKAGE_ENV_TOKEN, 'secret');
  assert.equal(loaded.SHARED.skippedOriginal, true);
});
