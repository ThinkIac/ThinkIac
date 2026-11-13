import { readMigratedStorage } from "./storage_migration.js";

const KEY_PREFIX = "agent:composer-draft:";
const LEGACY_KEY_PREFIX = "aurora:composer-draft:";

function storageKey(sessionId) {
    return `${KEY_PREFIX}${encodeURIComponent(String(sessionId))}`;
}

function resolveStorage(storage) {
    if (storage !== undefined) return storage;
    return typeof localStorage === "undefined" ? null : localStorage;
}

export function loadComposerDraft(sessionId, storage) {
    if (!sessionId) return "";
    try {
        const target = resolveStorage(storage);
        return readMigratedStorage(target, storageKey(sessionId), [
            `${LEGACY_KEY_PREFIX}${encodeURIComponent(String(sessionId))}`,
        ]) ?? "";
    } catch {
        return "";
    }
}

export function saveComposerDraft(sessionId, text, storage) {
    if (!sessionId) return;
    try {
        const target = resolveStorage(storage);
        if (!target) return;
        const value = String(text ?? "");
        if (value) target.setItem(storageKey(sessionId), value);
        else target.removeItem(storageKey(sessionId));
    } catch {
        
    }
}

export function clearComposerDraft(sessionId, storage) {
    if (!sessionId) return;
    try {
        resolveStorage(storage)?.removeItem(storageKey(sessionId));
    } catch {
        
    }
}
