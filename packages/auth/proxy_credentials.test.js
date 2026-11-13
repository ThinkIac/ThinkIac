import test from 'node:test';
import assert from 'node:assert/strict';
import {
    credentialHasScope,
    DEFAULT_BILLING_SCOPES,
    DEFAULT_TENANT_SCOPES,
    hashProxyToken,
    issueProxyToken,
    parseProxyToken,
    verifyProxyToken,
} from './proxy_credentials.js';
import { activeCredentialWithScope, npmGroupsFor } from './index.js';

test('tenant credential exposes an id but stores only a one-way hash', () => {
    let byte = 0;
    const issued = issueProxyToken((size) => Buffer.alloc(size, ++byte));
    assert.match(issued.token, /^tiac\./);
    assert.equal(issued.tokenHash, hashProxyToken(issued.token));
    assert.equal(parseProxyToken(issued.token).tokenId, issued.tokenId);
    assert.equal(issued.tokenHash.includes(issued.token), false);
});

test('LLM and billing credentials have disjoint least-privilege scopes', () => {
    assert.deepEqual(DEFAULT_TENANT_SCOPES, ['llm:invoke']);
    assert.equal(DEFAULT_BILLING_SCOPES.includes('llm:invoke'), false);
    assert.equal(DEFAULT_BILLING_SCOPES.includes('billing:read'), true);
    assert.equal(DEFAULT_TENANT_SCOPES.some((scope) => scope.startsWith('billing:')), false);
});

test('credential verification is scoped and revoked credentials fail closed', () => {
    const issued = issueProxyToken();
    const record = { ...issued, scopes: '["llm:invoke","billing:read"]', revokedAt: null };
    assert.equal(verifyProxyToken(issued.token, record), true);
    assert.equal(credentialHasScope(record, 'llm:invoke'), true);
    assert.equal(credentialHasScope(record, 'billing:checkout'), false);
    assert.equal(verifyProxyToken(`${issued.token}x`, record), false);
    assert.equal(verifyProxyToken(issued.token, { ...record, revokedAt: new Date() }), false);
});

test('legacy tenant repair only accepts an active dedicated billing credential', () => {
    const records = [
        { id: 'llm', status: 'active', revokedAt: null, scopes: JSON.stringify(['llm:invoke']) },
        { id: 'pending', status: 'pending', revokedAt: null, scopes: JSON.stringify(['billing:read']) },
        { id: 'billing', status: 'active', revokedAt: null, scopes: JSON.stringify(['billing:read']) },
    ];
    assert.equal(activeCredentialWithScope(records, 'billing:read')?.id, 'billing');
    assert.equal(activeCredentialWithScope(records, 'billing:upgrade')?.id, undefined);
});

test('npm credentials expose the reserved user scope and never grant another scope', () => {
    const user = { username: 'marina', role: 'user' };
    const groups = npmGroupsFor(user, { scopes: JSON.stringify(['npm:read', 'npm:publish']) });
    assert.deepEqual(groups, ['npm:read', 'npm:owner:marina', 'npm:publish']);
    assert.equal(groups.includes('npm:owner:outra'), false);
    assert.equal(groups.includes('npm:admin'), false);
});
