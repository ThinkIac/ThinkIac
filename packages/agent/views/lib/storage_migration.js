export function readMigratedStorage(storage, key, legacyKeys = []) {
    const current = storage?.getItem(key);
    if (current !== null && current !== undefined) return current;
    for (const legacyKey of legacyKeys) {
        const legacy = storage?.getItem(legacyKey);
        if (legacy === null || legacy === undefined) continue;
        storage.setItem(key, legacy);
        return legacy;
    }
    return null;
}
