/**
 * connection status controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createConnectionStatus({ state: contextState, deps }) {
    function postEdgeStatus(payload) {
        try {
            const bridge = deps.window.ThinkiacEdge;
            if (bridge && typeof bridge.postMessage === "function") {
                bridge.postMessage(JSON.stringify(payload));
            }
        } catch {
            // A bridge nativa nunca pode impedir a Shell de iniciar.
        }
    }

    function reportEdgeError(event) {
        postEdgeStatus({
            type: "error",
            message: event?.message || "Unidentified JavaScript error.",
        });
    }

    function reportEdgeRejection(event) {
        const reason = event?.reason;
        postEdgeStatus({
            type: "error",
            message: reason?.message || String(reason || "Promise rejeitada sem detalhe."),
        });
    }

    function setGlobalLoading(detail = {}) {
        const active = detail?.active !== false;
        if (!active && detail?.id && contextState.globalLoading.id && detail.id !== contextState.globalLoading.id) return;
        if (contextState.globalLoadingTimer) {
            clearTimeout(contextState.globalLoadingTimer);
            contextState.globalLoadingTimer = null;
        }
        contextState.globalLoading = active
            ? { active: true, id: typeof detail.id === "string" ? detail.id : "global" }
            : { active: false, id: null };
        if (active) {
            contextState.globalLoadingTimer = setTimeout(() => {
                contextState.globalLoading = { active: false, id: null };
                contextState.globalLoadingTimer = null;
            }, 120000);
        }
    }

    function handleOnline() {
        contextState.isOnline = true;
        contextState.reconnecting = false;
        if (contextState.reconnectTimer) {
            clearInterval(contextState.reconnectTimer);
            contextState.reconnectTimer = null;
        }
        if (contextState.wasOffline) {
            contextState.wasOffline = false;
            // Pequeno delay para o servidor estabilizar
            setTimeout(() => {
                loadSystem();
            }, 800);
        }
    }

    function handleOffline() {
        contextState.isOnline = false;
        contextState.wasOffline = true;
        contextState.reconnecting = true;
        startReconnectLoop();
        deps.fullSaveSessionState();
    }

    function startReconnectLoop() {
        if (contextState.reconnectTimer) return;
        contextState.reconnectTimer = setInterval(async () => {
            try {
                const res = await deps.agentRuntime.request("/provider", {
                    method: "HEAD",
                    cache: "no-store",
                });
                if (res.ok) {
                    handleOnline();
                }
            } catch {
                /* ainda offline */
            }
        }, 4000);
    }

    async function loadSystem() {
        const [p, o] = await Promise.all([
            deps.api("/provider"),
            deps.api("/oauth/status"),
        ]);
        if (p)
            contextState.system = {
                ...contextState.system,
                provider: p.provider || "—",
                model: p.model || "—",
            };
        if (o?.providers)
            contextState.system = { ...contextState.system, connections: Object.entries(o.providers) };
    }

    return { postEdgeStatus, reportEdgeError, reportEdgeRejection, setGlobalLoading, handleOnline, handleOffline, startReconnectLoop, loadSystem };
}
