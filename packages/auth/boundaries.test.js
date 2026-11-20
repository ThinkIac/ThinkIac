import { dispatchEvent } from 'logos';
import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const { state } = vi.hoisted(() => ({ state: { db: null } }));
vi.mock('logos', () => ({ getProxy: () => state.db, dispatchEvent: vi.fn(), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import * as auth from './index.js';
import { issueProxyToken } from './proxy_credentials.js';

function table(rows = []) {
    const data = [...rows];
    const store = { all: () => data, query: (filter = {}) => data.filter(row => Object.entries(filter).every(([k,v]) => row[k] === v)),
        findOne: filter => store.query(filter)[0],
        push: vi.fn(async value => { const row = { id: `row-${data.length}`, ...value }; data.push(row); store[row.id] = row; return row; }),
        delete: vi.fn(async id => { data.splice(data.findIndex(row => row.id === id), 1); delete store[id]; }) };
    for (const row of data) store[row.id] = row;
    return store;
}
beforeEach(() => {
    vi.clearAllMocks();
    state.db = { user: table([{ id: 'u1', username: 'alice', email: 'alice@example.test', password: 'never-expose', role: 'user' }]),
        session: table([{ id: 's1', userId: 'u1', expiresAt: new Date(Date.now() + 60000) }]),
        proxyCredential: table(), permissionAudit: table(), npmPackage: table(), npmDeviceAuthorization: table() };
});
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const request = () => ({ headers: { cookie: 'sessionId=s1' }, body: {}, params: {}, query: {} });

test('identity resolves a fresh copy with no password and delegated capabilities', async () => {
    state.db.session.s1.delegatedCapabilities = '["packages:read"]';
    const result = await auth.identityProvider.resolve(request());
    expect(result.user).not.toHaveProperty('password');
    expect(state.db.user.u1.password).toBe('never-expose');
    expect(result.principal.subject).toBe('u1');
    expect(result.principal.capabilities).toContain('packages:read');
});
test.each([null, '', 'missing'])('missing session %s denies identity', async value => {
    expect(await auth.identityProvider.resolve({ headers: { cookie: value && `sessionId=${value}` } })).toBeNull();
});
test.each(['invalid', '2000-01-01', null])('expired/invalid date %s denies identity', async expiresAt => {
    state.db.session.s1.expiresAt = expiresAt;
    expect(await auth.identityProvider.resolve(request())).toBeNull();
});
test('disabled and deleted users cannot resolve a valid session', async () => {
    state.db.user.u1.disabled = true;
    expect(await auth.identityProvider.resolve(request())).toBeNull();
    delete state.db.user.u1;
    expect(await auth.identityProvider.resolve(request())).toBeNull();
});
test.each(['{broken', '{}', 'null'])('malformed delegated capabilities %s grant nothing', async value => {
    state.db.session.s1.delegatedCapabilities = value;
    expect((await auth.identityProvider.resolve(request())).principal.capabilities).toEqual([]);
});
test.each(['admin', 'ab', '-alice', 'alice-', 'a_b', 'a'.repeat(64)])('CLI rejects username %s before writing', async username => {
    await expect(auth.manageUserCommand(state.db, 'create', { AUTH_USER_USERNAME: username, AUTH_USER_EMAIL: 'new@example.test', AUTH_USER_PASSWORD: 'long enough password' })).rejects.toThrow();
    expect(state.db.user.push).not.toHaveBeenCalled();
    expect(state.db.permissionAudit.push).not.toHaveBeenCalled();
});
test.each(['update', 'disable', 'enable', 'get'])('CLI %s rejects an unknown target', async operation => {
    await expect(auth.manageUserCommand(state.db, operation, { AUTH_USER_ID: 'absent' })).rejects.toThrow(/not found/);
});
test('CLI rejects no-op and unsupported operations without changing user', async () => {
    for (const operation of ['update', 'erase']) await expect(auth.manageUserCommand(state.db, operation, { AUTH_USER_ID: 'u1' })).rejects.toThrow();
    expect(state.db.user.u1.disabled).toBeUndefined();
    expect(state.db.permissionAudit.push).not.toHaveBeenCalled();
});
test.each(['routerNpmCreateToken', 'routerNpmListTokens', 'routerNpmRevokeToken', 'routerNpmDeviceApprove', 'routerNotifyPairDevice'])('%s requires a browser identity', async name => {
    expect((await auth[name]({ headers: {}, body: {} })).status).toBe(401);
    expect(state.db.proxyCredential.push).not.toHaveBeenCalled();
});
test('npm tokens are only revealed once and only owners can revoke', async () => {
    const issued = await auth.routerNpmCreateToken(request());
    expect(issued.status).toBe(201);
    expect(issued.token).toBeTruthy();
    const listed = await auth.routerNpmListTokens(request());
    expect(JSON.stringify(listed)).not.toContain(issued.token);
    expect(JSON.stringify(listed)).not.toContain('tokenHash');
    state.db.proxyCredential[issued.tokenId].userId = 'someone-else';
    expect((await auth.routerNpmRevokeToken({ ...request(), params: { id: issued.tokenId } })).status).toBe(404);
    expect(state.db.proxyCredential[issued.tokenId].status).toBe('active');
    state.db.proxyCredential[issued.tokenId].userId = 'u1';
    expect(await auth.routerNpmRevokeToken({ ...request(), params: { id: issued.tokenId } })).toEqual({ ok: true });
    expect(await auth.onResolveProxyToken({ token: issued.token, scope: 'npm:read' })).toBeNull();
});
test('proxy verification enforces scope, revocation and per-credential budget', async () => {
    const issued = issueProxyToken();
    const record = await state.db.proxyCredential.push({ ...issued, userId: 'u1', scopes: '["npm:read"]', status: 'active', maxRequestsPerMinute: 1 });
    expect(await auth.onResolveProxyToken({ token: issued.token, scope: 'npm:publish' })).toBeNull();
    expect((await auth.onResolveProxyToken({ token: issued.token, scope: 'npm:read' })).userId).toBe('u1');
    expect(await auth.onResolveProxyToken({ token: issued.token, scope: 'npm:read' })).toBeNull();
    record.status = 'revoked';
    expect(await auth.onResolveProxyToken({ token: issued.token })).toBeNull();
});
test('legacy plaintext tokens are opt-in and never gain npm privileges', async () => {
    state.db.user.u1.llmProxyToken = 'legacy';
    vi.stubEnv('AUTH_ENV_ALLOW_LEGACY_PROXY_TOKEN', '0');
    expect(await auth.onResolveProxyToken({ token: 'legacy' })).toBeNull();
    vi.stubEnv('AUTH_ENV_ALLOW_LEGACY_PROXY_TOKEN', '1');
    expect(await auth.onResolveProxyToken({ token: 'legacy', scope: 'npm:read' })).toBeNull();
    expect((await auth.onResolveProxyToken({ token: 'legacy', scope: 'llm:invoke' })).scopes).toEqual(['llm:invoke']);
});
test.each(['routerNpmAuthenticate', 'routerNpmAccess', 'routerNotifyAuthorize'])('%s denies absent or incorrect service secrets', async name => {
    vi.stubEnv('AUTH_ENV_VERDACCIO_SERVICE_TOKEN', 'service-secret');
    vi.stubEnv('AUTH_ENV_NTFY_SERVICE_TOKEN', 'service-secret');
    for (const authorization of ['', 'Bearer wrong']) expect((await auth[name]({ headers: { authorization }, body: {} })).status).toBe(401);
});
test('device flow waits for approval and consumes a code once', async () => {
    const start = await auth.routerNpmDeviceStart(request());
    const poll = { body: { deviceCode: start.deviceCode } };
    expect(await auth.routerNpmDevicePoll(poll)).toEqual({ status: 202, pending: true });
    expect(await auth.routerNpmDeviceApprove({ ...request(), query: { code: start.deviceCode } })).toMatchObject({ ok: true });
    expect(await auth.routerNpmDevicePoll(poll)).toMatchObject({ username: 'alice', token: expect.any(String) });
    expect((await auth.routerNpmDevicePoll(poll)).status).toBe(400);
    expect(state.db.proxyCredential.push).toHaveBeenCalledTimes(1);
});
test.each(['routerPermissionsOverview', 'routerPermissionsCreateGroup', 'routerPermissionsDeleteGroup', 'routerPermissionsCreateGrant', 'routerPermissionsDeleteGrant', 'routerPermissionsAudit'])('%s denies anonymous access before accessing administration data', async name => {
    await expect(auth[name]({ headers: {}, body: {}, query: {} })).rejects.toMatchObject({ status: 403 });
});

test.each(['auth.save-registration', 'auth.create-invite', 'auth.revoke-invite'])('retired System action %s cannot mutate state', async action => {
    const result = await auth.systemAction({ user: { id: 'u1' }, body: { action, values: { registrationEnabled: true } } });
    expect(result.status).toBe(404);
    expect(state.db.user.push).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
});
test('boot preserves legacy tenant records without timers, fetch or product events', async () => {
    for (const name of ['INITIAL_AUTH_USER', 'INITIAL_AUTH_EMAIL', 'INITIAL_AUTH_PASSWORD']) vi.stubEnv(name, '');
    Object.assign(state.db.user.u1, { tenantId: 'legacy', tenantStatus: 'pending', emailVerified: false, welcomeCreditStatus: 'pending', accountType: 'develop' });
    const before = { ...state.db.user.u1 };
    const timer = vi.spyOn(globalThis, 'setInterval');
    const network = vi.spyOn(globalThis, 'fetch');
    await auth.setupUser({});
    expect(state.db.user.u1).toMatchObject(before);
    expect(state.db.user.delete).not.toHaveBeenCalled();
    expect(timer).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
});
test('distributed app entry uses shared destination even for a legacy ready tenant', async () => {
    Object.assign(state.db.user.u1, { tenantId: 'legacy', tenantDomain: 'legacy.example.test', tenantStatus: 'ready' });
    state.db.appentitlement = table();
    const res = { redirect: vi.fn() };
    const network = vi.spyOn(globalThis, 'fetch');
    await auth.enterDistributedApp({ user: { id: 'u1' }, params: { app: 'lectio' } }, res);
    const { getDistributedApp } = await import('./app_flow.js');
    expect(res.redirect).toHaveBeenCalledWith(getDistributedApp('lectio').sharedView);
    expect(state.db.user.u1.tenantStatus).toBe('ready');
    expect(network).not.toHaveBeenCalled();
    expect(dispatchEvent).not.toHaveBeenCalled();
});
test('legacy registration settings cannot reopen public registration', async () => {
    state.db.authsettings = table([{ id: 'default', registrationEnabled: true, invitationsEnabled: true }]);
    expect(await auth.initialSetupStatus({})).toEqual({ initialSetupRequired: false, settings: { registrationEnabled: false, invitationsEnabled: false } });
});

test.each(['POST', 'DELETE', 'PUT'])('gate refuses anonymous %s API calls without redirect or continuation', async method => {
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn(), redirect: vi.fn() };
    const next = vi.fn();
    await auth.accessGate({ method, path: '/private/api', headers: {} }, res, next);
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'UNAUTHENTICATED' }));
    expect(res.redirect).not.toHaveBeenCalled();
    expect(next).not.toHaveBeenCalled();
});
test('retired identities cannot use public routes', async () => {
    state.db.user.u1.accountType = 'local';
    const res = { status: vi.fn().mockReturnThis(), json: vi.fn() };
    const next = vi.fn();
    await auth.accessGate({ ...request(), method: 'GET', path: '/auth/login' }, res, next);
    expect(res.status).toHaveBeenCalledWith(410);
    expect(next).not.toHaveBeenCalled();
});
test('delegated session refuses unrelated routes even for an administrator', async () => {
    state.db.user.u1.role = 'admin';
    state.db.session.s1.delegatedSubject = 'limited';
    state.db.session.s1.delegatedCapabilities = '["machines.view"]';
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    const next = vi.fn();
    await auth.accessGate({ ...request(), method: 'POST', path: '/private/admin' }, res, next);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
});

test('System reports a denied mutation as an error without a success notice', async () => {
    const result = await auth.systemAction({ user: { id: 'u1' }, body: { action: 'auth.delete-user', values: { userId: 'u1' } } });
    expect(result.status).toBe(403);
    expect(result.error).toMatch(/administradores/);
    expect(result).not.toHaveProperty('notice');
    expect(state.db.user.delete).not.toHaveBeenCalled();
});
test.each(['allow', 'deny'])('CNPJ gate applies the canonical %s permission decision', async effect => {
    state.db.permissionMembership = table();
    state.db.permissionGroup = table();
    state.db.permissionGrant = table([{ subjectType: 'user', subjectId: 'u1', permission: 'cnpj-scraper.read', effect }]);
    state.db.appentitlement = table();
    const res = { redirect: vi.fn(), status: vi.fn().mockReturnThis(), send: vi.fn() };
    const next = vi.fn();
    await auth.accessGate({ ...request(), method: 'GET', path: '/cnpj-scraper/search' }, res, next);
    expect(next).toHaveBeenCalledTimes(effect === 'allow' ? 1 : 0);
    if (effect === 'deny') expect(res.redirect).toHaveBeenCalledWith('/');
});
