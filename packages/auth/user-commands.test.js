import { beforeEach, expect, test, vi } from 'vitest';
vi.mock('logos', () => ({ getProxy: vi.fn(), dispatchEvent: vi.fn(), isPublicRoute: () => false, isPublicView: () => false }));
vi.mock('./mcp-auth.js', () => ({ createMcpAuth: () => ({}) }));
import { manageUserCommand } from './index.js';
import { verifyPasswordAsync } from './password-async.js';
let db, rows, audit, sessions;
beforeEach(() => {
    rows = []; audit = []; sessions = [];
    const user = { all: () => rows, push: async data => { const item = { id: String(rows.length + 1), ...data }; rows.push(item); user[item.id] = item; return item; } };
    db = { user, permissionAudit: { push: async entry => audit.push(entry) }, session: { query: ({ userId }) => sessions.filter(s => s.userId === userId), delete: async id => { sessions.splice(sessions.findIndex(s => s.id === id), 1); } } };
});
const input = { AUTH_USER_USERNAME: 'alice', AUTH_USER_EMAIL: 'alice@example.test', AUTH_USER_PASSWORD: 'a long secure password' };
test('creates, lists and reads without exposing credentials', async () => {
    const created = await manageUserCommand(db, 'create', input);
    expect(created.user).not.toHaveProperty('password');
    expect(await verifyPasswordAsync(input.AUTH_USER_PASSWORD, rows[0].password)).toBe(true);
    expect(await manageUserCommand(db, 'list')).toEqual({ users: [created.user] });
    expect(await manageUserCommand(db, 'get', { AUTH_USER_ID: created.user.id })).toEqual(created);
    expect(JSON.stringify(audit)).not.toContain(input.AUTH_USER_PASSWORD);
});
test('validates all changes before mutation and rejects duplicates', async () => {
    await manageUserCommand(db, 'create', input);
    await expect(manageUserCommand(db, 'create', input)).rejects.toThrow(/registered/);
    await expect(manageUserCommand(db, 'update', { AUTH_USER_ID: '1', AUTH_USER_NAME: 'Changed', AUTH_USER_EMAIL: 'bad' })).rejects.toThrow();
    expect(rows[0].name).toBe('alice');
});
test('protects the last active admin and revokes sessions on disable and password change', async () => {
    await manageUserCommand(db, 'create', { ...input, AUTH_USER_ROLE: 'admin' });
    await expect(manageUserCommand(db, 'disable', { AUTH_USER_ID: '1' })).rejects.toThrow(/last active/);
    await expect(manageUserCommand(db, 'update', { AUTH_USER_ID: '1', AUTH_USER_ROLE: 'user' })).rejects.toThrow(/last active/);
    await manageUserCommand(db, 'create', { ...input, AUTH_USER_USERNAME: 'bob', AUTH_USER_EMAIL: 'bob@example.test', AUTH_USER_ROLE: 'admin' });
    sessions.push({ id: 's1', userId: '1' });
    await manageUserCommand(db, 'disable', { AUTH_USER_ID: '1' });
    expect(rows[0].disabled).toBe(true); expect(sessions).toHaveLength(0);
    await expect(manageUserCommand(db, 'disable', { AUTH_USER_ID: '2' })).rejects.toThrow(/last active/);
    await manageUserCommand(db, 'enable', { AUTH_USER_ID: '1' });
    sessions.push({ id: 's2', userId: '1' });
    await manageUserCommand(db, 'update', { AUTH_USER_ID: '1', AUTH_USER_PASSWORD: 'another long password' });
    expect(sessions).toHaveLength(0);
});
