import { describe, expect, it, vi } from 'vitest';
import { resolveGoogleUser } from './google_user.js';

function userStore(initial = []) {
    const users = initial.map((user) => ({ ...user }));
    return {
        users,
        findOne: vi.fn(async (where) => users.find((user) => (
            Object.entries(where).every(([key, value]) => user[key] === value)
        )) || null),
        push: vi.fn(async (data) => {
            const user = { id: `user-${users.length + 1}`, ...data };
            users.push(user);
            return user;
        }),
    };
}

const claims = {
    sub: 'google-sub-1',
    email: 'Maria.Silva@example.com',
    email_verified: true,
    name: 'Maria Silva',
    picture: 'https://example.com/maria.jpg',
};

describe('resolveGoogleUser', () => {
    it('cria uma conta normal no primeiro login Google', async () => {
        const store = userStore();

        const result = await resolveGoogleUser(store, claims, {
            passwordHash: 'hash-interno-aleatorio',
        });

        expect(result.created).toBe(true);
        expect(result.user).toMatchObject({
            name: 'Maria Silva',
            email: 'maria.silva@example.com',
            username: 'maria-silva',
            password: 'hash-interno-aleatorio',
            googleSub: 'google-sub-1',
            avatarUrl: 'https://example.com/maria.jpg',
            emailVerified: true,
            role: 'user',
            accountType: 'normal',
            inviteBalance: 0,
            tenantStatus: 'pending',
        });
        expect(store.push).toHaveBeenCalledTimes(1);
    });

    it('adiciona sufixo ao username derivado quando ele já existe', async () => {
        const store = userStore([{ id: 'existing', username: 'maria-silva' }]);

        const result = await resolveGoogleUser(store, claims, { passwordHash: 'hash' });

        expect(result.user.username).toBe('maria-silva-2');
    });

    it('vincula por e-mail verificado uma conta existente', async () => {
        const existing = {
            id: 'existing',
            email: claims.email.toLowerCase(),
            username: 'maria',
            avatarUrl: null,
        };
        const store = userStore([existing]);

        const result = await resolveGoogleUser(store, claims, { passwordHash: 'hash' });

        expect(result.created).toBe(false);
        expect(result.user).toMatchObject({
            id: 'existing',
            googleSub: claims.sub,
            emailVerified: true,
            avatarUrl: claims.picture,
        });
        expect(store.push).not.toHaveBeenCalled();
    });

    it('reutiliza googleSub e não duplica a conta em logins seguintes', async () => {
        const store = userStore([{
            id: 'existing',
            email: claims.email.toLowerCase(),
            username: 'maria',
            googleSub: claims.sub,
        }]);

        const first = await resolveGoogleUser(store, claims, { passwordHash: 'hash-1' });
        const second = await resolveGoogleUser(store, claims, { passwordHash: 'hash-2' });

        expect(first.user.id).toBe('existing');
        expect(second.user.id).toBe('existing');
        expect(store.push).not.toHaveBeenCalled();
    });
});
