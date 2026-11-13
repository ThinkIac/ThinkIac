'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { expectedCredential, buildCredentialGuard } = require('../index.cjs');

test('uses the package-scoped token before the fallback', () => {
  assert.equal(expectedCredential('my-package', { MY_PACKAGE_ENV_AUTH_TOKEN: 'package', AUTH_TOKEN: 'fallback' }), 'package');
  assert.equal(expectedCredential('my-package', { AUTH_TOKEN: 'fallback' }), 'fallback');
});

test('denies absent credentials and lets the verification pipeline allow a credential', async () => {
  let response;
  const container = { bus: { async pipeline(_event, verdict, context) { return context.token === 'override' ? { ...verdict, allowed: true } : verdict; } } };
  const guard = buildCredentialGuard(container, 'app', { env: { APP_ENV_AUTH_TOKEN: 'expected' } });
  await guard({ headers: { authorization: 'Bearer wrong' } }, { status(code) { response = { code }; return { json(body) { response.body = body; } }; } }, () => { throw new Error('must not continue'); });
  assert.deepEqual(response, { code: 401, body: { error: 'Invalid or missing bearer credential' } });
  let called = false;
  await guard({ headers: { authorization: 'Bearer override' } }, {}, () => { called = true; });
  assert.equal(called, true);
});
