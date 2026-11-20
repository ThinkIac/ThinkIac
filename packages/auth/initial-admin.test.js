import { beforeEach, expect, test, vi } from 'vitest';
const { db } = vi.hoisted(() => ({ db: {} }));
vi.mock('logos', () => ({ getProxy: () => db, dispatchEvent: vi.fn(), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import { createInitialAdmin, initialSetupStatus, provisionInitialAdmin } from './index.js';
import { verifyPasswordAsync } from './password-async.js';
const env = { INITIAL_AUTH_USER: 'ada-admin', INITIAL_AUTH_EMAIL: 'ada@example.test', INITIAL_AUTH_PASSWORD: 'a secure password' };
beforeEach(() => {
    const rows = [];
    db.user = { rows, all: () => rows, push: async value => { rows.push(value); return value; } };
});
test('public endpoint always rejects, including after users are deleted', async () => {
    const res = { status: vi.fn().mockReturnThis(), send: vi.fn() };
    for (const rows of [[], [{ role: 'admin' }], []]) {
        db.user.rows.splice(0, db.user.rows.length, ...rows);
        await createInitialAdmin({ body: env }, res);
        expect(res.status).toHaveBeenLastCalledWith(403);
    }
    expect((await initialSetupStatus({})).initialSetupRequired).toBe(false);
});
test('local provisioning hashes password and never overwrites an admin', async () => {
    expect(await provisionInitialAdmin(db, env)).toEqual({ created: true });
    expect(db.user.rows[0]).toMatchObject({ role: 'admin', username: 'ada-admin', emailVerified: true });
    expect(db.user.rows[0].password).not.toBe(env.INITIAL_AUTH_PASSWORD);
    expect(await verifyPasswordAsync(env.INITIAL_AUTH_PASSWORD, db.user.rows[0].password)).toBe(true);
    expect(await provisionInitialAdmin(db, env)).toEqual({ created: false });
    expect(db.user.rows).toHaveLength(1);
});
test('partial credentials, invalid values and existing accounts fail closed', async () => {
    await expect(provisionInitialAdmin(db, { INITIAL_AUTH_USER: 'ada' })).rejects.toThrow();
    await expect(provisionInitialAdmin(db, { ...env, INITIAL_AUTH_PASSWORD: 'short' })).rejects.toThrow();
    db.user.rows.push({ email: env.INITIAL_AUTH_EMAIL, role: 'user' });
    await expect(provisionInitialAdmin(db, env)).rejects.toThrow(/already in use/);
    expect(db.user.rows).toHaveLength(1);
});
