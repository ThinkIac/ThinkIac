import { fileURLToPath } from 'node:url';
import { getProxy } from 'logos';
import { createMcpAuth } from '../mcp-auth.js';
import { normalizeUser, identityProvider } from './identity.js';
import { activeEntitlements } from './account-policy.js';
import { pathBelongsToApp } from '../app_flow.js';
export const mcpAuth = createMcpAuth({
    directory: fileURLToPath(new URL('../../../.private/auth-mcp/', import.meta.url)),
    resolveUser: async (id) => normalizeUser(getProxy('auth').user[id]),
    canAccess: async (user, pkg) => !user.disabled && (user.role === 'admin' || activeEntitlements(getProxy('auth'), user.id)
        .some((slug) => pathBelongsToApp(`/${pkg}/`, slug))),
});

async function mcpAdministrator(req, res) {
    const resolved = await identityProvider.resolve(req);
    if (!resolved) { res.status(401).json({ error: 'Login necessário.' }); return null; }
    if (resolved.user.role !== 'admin' || resolved.session.delegatedSubject) {
        res.status(403).json({ error: 'Administração MCP exige administrador sem delegação.' }); return null;
    }
    return resolved.user;
}

export async function routerMcpIssue(req, res) {
    const admin = await mcpAdministrator(req, res);
    if (!admin) return;
    const user = getProxy('auth').user[String(req.body?.userId || admin.id)];
    if (!user || user.disabled) return res.status(400).json({ error: 'Usuário inválido.' });
    try {
        const issued = mcpAuth.issue({ userId: user.id, tenantId: user.tenantId ?? null,
            scopes: req.body?.scopes, ttlMs: req.body?.ttlMs ?? 86400000,
            maxRequestsPerMinute: req.body?.maxRequestsPerMinute ?? 120 });
        mcpAuth.audit({ timestamp: new Date().toISOString(), operation: 'credential:issued', principal: admin.id, credentialId: issued.credentialId });
        res.set('Cache-Control', 'no-store');
        return res.status(201).json(issued);
    } catch (error) { return res.status(400).json({ error: error.message }); }
}

export async function routerMcpCredentials(req, res) {
    if (!await mcpAdministrator(req, res)) return;
    res.set('Cache-Control', 'no-store');
    return { credentials: mcpAuth.list() };
}

export async function routerMcpRevoke(req, res) {
    const admin = await mcpAdministrator(req, res);
    if (!admin) return;
    const credentialId = String(req.params?.id || '');
    const revoked = mcpAuth.revoke(credentialId);
    mcpAuth.audit({ timestamp: new Date().toISOString(), operation: 'credential:revoked', principal: admin.id, credentialId, revoked });
    return { revoked };
}
