import { hashPasswordAsync } from '../password-async.js';

const USERNAME_RE = /^[a-z0-9]([a-z0-9-]{1,61}[a-z0-9])?$/;

const RESERVED_USERNAMES = new Set([
    'www', 'admin', 'api', 'root', 'mail', 'ftp',
    'portainer', 'npm', 'proxy', 'gateway', 'static', 'cdn',
    'app', 'docker', 'localhost', 'thinkiac', 'ns1', 'ns2', 'auth', 'cloud',
]);

export function validateUsername(raw) {
    const username = String(raw || '').trim().toLowerCase();
    if (username.length < 3 || username.length > 63) {
        return { valid: false, reason: 'O usuário deve ter entre 3 e 63 caracteres.' };
    }
    if (!USERNAME_RE.test(username)) {
        return { valid: false, reason: 'Use apenas letras minúsculas, números e hífen (sem começar/terminar com hífen).' };
    }
    if (RESERVED_USERNAMES.has(username)) {
        return { valid: false, reason: 'Esse usuário é reservado.' };
    }
    return { valid: true, username };
}

export async function provisionInitialAdmin(db, env = process.env) {
    const rawUsername = env.INITIAL_AUTH_USER;
    const password = env.INITIAL_AUTH_PASSWORD;
    if (!rawUsername && !password && !env.INITIAL_AUTH_EMAIL) return { created: false };
    if (!rawUsername || !password || !env.INITIAL_AUTH_EMAIL) {
        throw new Error('Set INITIAL_AUTH_USER, INITIAL_AUTH_EMAIL and INITIAL_AUTH_PASSWORD together.');
    }
    const users = await db.user.all();
    if (users.some(user => user.role === 'admin')) return { created: false };
    const { valid, username, reason } = validateUsername(rawUsername);
    if (!valid) throw new Error(reason);
    const email = String(env.INITIAL_AUTH_EMAIL).trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof password !== 'string' || password.length < 12) {
        throw new Error('A valid INITIAL_AUTH_EMAIL and a password of at least 12 characters are required.');
    }
    if (users.some(user => String(user.email || '').toLowerCase() === email || String(user.username || '').toLowerCase() === username)) {
        throw new Error('The configured initial administrator email or username is already in use.');
    }
    await db.user.push({ name: String(env.INITIAL_AUTH_NAME || username).trim(), email, username,
        password: await hashPasswordAsync(password), role: 'admin', inviteBalance: 0,
        emailVerified: true, tenantStatus: null });
    return { created: true };
}

export async function manageUserCommand(db, operation, env = process.env) {
    const users = await db.user.all();
    const id = String(env.AUTH_USER_ID || '').trim();
    const view = user => ({ id: user.id, name: user.name, email: user.email, username: user.username, role: user.role, disabled: !!user.disabled });
    if (operation === 'list') return { users: users.map(view) };
    const target = id && db.user[id];
    if (operation === 'get') {
        if (!target) throw new Error('User not found. Set AUTH_USER_ID.');
        return { user: view(target) };
    }
    if (operation !== 'create' && !target) throw new Error('User not found. Set AUTH_USER_ID.');
    const changes = {};
    const editing = operation === 'create' || operation === 'update';
    if (editing && (operation === 'create' || env.AUTH_USER_USERNAME !== undefined)) {
        const validation = validateUsername(env.AUTH_USER_USERNAME);
        if (!validation.valid) throw new Error(validation.reason);
        changes.username = validation.username;
    }
    if (editing && (operation === 'create' || env.AUTH_USER_EMAIL !== undefined)) {
        changes.email = String(env.AUTH_USER_EMAIL || '').trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(changes.email)) throw new Error('A valid AUTH_USER_EMAIL is required.');
    }
    if (editing && env.AUTH_USER_NAME !== undefined) changes.name = String(env.AUTH_USER_NAME).trim() || null;
    if (editing && (operation === 'create' || env.AUTH_USER_ROLE !== undefined)) {
        changes.role = env.AUTH_USER_ROLE || 'user';
        if (!['user', 'admin'].includes(changes.role)) throw new Error('Invalid AUTH_USER_ROLE.');
    }
    if (editing && (operation === 'create' || env.AUTH_USER_PASSWORD !== undefined)) {
        if (typeof env.AUTH_USER_PASSWORD !== 'string' || env.AUTH_USER_PASSWORD.length < 12) throw new Error('AUTH_USER_PASSWORD must contain at least 12 characters.');
        changes.password = await hashPasswordAsync(env.AUTH_USER_PASSWORD);
    }
    for (const field of ['email', 'username']) {
        if (changes[field] && users.some(u => u.id !== target?.id && String(u[field] || '').toLowerCase() === changes[field])) throw new Error(`${field} is already registered.`);
    }
    if (!['create', 'update', 'disable', 'enable'].includes(operation)) throw new Error('Invalid operation.');
    if (target && target.role === 'admin' && !target.disabled && (operation === 'disable' || changes.role === 'user')) {
        if (!users.some(u => u.id !== target.id && u.role === 'admin' && !u.disabled)) throw new Error('Cannot remove the last active administrator.');
    }
    if (operation === 'update' && !Object.keys(changes).length) throw new Error('No changes supplied.');
    let user = target;
    if (operation === 'create') user = await db.user.push({ ...changes, name: changes.name || changes.username, emailVerified: true });
    else {
        if (operation === 'disable') changes.disabled = true;
        if (operation === 'enable') changes.disabled = false;
        Object.assign(target, changes);
    }
    if (target && (operation === 'disable' || changes.password)) {
        for (const session of await db.session.query({ userId: target.id })) await db.session.delete(session.id);
    }
    await db.permissionAudit.push({ actorId: 'local-cli', action: `user.${operation}`, subjectType: 'user', subjectId: user.id });
    return { user: view(user) };
}
