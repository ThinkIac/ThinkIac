import { getDistributedApp } from '../app_flow.js';
export function isRetiredLocalAccount(user) {
    return user?.accountType === 'local';
}

export function activeEntitlements(db, userId) {
    return (db.appentitlement.query({ userId, status: 'active' }) || [])
        .map((item) => item.appSlug)
        .filter((slug) => getDistributedApp(slug));
}

export async function ensureEntitlement(db, userId, appSlug, source = 'public-flow') {
    const app = getDistributedApp(appSlug);
    if (!app) return null;
    const id = `${userId}:${app.slug}`;
    const existing = db.appentitlement[id] || db.appentitlement.findOne({ userId, appSlug: app.slug });
    if (existing) {
        existing.status = 'active';
        return existing;
    }
    try {
        return await db.appentitlement.push({ id, userId, appSlug: app.slug, status: 'active', source });
    } catch (error) {
        // Duas abas podem adquirir o app ao mesmo tempo. O id determinístico
        // transforma a corrida em leitura idempotente, não em dois vínculos.
        const raced = db.appentitlement[id];
        if (raced) return raced;
        throw error;
    }
}
