import { getProxy } from 'logos';
import { parseProxyToken, verifyProxyToken, credentialHasScope } from '../proxy_credentials.js';

export async function resolveUserIdFromBearer(req, scope = null) {
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : null;
    if (!token) return null;

    const resolved = await resolveProxyCredential(token, scope);
    return resolved?.userId || null;
}

const credentialRateWindows = new Map();

function withinCredentialRateLimit(record) {
    const now = Date.now();
    const current = credentialRateWindows.get(record.tokenId);
    const window = !current || now - current.startedAt >= 60_000
        ? { startedAt: now, count: 0 }
        : current;
    window.count += 1;
    credentialRateWindows.set(record.tokenId, window);
    return window.count <= Math.max(1, Number(record.maxRequestsPerMinute) || 60);
}

export async function resolveProxyCredential(token, scope = null) {
    const db = getProxy('auth');
    const parsed = parseProxyToken(token);
    if (parsed) {
        const record = db.proxyCredential.findOne({ tokenId: parsed.tokenId });
        // Installation credentials are least-privilege service principals. They
        // intentionally do not create interactive User rows, but still use the
        // same hashed credential, revocation, scope and rate-limit checks.
        const principalExists = Boolean(db.user[record.userId]) || String(record.userId || '').startsWith('installation:');
        if (!verifyProxyToken(token, record) || record.status !== 'active' || !principalExists) return null;
        if (scope && !credentialHasScope(record, scope)) return null;
        if (!withinCredentialRateLimit(record)) return null;
        record.lastUsedAt = new Date();
        return {
            userId: record.userId,
            tenantId: record.tenantId || null,
            credentialId: record.id,
            scopes: JSON.parse(record.scopes || '[]'),
            spendLimitMicros: record.spendLimitMicros ?? null,
            spentMicros: record.spentMicros || 0,
        };
    }

    // Janela de migração explicitamente opt-in. Em produção o default é negar:
    // um token legado em texto não pode recuperar implicitamente todos os
    // escopos de billing e administração.
    if (process.env.AUTH_ENV_ALLOW_LEGACY_PROXY_TOKEN !== '1') return null;
    const legacyUser = db.user.findOne({ llmProxyToken: token });
    if (!legacyUser || (scope && scope !== 'llm:invoke')) return null;
    return { userId: legacyUser.id, legacy: true, scopes: ['llm:invoke'] };
}

export async function onResolveProxyToken(payload) {
    const { token, scope = null } = payload || {};
    if (!token) return null;
    return resolveProxyCredential(token, scope);
}

export async function onRecordProxySpend(payload) {
    const credentialId = String(payload?.credentialId || '');
    const amountMicros = Math.max(0, Math.trunc(Number(payload?.amountMicros) || 0));
    if (!credentialId || !amountMicros) return null;
    const db = getProxy('auth');
    const credential = db.proxyCredential[credentialId];
    if (!credential || credential.revokedAt) return null;
    credential.spentMicros = (credential.spentMicros || 0) + amountMicros;
    return { credentialId, spentMicros: credential.spentMicros };
}
