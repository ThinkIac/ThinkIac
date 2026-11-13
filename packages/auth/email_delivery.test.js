import assert from 'node:assert/strict';
import test from 'node:test';
import { queueVerificationEmail } from './email_delivery.js';

test('queues a verification email through the configured SMTP gateway', async () => {
    let request;
    await queueVerificationEmail({
        email: 'ana@example.com', code: '12345678', url: 'https://thinkiac.cloud/auth/verify-email?token=abc',
        env: { AUTH_EMAIL_GATEWAY_URL: 'http://mail-gateway', AUTH_EMAIL_GATEWAY_TOKEN: 'secret', AUTH_EMAIL_MAILBOX_ID: 'auth-mailbox', AUTH_EMAIL_FROM: 'auth@thinkiac.cloud' },
        fetchImpl: async (url, options) => { request = { url, options }; return { ok: true, json: async () => ({ status: 'queued' }) }; },
    });
    assert.equal(request.url, 'http://mail-gateway/v1/messages/send');
    assert.equal(request.options.headers.authorization, 'Bearer secret');
    assert.match(request.options.body, /12345678/);
});

test('does not attempt delivery without the dedicated auth sender configuration', async () => {
    await assert.rejects(() => queueVerificationEmail({ email: 'ana@example.com' }), /não está configurado/);
});
