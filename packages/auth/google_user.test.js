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
    it('never creates a new identity, even when given creation credentials', async () => {
        const store = userStore();
        expect(await resolveGoogleUser(store, claims, { passwordHash: 'hash' })).toEqual({ user: null, created: false });
        expect(store.push).not.toHaveBeenCalled();
    });
    it('does not link by email when autolink is disabled', async () => {
        const store = userStore([{ id: 'existing', email: claims.email.toLowerCase() }]);
        expect((await resolveGoogleUser(store, claims, { autolink: false })).user).toBeNull();
        expect(store.users[0].googleSub).toBeUndefined();
        expect(store.push).not.toHaveBeenCalled();
    });
    it.each([{ disabled: true }, { accountType: 'local' }])('does not mutate blocked identity %j', async blocked => {
        const store = userStore([{ id: 'existing', email: claims.email.toLowerCase(), ...blocked }]);
        await resolveGoogleUser(store, claims);
        expect(store.users[0].googleSub).toBeUndefined();
        expect(store.users[0].emailVerified).toBeUndefined();
        expect(store.push).not.toHaveBeenCalled();
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
