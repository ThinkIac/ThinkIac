import { getProxy } from 'logos';
import { resolveUserIdFromBearer } from './credentials.js';
const ONBOARDING_FIELDS = ['assistantName', 'context', 'role', 'purpose', 'briefContext', 'audience'];
export async function saveOnboarding(req, res) {
    const db = getProxy('auth');
    const user = db.user[req.user.id];
    if (!user) return { status: 404, error: 'Usuário não encontrado.' };

    const patch = {};
    for (const field of ONBOARDING_FIELDS) {
        const value = req.body?.[field];
        if (typeof value === 'string' && value.trim()) patch[field] = value.trim().slice(0, 500);
    }

    user.onboarding = { ...(user.onboarding || {}), ...patch, part1UpdatedAt: new Date().toISOString() };

    return { status: 200, onboarding: user.onboarding };
}

export async function getOnboardingByProxyToken(req, res) {
    const userId = await resolveUserIdFromBearer(req);
    if (!userId) return { status: 401, error: 'Token inválido.' };

    const db = getProxy('auth');
    const user = db.user[userId];
    if (!user) return { status: 404, error: 'Usuário não encontrado.' };

    return { status: 200, onboarding: user.onboarding || null };

    return { userId: user.id };
}
