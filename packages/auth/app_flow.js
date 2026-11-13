const DISTRIBUTED_APPS = Object.freeze({
    lectio: Object.freeze({
        slug: 'lectio',
        package: 'lectio',
        tenantPackages: ['ocr', 'lectio'],
        sharedView: '/view/lectio/Index',
        tenantView: '/view/lectio/Index',
    }),
});

export function distributedApp(input = {}) {
    if (input?.flow !== 'app') return null;
    return DISTRIBUTED_APPS[String(input?.app || '').trim().toLowerCase()] || null;
}

export function getDistributedApp(slug) {
    return DISTRIBUTED_APPS[String(slug || '').trim().toLowerCase()] || null;
}

export function provisioningMode(appSlug) {
    return getDistributedApp(appSlug) ? 'deferred' : 'immediate';
}

export function appDestination(appSlug) {
    const app = getDistributedApp(appSlug);
    return app ? `/auth/apps/${app.slug}/enter` : null;
}

export function tenantPluginsFor(appSlugs = []) {
    return [...new Set(appSlugs.flatMap((slug) => getDistributedApp(slug)?.tenantPackages || []))];
}

export function pathBelongsToApp(path, appSlug) {
    const app = getDistributedApp(appSlug);
    if (!app) return false;
    return path === app.sharedView
        || path.startsWith(`/view/${app.package}/`)
        || path === `/${app.package}`
        || path.startsWith(`/${app.package}/`);
}
