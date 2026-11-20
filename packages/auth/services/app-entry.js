import { getProxy } from 'logos';
import { getDistributedApp } from '../app_flow.js';
import { ensureEntitlement, isRetiredLocalAccount } from './account-policy.js';
import { SIGN_IN_VIEW } from '../google_oauth.js';
import { AUTHENTICATED_HOME } from './browser-sessions.js';
export async function enter(req, res) {
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return res.redirect(SIGN_IN_VIEW);
    if (isRetiredLocalAccount(user)) return res.status(410).send('Este tipo de conta foi descontinuado.');

    return res.redirect(AUTHENTICATED_HOME);
}

export async function enterDistributedApp(req, res) {
    const app = getDistributedApp(req.params?.app);
    if (!app) return { status: 404, message: 'Aplicativo não distribuível.' };

    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return res.redirect(SIGN_IN_VIEW);
    await ensureEntitlement(db, user.id, app.slug);

    return res.redirect(app.sharedView);
}
