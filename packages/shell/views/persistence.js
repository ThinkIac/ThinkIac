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

export function saveSessionState(state, scope = null, storage = localStorage) {
    try {
        const key = shellStateKey(scope);
        storage.setItem(key, JSON.stringify(compactState(state)));
    } catch (e) {
        if (e && e.name === "QuotaExceededError") {
            try {
                storage.setItem(key, JSON.stringify(compactState(state)));
                console.warn(
                    "⚠️ Estado do Shell excedeu a cota do localStorage; salvo sem dados opcionais.",
                );
                return;
            } catch (e2) {
                console.warn("❌ Failed to save Agent state (without cache):", e2);
                return;
            }
        }
        console.warn("❌ Failed to save Agent state:", e);
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
