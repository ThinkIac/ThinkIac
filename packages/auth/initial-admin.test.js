import { beforeEach, expect, test, vi } from 'vitest';

const { db } = vi.hoisted(() => ({ db: {} }));
vi.mock('logos', () => ({ getProxy: () => db, dispatchEvent: vi.fn(), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./email_delivery.js', () => ({ queueVerificationEmail: vi.fn() }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));

import { createInitialAdmin, initialSetupStatus } from './index.js';

function collection() {
    const rows = [];
    const store = {
        rows,
        all: () => rows,
        findOne: (query) => rows.find((row) => Object.entries(query).every(([key, value]) => row[key] === value)),
        async push(value) { const row = { id: String(rows.length + 1), ...value }; rows.push(row); store[row.id] = row; return row; },
    };
    return store;
}

function response() {
    const res = { setHeader: vi.fn(), status: vi.fn(() => res), send: vi.fn() };
    return res;
}

beforeEach(() => {
    db.user = collection();
    db.session = collection();
});

test('empty Runtime exposes setup and creates one signed-in administrator', async () => {
    await expect(initialSetupStatus({})).resolves.toEqual({ initialSetupRequired: true });
    const res = response();
    await expect(createInitialAdmin({ body: { name: 'Ada Admin', email: 'ada@example.test', username: 'ada-admin', password: 'a secure password' } }, res)).resolves.toMatchObject({ success: true, role: 'admin', initialSetup: true });
    expect(db.user.rows).toHaveLength(1);
    expect(db.user.rows[0]).toMatchObject({ role: 'admin', emailVerified: true, tenantStatus: null });
    expect(db.session.rows).toHaveLength(1);
    expect(res.setHeader).toHaveBeenCalledWith('Set-Cookie', expect.any(String));
    await expect(initialSetupStatus({})).resolves.toEqual({ initialSetupRequired: false });
});

test('initial administrator endpoint closes as soon as a user exists', async () => {
    await db.user.push({ id: 'existing', role: 'user' });
    const res = response();
    await createInitialAdmin({ body: { name: 'Ada', email: 'ada@example.test', username: 'ada-admin', password: 'a secure password' } }, res);
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.send).toHaveBeenCalledWith({ error: 'Initial setup is no longer available.' });
});
