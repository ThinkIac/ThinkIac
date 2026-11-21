import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import crypto from 'node:crypto';
const { state } = vi.hoisted(() => ({ state: { db: null } }));
vi.mock('logos', () => ({ getProxy: () => state.db, dispatchEvent: vi.fn(async () => ({ granted: true })), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import { dispatchEvent } from 'logos';
import * as auth from './index.js';

function table(rows = []) {
    const data = [...rows];
    const store = {
        query: vi.fn((filter = {}) => data.filter(row => Object.entries(filter).every(([key, value]) =>
            value?.$lt ? new Date(row[key]) < value.$lt : row[key] === value))),
        findOne: vi.fn(filter => store.query(filter)[0]),
        push: vi.fn(async value => { const row = { id: `row-${data.length}`, ...value }; data.push(row); store[row.id] = row; return row; }),
        delete: vi.fn(async id => { const i = data.findIndex(row => row.id === id); if (i >= 0) data.splice(i, 1); delete store[id]; return i >= 0; }),
    };
    for (const row of data) store[row.id] = row;
    return store;
}
const request = query => ({ query: query || {}, headers: {}, protocol: 'https' });
const response = () => ({ redirect: vi.fn(value => value), setHeader: vi.fn() });
const denied = reason => `/view/auth/Login?erro=${reason}`;
const flow = overrides => ({ id: 'f1', state: 'state', nonce: 'nonce', codeVerifier: 'verifier', client: 'web', expiresAt: new Date(Date.now() + 60000), ...overrides });
const claims = overrides => ({ iss: 'https://accounts.google.com', aud: 'client-id', exp: Math.floor(Date.now() / 1000) + 600, nonce: 'nonce', sub: 'sub', email: 'alice@example.test', email_verified: true, ...overrides });
const idToken = value => `header.${Buffer.from(JSON.stringify(value)).toString('base64url')}.signature`;
function tokenResponse(value = claims()) {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ id_token: idToken(value) }) })));
}
beforeEach(() => {
    vi.stubEnv('AUTH_ENV_GOOGLE_CLIENT_ID', 'client-id');
    vi.stubEnv('AUTH_ENV_GOOGLE_CLIENT_SECRET', 'client-secret');
    vi.stubEnv('AUTH_ENV_GOOGLE_AUTOLINK', '1');
    vi.stubEnv('AUTH_ENV_SESSION_DURATION_MS', '60000');
    vi.stubEnv('AUTH_ENV_INSECURE_COOKIES', '0');
    state.db = {
        oauthflow: table([flow()]), loginticket: table(), session: table(),
        user: table([{ id: 'u1', username: 'alice', email: 'alice@example.test', googleSub: 'sub', accountType: 'normal' }]),
        authsettings: table([{ id: 'default' }]), appentitlement: table(),
    };
    tokenResponse();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks(); });

test('Google start persists PKCE, nonce and ten minute state before redirecting', async () => {
    const res = response();
    const result = await auth.googleStart(request({ client: 'android', next: '/my-app' }), res);
    const saved = state.db.oauthflow.push.mock.calls[0][0];
    const url = new URL(result);
    expect(url.origin).toBe('https://accounts.google.com');
    expect(url.searchParams.get('state')).toBe(saved.state);
    expect(url.searchParams.get('nonce')).toBe(saved.nonce);
    expect(url.searchParams.get('code_challenge')).toBe(crypto.createHash('sha256').update(saved.codeVerifier).digest('base64url'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('prompt')).toBe('select_account');
    expect(url.searchParams.get('scope')).toBe('openid email profile');
    expect(saved).toMatchObject({ client: 'android', next: '/my-app', appSlug: null });
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(590000);
    expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(600000);
    expect(state.db.oauthflow.push.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
});
test.each(['https://evil.test', '//evil.test', '/auth/ticket'])('Google start drops unsafe next %s and normalizes unknown client', async next => {
    await auth.googleStart(request({ next, client: 'unknown' }), response());
    expect(state.db.oauthflow.push.mock.calls[0][0]).toMatchObject({ next: null, client: 'web' });
});
test.each([
    [{ flow: 'app', app: 'missing' }, 'app-invalido'],
    [null, 'google-nao-configurado'],
])('Google start rejects invalid configuration/flow without persisting', async (query, reason) => {
    if (!query) vi.stubEnv('AUTH_ENV_GOOGLE_CLIENT_ID', '');
    expect(await auth.googleStart(request(query), response())).toBe(denied(reason));
    expect(state.db.oauthflow.push).not.toHaveBeenCalled();
});
test.each([
    [{ error: 'access_denied' }, 'google-cancelado'],
    [{ code: 'code' }, 'google-resposta-incompleta'],
    [{ state: 'state' }, 'google-resposta-incompleta'],
    [{ code: 'code', state: 'missing' }, 'google-estado-invalido'],
])('callback refuses incomplete or absent state before network', async (query, reason) => {
    expect(await auth.googleCallback(request(query), response())).toBe(denied(reason));
    expect(fetch).not.toHaveBeenCalled();
    expect(state.db.session.push).not.toHaveBeenCalled();
});
test('expired state is deleted before refusal', async () => {
    state.db.oauthflow.f1.expiresAt = new Date(0);
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied('google-estado-expirado'));
    expect(state.db.oauthflow.delete).toHaveBeenCalledWith('f1');
    expect(fetch).not.toHaveBeenCalled();
});
test('web callback exchanges PKCE only after deleting state, then creates cookie and redirects', async () => {
    state.db.oauthflow.f1.next = '/my-app';
    const res = response();
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), res)).toBe('/my-app');
    expect(state.db.oauthflow.delete.mock.invocationCallOrder[0]).toBeLessThan(fetch.mock.invocationCallOrder[0]);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('https://oauth2.googleapis.com/token');
    expect(options.method).toBe('POST');
    expect(Object.fromEntries(options.body)).toMatchObject({ code: 'code', code_verifier: 'verifier', client_id: 'client-id', client_secret: 'client-secret', grant_type: 'authorization_code' });
    expect(options.signal).toBeInstanceOf(AbortSignal);
    expect(state.db.session.push).toHaveBeenCalledWith(expect.objectContaining({ userId: 'u1' }));
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('HttpOnly; Secure;'));
    expect(state.db.loginticket.push).not.toHaveBeenCalled();
    expect(state.db.user.u1.lastActivityAt).toBeInstanceOf(Date);
    expect(dispatchEvent).not.toHaveBeenCalled();
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied('google-estado-invalido'));
    expect(fetch).toHaveBeenCalledTimes(1);
});
test.each(['http', 'network', 'json'])('exchange failure %s never creates a session', async kind => {
    fetch.mockImplementation(async () => {
        if (kind === 'network') throw new Error('offline');
        return { ok: kind !== 'http', json: async () => { throw new Error('bad json'); } };
    });
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied(kind === 'http' ? 'google-troca-falhou' : 'google-indisponivel'));
    expect(state.db.session.push).not.toHaveBeenCalled();
});
test.each([{ nonce: 'wrong' }, { aud: 'wrong' }, { iss: 'evil' }, { exp: 1 }, { email_verified: false }])('invalid claims %j never resolve a user or session', async overrides => {
    tokenResponse(claims(overrides));
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied('google-token-invalido'));
    expect(state.db.user.findOne).not.toHaveBeenCalled();
    expect(state.db.session.push).not.toHaveBeenCalled();
});
test.each([{}, { registrationEnabled: true }, { registrationEnabled: false }, { invitationsEnabled: true }])('new Google identity respects registration policy %j', async settings => {
    Object.assign(state.db.authsettings.default, settings);
    state.db.user = table();
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied('google-registration-disabled'));
    expect(state.db.user.push).not.toHaveBeenCalled();
});
test('existing Google user can log in with registration closed', async () => {
    state.db.authsettings.default.registrationEnabled = false;
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe('/redirect/home');
    expect(state.db.user.push).not.toHaveBeenCalled();
});
test.each([{ disabled: true }, { accountType: 'local' }])('blocked account %j receives no session', async overrides => {
    Object.assign(state.db.user.u1, overrides);
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), response())).toBe(denied('conta-bloqueada'));
    expect(state.db.session.push).not.toHaveBeenCalled();
    expect(state.db.loginticket.push).not.toHaveBeenCalled();
});
test.each(['android', 'electron'])('%s callback issues a one minute deep link ticket without cookie', async client => {
    state.db.oauthflow.f1.client = client;
    const res = response();
    const url = new URL(await auth.googleCallback(request({ code: 'code', state: 'state' }), res));
    const saved = state.db.loginticket.push.mock.calls[0][0];
    expect(url.protocol).toBe('thinkiac:');
    expect(url.searchParams.get('ticket')).toBe(saved.token);
    expect(url.searchParams.get('next')).toBe('/redirect/home');
    expect(saved).toMatchObject({ userId: 'u1', consumed: false });
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(59000);
    expect(saved.expiresAt.getTime() - Date.now()).toBeLessThanOrEqual(60000);
    expect(state.db.session.push).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
});
test.each([
    [null, 'ticket-ausente'], [{ token: 'other' }, 'ticket-invalido'],
    [{ consumed: true }, 'ticket-reusado'], [{ expiresAt: new Date(0) }, 'ticket-expirado'], [{ userId: 'missing' }, 'ticket-orfao'],
])('ticket refusal %j never creates a cookie', async (overrides, reason) => {
    await state.db.loginticket.push({ id: 't1', token: 'ticket', userId: 'u1', expiresAt: new Date(Date.now() + 60000), ...overrides });
    const res = response();
    expect(await auth.ticket(request(overrides ? { ticket: 'ticket' } : {}), res)).toBe(denied(reason));
    expect(state.db.session.push).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
    if (overrides && !overrides.token) expect(state.db.loginticket.delete).toHaveBeenCalledWith('t1');
});
test('ticket is deleted before session creation, cannot be replayed, and drops external next', async () => {
    await state.db.loginticket.push({ id: 't1', token: 'ticket', userId: 'u1', expiresAt: new Date(Date.now() + 60000) });
    expect(await auth.ticket(request({ ticket: 'ticket', next: '//evil.test' }), response())).toBe('/redirect/home');
    expect(state.db.loginticket.delete.mock.invocationCallOrder[0]).toBeLessThan(state.db.session.push.mock.invocationCallOrder[0]);
    expect(await auth.ticket(request({ ticket: 'ticket' }), response())).toBe(denied('ticket-invalido'));
    expect(state.db.session.push).toHaveBeenCalledTimes(1);
});
test.each([['https', false, true], ['http', false, false], ['https', true, false]])('session cookie honors protocol %s and override %s', async (protocol, insecure, secure) => {
    vi.stubEnv('AUTH_ENV_INSECURE_COOKIES', insecure ? '1' : '0');
    const res = response();
    await auth.startSession({ ...request(), protocol }, res, 'u1');
    const cookie = res.setHeader.mock.calls[0][1];
    expect(cookie.includes(' Secure;')).toBe(secure);
    expect(cookie).toContain('HttpOnly;');
    expect(cookie).toContain('SameSite=Strict; Max-Age=60');
});

// Verificações de integração dos adaptadores com o serviço de sessão extraído.
test.each(['', 'invalid', '0'])('session duration %s preserves the one day fallback', async duration => {
    vi.stubEnv('AUTH_ENV_SESSION_DURATION_MS', duration);
    const res = response();
    const saved = await auth.startSession(request(), res, 'u1');
    expect(saved.expiresAt.getTime() - Date.now()).toBeGreaterThan(86399000);
    expect(res.setHeader.mock.calls[0][1]).toContain('Max-Age=86400');
});
test('a session persistence failure cannot set a browser cookie', async () => {
    state.db.session.push.mockRejectedValueOnce(new Error('storage unavailable'));
    const res = response();
    await expect(auth.startSession(request(), res, 'u1')).rejects.toThrow('storage unavailable');
    expect(res.setHeader).not.toHaveBeenCalled();
});
test.each([false, true])('logout clears cookie even when session deletion fails: %s', async fails => {
    if (fails) state.db.session.delete.mockRejectedValueOnce(new Error('storage unavailable'));
    const res = response();
    expect(await auth.logout({ ...request(), headers: { cookie: 'sessionId=browser-session' } }, res)).toBe('/view/auth/Login');
    expect(state.db.session.delete).toHaveBeenCalledWith('browser-session');
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.stringContaining('sessionId=; HttpOnly; Secure; Path=/; SameSite=Strict; Max-Age=0'));
    expect(res.setHeader.mock.invocationCallOrder[0]).toBeLessThan(res.redirect.mock.invocationCallOrder[0]);
});
test('logout without a cookie clears the browser without deleting other sessions', async () => {
    const res = response();
    await auth.logout(request(), res);
    expect(state.db.session.delete).not.toHaveBeenCalled();
    expect(res.setHeader.mock.calls[0][1]).toContain('Max-Age=0');
});
test('callback never requests product credits', async () => {
    const { dispatchEvent } = await import('logos');
    dispatchEvent.mockRejectedValueOnce(new Error('credit unavailable'));
    // No product event runs as a consequence of authentication.
    const res = response();
    expect(await auth.googleCallback(request({ code: 'code', state: 'state' }), res)).toBe('/redirect/home');
    expect(state.db.session.push).toHaveBeenCalledTimes(1);
    expect(dispatchEvent).not.toHaveBeenCalled();
});
