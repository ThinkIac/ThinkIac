/**
 * Resolve uma identidade Google já validada. O store é injetado para manter
 * esta decisão independente do runtime e diretamente testável.
 */
export async function resolveGoogleUser(userStore, claims, { autolink = true } = {}) {
    const email = String(claims.email || '').trim().toLowerCase();
    if (!email) throw new Error('Google identity is missing an email address');

    const bySub = await userStore.findOne({ googleSub: claims.sub });
    if (bySub) return { user: bySub, created: false };

    if (autolink) {
        const byEmail = await userStore.findOne({ email });
        if (byEmail) {
            if (byEmail.disabled || byEmail.accountType === 'local') return { user: byEmail, created: false };
            byEmail.googleSub = claims.sub;
            byEmail.emailVerified = true;
            if (!byEmail.avatarUrl && claims.picture) byEmail.avatarUrl = claims.picture;
            return { user: byEmail, created: false };
        }
    }

    return { user: null, created: false };
}
