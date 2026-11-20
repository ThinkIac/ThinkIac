import { getProxy } from 'logos';
import { provisionInitialAdmin } from './local-users.js';
import { identityProvider } from './identity.js';
import { attachPrincipal } from '../runtime/identity.js';
export async function setupUser(payload, context) {
    const db = getProxy('auth');
    await provisionInitialAdmin(db, process.env);

    // Scriba retorna '' (não undefined) pra colunas novas em registros
    // antigos que nunca tiveram esse campo — precisa checar os dois casos,
    // mas sem mexer num inviteBalance=0 já consumido de propósito.
    const isUnset = (v) => v === undefined || v === null || v === '';

    const users = db.user.all ? await db.user.all() : [];
    for (const user of users || []) {
        const rec = db.user[user.id];
        if (isUnset(user.role)) {
            rec.role = 'user';
        }
        if (isUnset(user.inviteBalance)) {
            rec.inviteBalance = 0;
        }
    }

}

export async function credentialVerify(payload, ctx) {
    const req = ctx?.req || payload?.req;
    const resolved = await identityProvider.resolve(req);
    if (!resolved) return { allowed: false, status: 401, message: 'Credencial ausente ou expirada.' };
    attachPrincipal(req, resolved.principal, resolved.user);
    return { allowed: true, principal: resolved.principal };
}

export async function getUser(req, res) {
    const resolved = await identityProvider.resolve(req);
    if (resolved) {
        attachPrincipal(req, resolved.principal, resolved.user);
        return { ...resolved.user, ssoUrl: null };
    }

    return {
        status: 401,
        message: 'Not Authorized.'
    }
}

export async function onGetAdminUser() {
    const db = getProxy('auth');
    const admin = db.user.findOne({ role: 'admin' });
    return admin ? { userId: admin.id } : null;
}
