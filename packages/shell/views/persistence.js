// Funções de persistência para Agent
// Usadas exclusivamente dentro de onMount e handlers de eventos

const STATE_KEY = "agent-session-state";
const LEGACY_STATE_KEYS = ["aurora-session-state", "aurora:state", "agent:state"];

// Histórico de chat pertence ao Runtime. Mantê-lo no snapshot da janela
// duplicava mensagens, tool results e anexos para cada Shell aberto.
function compactState(state) {
    const { sessionCache, ...snapshot } = state ?? {};
    return snapshot;
}

/**
 * A Desktop may keep many Shell windows alive. Their tabs must not compete for
 * the old global snapshot, so the Desktop gives each one a workspace/window
 * coordinate. Standalone Shell keeps the historical key and migration.
 */
export function shellStateKey(scope = null) {
    const workspaceId = String(scope?.workspaceId || "").trim();
    const shellId = String(scope?.shellId || "").trim();
    if (!workspaceId || !shellId) return STATE_KEY;
    return `thinkiac:shell-state:v1:${encodeURIComponent(workspaceId)}:${encodeURIComponent(shellId)}`;
}

function migrateLegacyState() {
    try {
        if (localStorage.getItem(STATE_KEY) !== null) return;
        const legacyKey = LEGACY_STATE_KEYS.find((key) => localStorage.getItem(key) !== null);
        if (!legacyKey) return;
        localStorage.setItem(STATE_KEY, localStorage.getItem(legacyKey));
    } catch (e) {
        console.warn("❌ Failed to migrate legacy Agent state:", e);
    }
}

const reportedWriteFailures = new Set();

function summarizeStorage(storage) {
    const families = {};
    for (let index = 0; index < storage.length; index++) {
        const key = storage.key(index);
        if (key === null) continue;
        const value = storage.getItem(key);
        if (value === null) continue;
        const family = key.startsWith("thinkiac:shell-state:v1:") ? "desktopSnapshots"
            : key === STATE_KEY || LEGACY_STATE_KEYS.includes(key) ? "standaloneSnapshots"
            : key === "shell:sessions-cache:v1" ? "sessionsCache"
            : key === "shell:apps-cache:v1" ? "appsCache"
            : "other";
        const usage = families[family] ??= { keys: 0, estimatedBytes: 0 };
        usage.keys++;
        usage.estimatedBytes += 2 * (key.length + value.length);
    }
    return families;
}

export function writeShellStorage(key, value, operation, storage) {
    try {
        storage ??= globalThis.localStorage;
        storage.setItem(key, value);
        reportedWriteFailures.delete(operation);
        return true;
    } catch (error) {
        if (reportedWriteFailures.has(operation)) return false;
        reportedWriteFailures.add(operation);
        const diagnostic = { operation, error: error?.name, estimatedBytes: 2 * (key.length + String(value).length) };
        if (error?.name === "QuotaExceededError") {
            try { diagnostic.usage = summarizeStorage(storage); } catch {}
        }
        console.warn("[Shell] Browser storage write failed", diagnostic);
        return false;
    }
}

// A single preview cache may use up to 128 KiB of estimated UTF-16 storage.
export function saveWidgetCache(key, items, maxItems, operation, scope = null) {
    const maxUnits = 64 * 1024;
    const prefix = scope === null ? "[" : `{"scope":${JSON.stringify(scope)},"items":[`;
    const suffix = scope === null ? "]" : "]}";
    const overhead = key.length + prefix.length + suffix.length;
    if (overhead > maxUnits) return false;
    let units = overhead;
    const rows = [];
    for (const item of items.slice(0, maxItems)) {
        const row = JSON.stringify(item);
        if (row === undefined || overhead + row.length > maxUnits) continue;
        const size = row.length + (rows.length ? 1 : 0);
        if (units + size > maxUnits) break;
        rows.push(row);
        units += size;
    }
    if (items.length && !rows.length) return false;
    const value = prefix + rows.join(",") + suffix;
    try {
        if (globalThis.localStorage.getItem(key) === value) return true;
    } catch {}
    return writeShellStorage(key, value, operation);
}

export function saveSessionState(state, scope = null, storage) {
    try {
        return writeShellStorage(shellStateKey(scope), JSON.stringify(compactState(state)), "window state", storage);
    } catch (error) {
        console.warn("[Shell] Failed to serialize window state", error?.name);
        return false;
    }
}

export function restoreSessionState(scope = null, storage = localStorage) {
    try {
        if (shellStateKey(scope) === STATE_KEY) migrateLegacyState();
        const saved = storage.getItem(shellStateKey(scope));
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn("❌ Failed to restore Agent state:", e);
    }
    return null;
}

export function clearSessionState(scope = null, storage = localStorage) {
    try {
        storage.removeItem(shellStateKey(scope));
        if (shellStateKey(scope) === STATE_KEY) LEGACY_STATE_KEYS.forEach((key) => storage.removeItem(key));
    } catch (e) {
        console.warn("❌ Failed to clear Agent state:", e);
    }
}
