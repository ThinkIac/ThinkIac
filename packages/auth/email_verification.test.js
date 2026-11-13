import assert from 'node:assert/strict';
import test from 'node:test';
import { createEmailVerification, verificationMatches } from './email_verification.js';

test('creates an opaque link token and an eight digit confirmation code', () => {
    const verification = createEmailVerification({ userId: 'user-1', email: 'ana@example.com', now: new Date('2026-08-30T00:00:00Z') });
    assert.match(verification.token, /^[A-Za-z0-9_-]{40,}$/);
    assert.match(verification.code, /^\d{8}$/);
    assert.equal(verification.record.userId, 'user-1');
    assert.equal(verification.record.tokenHash.length, 64);
    assert.equal(verification.record.codeHash.length, 64);
    assert.equal(verificationMatches(verification.record, { token: verification.token }), true);
    assert.equal(verificationMatches(verification.record, { code: verification.code }), true);
    assert.equal(verificationMatches(verification.record, { code: '00000000' }), false);
});

test('rejects a code with a malformed shape before comparing secrets', () => {
    const verification = createEmailVerification({ userId: 'user-1', email: 'ana@example.com' });
    assert.equal(verificationMatches(verification.record, { code: '123' }), false);
    assert.equal(verificationMatches(verification.record, { code: '1234 5678' }), false);
});
