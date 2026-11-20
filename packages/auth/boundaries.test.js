import { beforeEach, afterEach, expect, test, vi } from 'vitest';
const { state } = vi.hoisted(() => ({ state: { db: null } }));
vi.mock('logos', () => ({ getProxy: () => state.db, dispatchEvent: vi.fn(), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./email_delivery.js', () => ({ queueVerificationEmail: vi.fn() }));
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
