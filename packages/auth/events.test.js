import { beforeEach, expect, test, vi } from 'vitest';
const { state } = vi.hoisted(() => ({ state: {} }));
vi.mock('logos', () => ({ getProxy: () => state.db }));
import { resolvePrincipal, checkPermission } from './events.js';
import { identityProvider } from './services/identity.js';

beforeEach(() => {
    state.db = { user: { admin: { id: 'admin', role: 'admin', password: 'secret' }, user: { id: 'user', role: 'user' } },
        session: { s: { id: 's', userId: 'admin', expiresAt: new Date(Date.now()+60000) } },
        permissionMembership: { query: () => [] }, permissionGrant: { query: () => [] }, permissionGroup: { query: () => [] } };
});
const req = () => ({ headers: { cookie: 'sessionId=s' } });
test('event and HTTP provider return the same principal without credentials', async () => {
    const principal = await resolvePrincipal({ req: req() });
    expect(principal).toEqual((await identityProvider.resolve(req())).principal);
    expect(JSON.stringify(principal)).not.toContain('secret');
});
test('context request takes precedence over caller payload', async () => {
    expect(await resolvePrincipal({ req: req() }, { req: {} })).toBeNull();
    expect((await checkPermission({ req: req(), permission: 'auth.users.read' }, { req: {} })).status).toBe(401);
});
test('forged principals and anonymous authorization fail closed', async () => {
    expect(await resolvePrincipal({ principal: { subject: 'admin' } })).toBeNull();
    expect((await checkPermission({ principal: { subject: 'admin' }, permission: 'auth.users.write' })).status).toBe(401);
});
test('permission event applies canonical admin and regular-user decisions', async () => {
    expect((await checkPermission({ req: req(), permission: 'auth.users.write' })).allowed).toBe(true);
    state.db.session.s.userId = 'user';
    expect((await checkPermission({ req: req(), permission: 'auth.users.write' })).status).toBe(403);
});
test('disabled users and expired sessions cannot authorize', async () => {
    state.db.user.admin.disabled = true;
    expect((await checkPermission({ req: req(), permission: 'auth.users.write' })).status).toBe(401);
    state.db.user.admin.disabled = false;
    state.db.session.s.expiresAt = new Date(0);
    expect(await resolvePrincipal({ req: req() })).toBeNull();
});
test.each([undefined, '', '   ', {}])('invalid permission %s denies access', async permission => {
    expect((await checkPermission({ req: req(), permission })).status).toBe(403);
});

test('delegated admin sessions cannot widen route capabilities through the permission event', async () => {
    state.db.session.s.delegatedSubject = 'service';
    state.db.session.s.delegatedCapabilities = '["packages:read"]';
    expect(await checkPermission({ req: req(), permission: 'auth.users.write' })).toMatchObject({ allowed: false, status: 403, reason: 'delegated_session' });
});
