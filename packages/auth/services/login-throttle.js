import { isIP } from 'node:net';

function normalizeLoginAddress(address) {
    if (typeof address !== 'string' || address.includes('%')) return null;
    const family = isIP(address);
    if (family === 4) address = `::ffff:${address}`;
    if (!family) return null;
    return new URL(`http://[${address}]/`).hostname.slice(1, -1);
}

function loginClientAddress(req) {
    const peer = normalizeLoginAddress(req.socket?.remoteAddress);
    if (!peer) return 'unknown';
    const trustedProxies = process.env.AUTH_LOGIN_TRUSTED_PROXY_IPS?.split(',') || [];
    if (trustedProxies.some(address => normalizeLoginAddress(address.trim()) === peer)) {
        return normalizeLoginAddress(req.headers?.['x-real-ip']) || peer;
    }
    return peer;
}

const loginAttempts = new Map();

const LOGIN_WINDOW_MS = 15 * 60 * 1000;

export function allowLoginAttempt(req, now = Date.now()) {
    for (const [key, entry] of loginAttempts) if (entry.until <= now) loginAttempts.delete(key);
    const key = loginClientAddress(req);
    let entry = loginAttempts.get(key);
    if (!entry) {
        if (loginAttempts.size >= 10000) return false;
        entry = { count: 0, until: now + LOGIN_WINDOW_MS };
        loginAttempts.set(key, entry);
    }
    return ++entry.count <= 20;
}
