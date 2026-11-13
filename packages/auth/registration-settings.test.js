import { beforeEach, expect, test, vi } from 'vitest';

const { db, dispatch, mail } = vi.hoisted(() => ({ db: {}, dispatch: vi.fn(), mail: vi.fn() }));
vi.mock('logos', () => ({ getProxy: () => db, dispatchEvent: dispatch, isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./email_delivery.js', () => ({ queueVerificationEmail: mail }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));

import { createInvite, register, updateSettings } from './index.js';

function collection() {
    const rows = [];
    const store = {
        rows,
        findOne: (query) => rows.find((row) => Object.entries(query).every(([key, value]) => row[key] === value)),
        async push(value) { const row = { ...value }; rows.push(row); store[row.id] = row; return row; },
    };
    return store;
}

function response() {
    const res = { status: vi.fn(() => res), send: vi.fn() };
    return res;
}

beforeEach(() => {
    vi.clearAllMocks();
    db.user = collection();
    db.authsettings = collection();
    db.invite = collection();
});

test('registration setting blocks public account creation', async () => {
    await db.authsettings.push({ id: 'default', registrationEnabled: false, invitationsEnabled: true });
    const res = response();
    await register({ body: { email: 'person@example.test', username: 'person', password: 'password' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ error: 'Registration is currently disabled.' });
});

test('admins persist and enforce invitation availability', async () => {
    await db.user.push({ id: 'admin', role: 'admin' });
    const saved = await updateSettings({ user: { id: 'admin' }, body: { registrationEnabled: true, invitationsEnabled: false } });
    expect(saved.settings).toEqual({ registrationEnabled: true, invitationsEnabled: false, defaultRolePackage: null, defaultRoleGroup: null });
    await expect(createInvite({ user: { id: 'admin' } })).resolves.toMatchObject({ status: 403 });
});

test('closing registration also closes invitations', async () => {
    await db.user.push({ id: 'admin', role: 'admin' });
    const saved = await updateSettings({ user: { id: 'admin' }, body: { registrationEnabled: false, invitationsEnabled: true } });
    expect(saved.settings).toEqual({ registrationEnabled: false, invitationsEnabled: false });
    await expect(createInvite({ user: { id: 'admin' } })).resolves.toMatchObject({ status: 403 });
});

test('closed registration accepts only a valid invitation code', async () => {
    await db.authsettings.push({ id: 'default', registrationEnabled: false, invitationsEnabled: true });
    const res = response();
    await register({ body: { email: 'person@example.test', username: 'person', password: 'password' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ error: 'A valid invitation code is required.' });
});
