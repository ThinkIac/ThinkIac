


const STATE_KEY = "agent-session-state";
const LEGACY_STATE_KEYS = ["aurora-session-state", "aurora:state", "agent:state"];

function migrateLegacyState() {
    try {
        if (localStorage.getItem(STATE_KEY) !== null) return;
        const legacyKey = LEGACY_STATE_KEYS.find((key) => localStorage.getItem(key) !== null);
        if (!legacyKey) return;
        localStorage.setItem(STATE_KEY, localStorage.getItem(legacyKey));
    } catch (e) {
        console.warn("❌ Falha ao migrar estado legado Agent:", e);
    }
}

export function saveSessionState(state) {
    try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state ?? {}));
    } catch (e) {
        if (e && e.name === "QuotaExceededError") {
            try {
                const { sessionCache, ...lightState } = state ?? {};
                localStorage.setItem(STATE_KEY, JSON.stringify(lightState));
                console.warn(
                    "⚠️ Estado Agent excedeu a cota do localStorage; salvo sem sessionCache.",
                );
                return;
            } catch (e2) {
                console.warn("❌ Falha ao salvar estado Agent (sem cache):", e2);
                return;
            }
        }
        console.warn("❌ Falha ao salvar estado Agent:", e);
    }
}

export function restoreSessionState() {
    try {
        migrateLegacyState();
        const saved = localStorage.getItem(STATE_KEY);
        if (saved) {
            return JSON.parse(saved);
        }
    } catch (e) {
        console.warn("❌ Falha ao restaurar estado Agent:", e);
    }
    return null;
}

export function clearSessionState() {
    try {
        localStorage.removeItem(STATE_KEY);
        LEGACY_STATE_KEYS.forEach((key) => localStorage.removeItem(key));
    } catch (e) {
        console.warn("❌ Falha ao limpar estado Agent:", e);
    }
}
