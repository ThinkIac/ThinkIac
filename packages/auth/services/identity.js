import { getProxy } from 'logos';
import { createPrincipal } from '../runtime/identity.js';

export function normalizeUser(user) {
    if (!user) return null;
    const data = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
    delete data.password;
    return data;
}

export function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;

    cookieHeader.split(';').forEach(cookie => {
        const [parts] = cookie.split('=');
        const name = parts.trim();
        const value = cookie.substring(name.length + 1).trim();
        if (name) cookies[name] = decodeURIComponent(value);
    });
    return cookies;
}

function principalFor(user, session = null) {
    const cleanUser = normalizeUser(user);
    if (!cleanUser?.id) return null;
    let capabilities = [];
    try { capabilities = JSON.parse(session?.delegatedCapabilities || '[]'); } catch {}
    return createPrincipal({
        subject: cleanUser.id,
        type: 'user',
        role: cleanUser.role,
        capabilities: Array.isArray(capabilities) ? capabilities : [],
        sessionId: session?.id ?? null,
        claims: { email: cleanUser.email, username: cleanUser.username },
    });
}

export const identityProvider = Object.freeze({
    async resolve(req) {
        const sessionId = parseCookies(req?.headers?.cookie)['sessionId'];
        const db = getProxy('auth');
        const session = sessionId ? db.session[sessionId] : null;
        if (!session || !Number.isFinite(new Date(session.expiresAt).getTime()) || Date.now() >= new Date(session.expiresAt).getTime()) return null;
        const user = db.user[session.userId];
        if (!user || user.disabled) return null;
        const sessionData = typeof session.toJSON === 'function' ? session.toJSON() : { id: sessionId, ...session };
        return { principal: principalFor(user, sessionData), user: normalizeUser(user), session: sessionData };
    },
});
