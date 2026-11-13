const RESERVED_USERNAMES = new Set([
    'www', 'admin', 'api', 'root', 'mail', 'ftp',
    'portainer', 'npm', 'proxy', 'gateway', 'static', 'cdn',
    'app', 'docker', 'localhost', 'thinkiac', 'ns1', 'ns2', 'auth', 'cloud',
]);

function usernameBaseFromEmail(email) {
    const localPart = String(email || '').split('@')[0];
    const normalized = localPart
        .normalize('NFKD')
        .replace(/[\u0300-\u036f]/g, '')
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-+|-+$/g, '');

    if (normalized.length >= 3) return normalized.slice(0, 63).replace(/-+$/g, '');
    return `user-${normalized || 'google'}`.slice(0, 63);
}

async function availableUsername(userStore, email) {
    const base = usernameBaseFromEmail(email);
    let suffix = RESERVED_USERNAMES.has(base) ? 2 : 1;

    while (true) {
        const suffixText = suffix === 1 ? '' : `-${suffix}`;
        const stem = base.slice(0, 63 - suffixText.length).replace(/-+$/g, '');
        const candidate = `${stem}${suffixText}`;
        const existing = await userStore.findOne({ username: candidate });
        if (!existing && !RESERVED_USERNAMES.has(candidate)) return candidate;
        suffix += 1;
    }
}

/**
 * Resolve uma identidade Google já validada. O store é injetado para manter
 * esta decisão independente do runtime e diretamente testável.
 */
export async function resolveGoogleUser(userStore, claims, { passwordHash, autolink = true } = {}) {
    const email = String(claims.email || '').trim().toLowerCase();
    if (!email) throw new Error('Google identity is missing an email address');

    const bySub = await userStore.findOne({ googleSub: claims.sub });
    if (bySub) return { user: bySub, created: false };

    if (autolink) {
        const byEmail = await userStore.findOne({ email });
        if (byEmail) {
            byEmail.googleSub = claims.sub;
            byEmail.emailVerified = true;
            if (!byEmail.avatarUrl && claims.picture) byEmail.avatarUrl = claims.picture;
            return { user: byEmail, created: false };
        }
    }

    const storedPassword = typeof passwordHash === 'function' ? await passwordHash() : await passwordHash;
    if (!storedPassword) throw new Error('passwordHash é obrigatório para criar usuário Google');

    const username = await availableUsername(userStore, email);
    const user = await userStore.push({
        name: claims.name || email.split('@')[0],
        email,
        username,
        password: storedPassword,
        googleSub: claims.sub,
        avatarUrl: claims.picture || null,
        emailVerified: true,
        role: 'user',
        accountType: 'normal',
        inviteBalance: 0,
        tenantStatus: 'pending',
    });

    return { user, created: true };
}
