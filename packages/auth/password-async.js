import { pbkdf2, randomBytes, timingSafeEqual } from 'node:crypto';

// Leave room in the shared libuv pool for HTTP filesystem operations.
let active = 0;
const waiting = [];
async function derive(password, salt, iterations) {
    if (waiting.length >= 256) throw Object.assign(new Error('Password service is busy; retry shortly.'), { status: 503 });
    if (active >= 2) await new Promise(resolve => waiting.push(resolve));
    else active++;
    try {
        return await new Promise((resolve, reject) => {
            pbkdf2(password, salt, iterations, 64, 'sha512', (error, key) => error ? reject(error) : resolve(key));
        });
    } finally {
        const next = waiting.shift();
        if (next) next(); else active--;
    }
}

export async function hashPasswordAsync(password) {
    const salt = randomBytes(16).toString('hex');
    const key = await derive(password, salt, 10000);
    return `${salt}:10000:${key.toString('hex')}`;
}

export async function verifyPasswordAsync(password, stored) {
    if (typeof password !== 'string' || typeof stored !== 'string') return false;
    const [salt, rounds, hex] = stored.split(':');
    const iterations = Number(rounds);
    if (!salt || !Number.isSafeInteger(iterations) || iterations < 1 || !/^[a-f0-9]{128}$/i.test(hex || '')) return false;
    try {
        const key = await derive(password, salt, iterations);
        return timingSafeEqual(Buffer.from(hex, 'hex'), key);
    } catch (error) { if (error.status === 503) throw error; return false; }
}
