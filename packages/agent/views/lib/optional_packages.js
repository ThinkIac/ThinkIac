export function availablePackageNames(apps) {
    const names = new Set();
    if (!Array.isArray(apps)) return names;
    for (const app of apps) {
        const packageName = String(app?.packageName ?? "").trim();
        if (packageName) names.add(packageName);
    }
    return names;
}

export function hasPackage(apps, packageName) {
    return availablePackageNames(apps).has(String(packageName ?? "").trim());
}
