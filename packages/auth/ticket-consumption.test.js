import { afterEach, expect, test, vi } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import TableProxy from '../../vendor/packages/scriba/src/TableProxy.js';
const { state } = vi.hoisted(() => ({ state: { db: null } }));
vi.mock('logos', () => ({ getProxy: () => state.db }));
vi.mock('./services/browser-sessions.js', () => ({
    AUTHENTICATED_HOME: '/redirect/home',
    startSession: vi.fn(async () => {}),
    sessionCookie: () => 'session-cookie',
}));
import { startSession } from './services/browser-sessions.js';
import { ticket } from './services/login-tickets.js';
import { consumeDelegatedTicket } from './services/delegated-sessions.js';
const connections = [];
const directories = [];
afterEach(() => {
    connections.splice(0).forEach(db => db.close());
    directories.splice(0).forEach(dir => rmSync(dir, { recursive: true, force: true }));
    vi.clearAllMocks();
});
function fixture(delegated = false) {
    const dir = mkdtempSync(join(tmpdir(), 'auth-ticket-'));
    directories.push(dir);
    const dbs = [0, 1].map(() => new Database(join(dir, 'auth.sqlite')));
    connections.push(...dbs);
    const name = delegated ? 'delegatedTicket' : 'loginticket';
    dbs[0].exec(`CREATE TABLE "${name}" (id TEXT PRIMARY KEY, token TEXT, tokenHash TEXT, userId TEXT, consumed INTEGER, expiresAt TEXT, capabilities TEXT, subject TEXT, redirectPath TEXT)`);
    dbs[0].prepare(`INSERT INTO "${name}" VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        't1', 'ticket', createHash('sha256').update('ticket').digest('hex'), 'u1', 0,
        new Date(Date.now() + 60000).toISOString(), '["git.view"]', 'subject', '/view/git-cloud/Index');
    const stores = dbs.map(db => new TableProxy(db, name, [], null, null));
    const session = { push: vi.fn(async () => ({ id: 's1' })) };
    state.db = { [name]: stores[0], user: { u1: { id: 'u1' } }, session };
    return { stores, session, name };
}
const response = () => ({ redirect: vi.fn(value => value), setHeader: vi.fn() });
test.each([false, true])('only one concurrent exchange wins across SQLite connections, delegated=%s', async delegated => {
    const { stores, session, name } = fixture(delegated);
    // Both requests read the ticket before either DELETE executes.
    let ready = 0;
    let release;
    const barrier = new Promise(resolve => { release = resolve; });
    for (const store of stores) store.addHook('beforeDelete', async () => {
        if (++ready === 2) release();
        await barrier;
    });
    const pending = [];
    let reads = 0;
    const routingStore = {
        findOne: filter => {
            const store = stores[reads++];
            pending.push(store);
            return store.findOne(filter);
        },
        delete: id => pending.shift().delete(id),
    };
    state.db[name] = routingStore;
    const responses = [response(), response()];
    const consume = delegated ? consumeDelegatedTicket : ticket;
    const results = await Promise.all(responses.map(res => consume({ query: { ticket: 'ticket' } }, res)));
    expect(results.filter(value => value === (delegated ? '/view/git-cloud/Index' : '/redirect/home'))).toHaveLength(1);
    expect(results).toContain(delegated ? '/auth/login' : '/view/auth/Login?erro=ticket-invalido');
    expect(delegated ? session.push : startSession).toHaveBeenCalledTimes(1);
    expect(stores[0].findOne({ id: 't1' })).toBeFalsy();
});
test.each([false, true])('storage failure denies exchange, delegated=%s', async delegated => {
    const { stores, session, name } = fixture(delegated);
    state.db[name] = { findOne: filter => stores[0].findOne(filter), delete: async () => { throw new Error('storage unavailable'); } };
    const res = response();
    expect(await (delegated ? consumeDelegatedTicket : ticket)({ query: { ticket: 'ticket' } }, res)).toBe(delegated ? '/auth/login' : '/view/auth/Login?erro=ticket-invalido');
    expect(session.push).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
});
test.each([false, true])('a delete hook veto denies exchange, delegated=%s', async delegated => {
    const { stores, session } = fixture(delegated);
    stores[0].addHook('beforeDelete', () => false);
    const res = response();
    await (delegated ? consumeDelegatedTicket : ticket)({ query: { ticket: 'ticket' } }, res);
    expect(session.push).not.toHaveBeenCalled();
    expect(startSession).not.toHaveBeenCalled();
    expect(res.setHeader).not.toHaveBeenCalled();
});
