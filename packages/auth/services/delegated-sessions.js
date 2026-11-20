import crypto from 'node:crypto';
import { getProxy } from 'logos';
import { resolveProxyCredential } from './credentials.js';
import { sessionCookie } from './browser-sessions.js';
const DELEGATION_APPS = Object.freeze({
    machines: { scope: 'delegate:machines', capabilities: ['machines.view', 'machines.manage'], redirectPath: '/view/machine-registry/Machines' },
    git: { scope: 'delegate:git', capabilities: ['git.view', 'git.write', 'git.deploy'], redirectPath: '/view/git-cloud/Index' },
});
export async function issueDelegatedTicket(req, res) {
    const app = DELEGATION_APPS[String(req.body?.app || '')];
    if (!app) return { status: 400, error: 'App de delegação inválido.' };
    const authHeader = req.headers?.authorization || '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    const resolved = await resolveProxyCredential(token, app.scope);
    if (!resolved?.userId) return { status: 403, error: 'Credencial sem escopo de delegação.' };
    const requested = Array.isArray(req.body?.capabilities) ? req.body.capabilities : [];
    const capabilities = requested.filter((capability) => app.capabilities.includes(capability));
    if (!capabilities.length) return { status: 400, error: 'Nenhuma capability válida foi solicitada.' };
    const raw = crypto.randomBytes(32).toString('base64url');
    const db = getProxy('auth');
    await db.delegatedTicket.push({
        tokenHash: crypto.createHash('sha256').update(raw).digest('hex'),
        userId: resolved.userId,
        subject: String(req.body?.subject || 'tenant-user').slice(0, 120),
        capabilities: JSON.stringify(capabilities),
        redirectPath: app.redirectPath,
        expiresAt: new Date(Date.now() + 60_000),
    });
    return { status: 200, url: `/auth/delegation?ticket=${encodeURIComponent(raw)}` };
}

export async function consumeDelegatedTicket(req, res) {
    const raw = String(req.query?.ticket || '');
    const hash = crypto.createHash('sha256').update(raw).digest('hex');
    const db = getProxy('auth');
    const ticket = db.delegatedTicket.findOne({ tokenHash: hash });
    if (!ticket || new Date(ticket.expiresAt).getTime() < Date.now()) return res.redirect('/auth/login');
    await db.delegatedTicket.delete(ticket.id).catch(() => {});
    const durationMs = 8 * 60 * 60 * 1000;
    const session = await db.session.push({
        userId: ticket.userId,
        expiresAt: new Date(Date.now() + durationMs),
        delegatedCapabilities: ticket.capabilities,
        delegatedSubject: ticket.subject,
    });
    res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));
    return res.redirect(ticket.redirectPath);
}
