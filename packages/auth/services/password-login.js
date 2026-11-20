import crypto from 'node:crypto';
import { getProxy, scriba } from 'logos';
import { verifyPasswordAsync } from '../password-async.js';
import { loginAttemptStore } from '../login-attempts.js';
import { allowLoginAttempt } from './login-throttle.js';
import { isRetiredLocalAccount } from './account-policy.js';
import { AUTHENTICATED_HOME, sessionCookie, endBrowserSession } from './browser-sessions.js';
import { SIGN_IN_VIEW } from '../google_oauth.js';
const verifyPassword = verifyPasswordAsync;
export function hashPassword(password) {
    const salt = crypto.randomBytes(16).toString('hex');
    const iterations = 210000;
    const keylen = 64;
    const digest = 'sha512';

    const hash = crypto.pbkdf2Sync(password, salt, iterations, keylen, digest).toString('hex');
    return `${salt}:${iterations}:${hash}`;
}

export async function login(req, res) {
    const { email, password } = req.body || {};
    if (!allowLoginAttempt(req)) {
        res.setHeader('Retry-After', '900');
        return res.status(429).send({ error: 'Too many login attempts. Try again later.' });
    }
    const db = getProxy('auth');

    const normalizedEmail = typeof email === 'string' ? email.trim().toLowerCase() : '';
    let accountAttempts;
    let reservation;
    if (normalizedEmail) {
        try {
            accountAttempts = loginAttemptStore(scriba.instance._tenants.auth.db);
            reservation = accountAttempts.reserve(normalizedEmail);
        } catch {
            return res.status(503).send({ error: 'Login temporarily unavailable. Try again later.' });
        }
        if (reservation.retryAfter) {
            res.setHeader('Retry-After', String(reservation.retryAfter));
            return res.status(429).send({ error: 'Too many login attempts. Try again later.' });
        }
    }
    const user = normalizedEmail ? await db.user.findOne({ email: normalizedEmail }) : null;

    if (user && !user.disabled && !isRetiredLocalAccount(user) && await verifyPassword(password, user.password) && !user.disabled) {
        try {
            accountAttempts.refund(reservation);
        } catch {
            return res.status(503).send({ error: 'Login temporarily unavailable. Try again later.' });
        }
        // Mantém o registro de atividade da identidade.
        user.lastActivityAt = new Date();

        const durationMs = parseInt(process.env.AUTH_ENV_SESSION_DURATION_MS) || 86400000;
        const expiresAt = new Date(Date.now() + durationMs);

        const session = await db.session.push({
            userId: user.id,
            expiresAt: expiresAt
        });

        res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));

        return {
            success: true,
            role: user.role,
            accountType: user.accountType,
            redirectUrl: AUTHENTICATED_HOME,
        };
    }

    return res.status(400).send({ error: 'Credentials not found.' });
}

export async function logout(req, res) {
    await endBrowserSession(req, res);
    return res.redirect(SIGN_IN_VIEW);
}
