import crypto from 'node:crypto';

export const EMAIL_VERIFICATION_TTL_MS = 15 * 60 * 1000;

const digest = (value) => crypto.createHash('sha256').update(String(value)).digest('hex');
const safeEqual = (left, right) => {
    const a = Buffer.from(String(left || ''));
    const b = Buffer.from(String(right || ''));
    return a.length === b.length && crypto.timingSafeEqual(a, b);
};

export function createEmailVerification({ userId, email, now = new Date(), ttlMs = EMAIL_VERIFICATION_TTL_MS } = {}) {
    const token = crypto.randomBytes(32).toString('base64url');
    const code = crypto.randomInt(0, 100_000_000).toString().padStart(8, '0');
    return {
        token,
        code,
        record: {
            userId,
            email: String(email || '').trim().toLowerCase(),
            tokenHash: digest(token),
            codeHash: digest(code),
            expiresAt: new Date(now.getTime() + ttlMs),
            consumed: false,
        },
    };
}

export function verificationTokenHash(token) {
    return digest(token);
}

export function verificationMatches(record, { token, code } = {}) {
    if (typeof token === 'string' && /^[A-Za-z0-9_-]{40,}$/.test(token)) {
        return safeEqual(record?.tokenHash, digest(token));
    }
    if (typeof code === 'string' && /^\d{8}$/.test(code)) {
        return safeEqual(record?.codeHash, digest(code));
    }
    return false;
}
