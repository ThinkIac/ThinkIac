import { getProxy } from 'logos';
import { parseCookies } from './identity.js';
import { sessionCookie as sessionCookieFor, shouldUseSecureSessionCookie } from '../google_oauth.js';

// O Redirect decide o destino autenticado conforme o cargo da pessoa.
export const AUTHENTICATED_HOME = '/redirect/home';

export function sessionCookie(req, sessionId, durationMs) {
    return sessionCookieFor(sessionId, durationMs, {
        insecure: !shouldUseSecureSessionCookie(req, {
            insecureOverride: process.env.AUTH_ENV_INSECURE_COOKIES === '1',
        }),
    });
}

export async function startSession(req, res, userId) {
    const db = getProxy('auth');
    const durationMs = parseInt(process.env.AUTH_ENV_SESSION_DURATION_MS) || 86400000;
    const session = await db.session.push({
        userId,
        expiresAt: new Date(Date.now() + durationMs),
    });
    res.setHeader('Set-Cookie', sessionCookie(req, session.id, durationMs));
    return session;
}

/** Encerra a sessão atual e impede que o navegador a reutilize. */
export async function endBrowserSession(req, res) {
    const sessionId = parseCookies(req.headers?.cookie).sessionId;
    if (sessionId) {
        await getProxy('auth').session.delete(sessionId).catch(() => {});
    }
    // Usa os mesmos atributos de escopo e segurança do cookie de login para
    // garantir que a remoção alcance a sessão, inclusive atrás de proxy HTTPS.
    res.setHeader('Set-Cookie', sessionCookie(req, '', 0));
}

