import crypto from 'node:crypto';

export const DEFAULT_TENANT_SCOPES = Object.freeze(['llm:invoke']);
export const DEFAULT_BILLING_SCOPES = Object.freeze([
    'billing:read',
    'billing:checkout',
    'billing:upgrade',
    'delegate:machines',
    'delegate:git',
    'delegate:packages',
]);

export function hashProxyToken(token) {
    return crypto.createHash('sha256').update(String(token)).digest('hex');
}

export function issueProxyToken(randomBytes = crypto.randomBytes) {
    const tokenId = randomBytes(12).toString('base64url');
    const secret = randomBytes(32).toString('base64url');
    const token = `tiac.${tokenId}.${secret}`;
    return { tokenId, token, tokenHash: hashProxyToken(token) };
}

export function parseProxyToken(token) {
    const match = /^tiac\.([A-Za-z0-9_-]{12,})\.([A-Za-z0-9_-]{32,})$/.exec(String(token || ''));
    return match ? { tokenId: match[1] } : null;
}

export function verifyProxyToken(token, record) {
    if (!record || record.revokedAt) return false;
    const parsed = parseProxyToken(token);
    if (!parsed || parsed.tokenId !== record.tokenId) return false;
    const actual = Buffer.from(hashProxyToken(token), 'hex');
    const expected = Buffer.from(String(record.tokenHash || ''), 'hex');
    return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

export function parseScopes(value) {
    if (Array.isArray(value)) return value.map(String);
    try {
        const parsed = JSON.parse(value || '[]');
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

export function credentialHasScope(record, scope) {
    const scopes = parseScopes(record?.scopes);
    return scopes.includes('*') || scopes.includes(scope);
}
