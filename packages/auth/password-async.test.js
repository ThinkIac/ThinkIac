import test from 'node:test';
import assert from 'node:assert/strict';
import { pbkdf2Sync } from 'node:crypto';
import { hashPasswordAsync, verifyPasswordAsync } from './password-async.js';

test('verifies legacy password records and rejects plaintext/invalid hashes', async () => {
    const salt = 'old-salt';
    const hash = `${salt}:10000:${pbkdf2Sync('secret', salt, 10000, 64, 'sha512').toString('hex')}`;
    assert.equal(await verifyPasswordAsync('secret', hash), true);
    assert.equal(await verifyPasswordAsync('wrong', hash), false);
    for (const invalid of ['', 'secret', 'salt:NaN:abc', 'salt:0:abc']) assert.equal(await verifyPasswordAsync('', invalid), false);
    const fresh = await hashPasswordAsync('new password');
    assert.equal(await verifyPasswordAsync('new password', fresh), true);
});
test('concurrent password work yields to the event loop', async () => {
    let yielded = false;
    setImmediate(() => { yielded = true; });
    await Promise.all(Array.from({ length: 6 }, () => hashPasswordAsync('password')));
    assert.equal(yielded, true);
});
