/**
 * recent sessions controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createRecentSessions({ state: contextState, deps }) {
    function recentSessionLabel(session) {
        return session?.title || session?.summary || "Untitled conversation";
    }

    function recentSessionMeta(session) {
        const timestamp = session?.updated_at || session?.created_at;
        if (!timestamp) return "Conversation";
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return "Conversation";
        const elapsed = Date.now() - date.getTime();
        if (elapsed < 60_000) return "just now";
        if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
        if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
        return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    }

    async function loadRecentSessions() {
        contextState.recentSessionsLoading = true;
        try {
            const response = await deps.agentRuntime.requestForAgent(contextState.activeAgentId, "/sessions/list");
            const result = await response.json();
            const sessions = result?.data ?? result;
            contextState.recentSessions = Array.isArray(sessions)
                ? sessions.filter((item) => item?.id && item.id !== contextState.initialId)
                : [];
            contextState.recentSessionsVisibleCount = contextState.RECENT_SESSIONS_BATCH_SIZE;
        } catch {
            contextState.recentSessions = [];
        } finally {
            contextState.recentSessionsLoading = false;
        }
    }

    function maybeLoadRecentSessions() {
        if (contextState.recentSessionsRequested) return;
        contextState.recentSessionsRequested = true;
        loadRecentSessions();
    }

    function loadMoreRecentSessions() {
        if (contextState.recentSessionsVisibleCount >= contextState.recentSessions.length) return;
        contextState.recentSessionsVisibleCount = Math.min(
            contextState.recentSessionsVisibleCount + contextState.RECENT_SESSIONS_BATCH_SIZE,
            contextState.recentSessions.length,
        );
    }

    function handleRecentSessionsScroll(event) {
        const list = event.currentTarget;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 12) {
            loadMoreRecentSessions();
        }
    }

    function recentSessionInfiniteScroll(node) {
        if (typeof IntersectionObserver === "undefined") return;
        const sentinel = node.querySelector(".recent-sessions-sentinel");
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) loadMoreRecentSessions();
        }, { root: node, threshold: 0.1 });
        observer.observe(sentinel);
        return { destroy: () => observer.disconnect() };
    }

    async function openRecentSession(sid) {
        if (!sid) return;
        deps.recordMobileNavigation({ kind: "chat", id: sid });
        if (contextState.sessionId) (contextState.sessionCache[contextState.sessionId] = [...contextState.history], contextState.sessionCache = contextState.sessionCache);
        const existing = contextState.tabs.find((tab) => tab.sessionId === sid);
        if (!existing) {
            const session = contextState.recentSessions.find((item) => item.id === sid);
            contextState.tabs = [...contextState.tabs, {
                sessionId: sid,
                name: recentSessionLabel(session),
                pinned: false,
            }];
        }
        contextState.activeTab = sid;
        contextState.activeIsApp = false;
        contextState.sessionId = sid;
        deps.markChatRead(sid);
        deps.fullSaveSessionState();
        await deps.activateSession(sid);
    }

    return { recentSessionLabel, recentSessionMeta, loadRecentSessions, maybeLoadRecentSessions, loadMoreRecentSessions, handleRecentSessionsScroll, recentSessionInfiniteScroll, openRecentSession };
}
