import { getProxy } from 'logos';
import { safeNext } from '../google_oauth.js';
import { AUTHENTICATED_HOME, startSession } from './browser-sessions.js';

export function loginRedirect(reason) {
    return `/view/auth/Login?erro=${encodeURIComponent(reason)}`;
}

export async function ticket(req, res) {
    const db = getProxy('auth');
    const token = req.query?.ticket;
    if (!token) return res.redirect(loginRedirect('ticket-ausente'));

    const found = await db.loginticket.findOne({ token });
    if (!found) return res.redirect(loginRedirect('ticket-invalido'));

    // SQLite DELETE reports one affected row only to the winning consumer.
    // Never issue a session when deletion fails, is vetoed, or loses a race.
    const claimed = await db.loginticket.delete(found.id).catch(() => false);
    if (claimed !== true) return res.redirect(loginRedirect('ticket-invalido'));

    if (found.consumed) return res.redirect(loginRedirect('ticket-reusado'));
    if (new Date(found.expiresAt).getTime() < Date.now()) return res.redirect(loginRedirect('ticket-expirado'));

    const user = db.user[found.userId];
    if (!user) return res.redirect(loginRedirect('ticket-orfao'));

    await startSession(req, res, user.id);
    return res.redirect(safeNext(req.query?.next, AUTHENTICATED_HOME));
}

