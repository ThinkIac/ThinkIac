import { createHash } from 'node:crypto';

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 10;
const stores = new WeakMap();

export function loginAttemptStore(connection) {
    if (stores.has(connection)) return stores.get(connection);

    connection.exec(`
        CREATE TABLE IF NOT EXISTS auth_login_attempts (
            email_hash TEXT PRIMARY KEY,
            attempts INTEGER NOT NULL,
            expires_at INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS auth_login_attempts_expiry
            ON auth_login_attempts (expires_at);
    `);
    const prune = connection.prepare('DELETE FROM auth_login_attempts WHERE expires_at <= ?');
    const read = connection.prepare('SELECT attempts, expires_at FROM auth_login_attempts WHERE email_hash = ?');
    const increment = connection.prepare(`
        INSERT INTO auth_login_attempts (email_hash, attempts, expires_at) VALUES (?, 1, ?)
        ON CONFLICT(email_hash) DO UPDATE SET attempts = attempts + 1
    `);
    const refund = connection.prepare(`
        UPDATE auth_login_attempts SET attempts = attempts - 1
        WHERE email_hash = ? AND expires_at = ? AND attempts > 0
    `);
    const reserve = connection.transaction((email) => {
        const now = Date.now();
        const key = createHash('sha256').update(email).digest('hex');
        prune.run(now);
        const current = read.get(key);
        if (current?.attempts >= MAX_ATTEMPTS) {
            return { retryAfter: Math.ceil((current.expires_at - now) / 1000) };
        }
        const expiresAt = current?.expires_at ?? now + WINDOW_MS;
        increment.run(key, expiresAt);
        return { key, expiresAt };
    });
    const store = {
        reserve: email => reserve.immediate(email),
        refund: ({ key, expiresAt }) => refund.run(key, expiresAt),
    };
    stores.set(connection, store);
    return store;
}
