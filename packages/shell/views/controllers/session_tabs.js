/**
 * session tabs controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createSessionTabs({ state: contextState, deps }) {
    function generateSessionId() {
        const rand = Math.random().toString(36).slice(2, 10);
        const ts = Date.now().toString(36).slice(-4);
        const randomId = `${rand}${ts}`;
        const prefix = String(contextState.sessionPreferences?.idPrefix || "").trim().toLowerCase();
        return /^[a-z][a-z0-9_-]{0,24}$/.test(prefix) ? `${prefix}-${randomId}` : randomId;
    }

    async function loadSessionPreferences() {
        try {
            const response = await deps.agentRuntime.request("/system/view");
            const payload = await response.json();
            const state = payload?.state ?? payload?.data?.state;
            if (response.ok && state) contextState.sessionPreferences = {
                idPrefix: state.idPrefix || "",
                defaultModel: state.defaultModel || null,
            };
        } catch {
            // Compatível com runtimes que ainda não oferecem a surface.
        }
    }

    async function applyDefaultModelToNewSession(id) {
        if (!contextState.sessionPreferences?.defaultModel) return;
        try {
            await deps.agentRuntime.request("/session/model", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: id, model: contextState.sessionPreferences.defaultModel }),
            });
        } catch (error) {
            console.warn("Could not apply the session default model", error);
        }
    }

    async function loadWorkspace() {
        if (contextState.tabs.length > 0) {
            await deps.activateSession(contextState.tabs[0].sessionId);
        }
    }

    async function handleSelectTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        if (contextState.sessionId) (contextState.sessionCache[contextState.sessionId] = [...contextState.history], contextState.sessionCache = contextState.sessionCache);
        const isApp = contextState.appTabs.some((t) => t.id === sid);
        deps.recordMobileNavigation({ kind: isApp ? "app" : "chat", id: sid });
        contextState.activeTab = sid;
        contextState.activeIsApp = isApp;
        if (!isApp) contextState.sessionId = sid;
        deps.fullSaveSessionState();
        if (!isApp) {
            deps.markChatRead(sid);
            await deps.activateSession(sid);
        }
        if (contextState.isMobile) deps.closePanel();
    }

    async function handleNewTab() {
        const newId = generateSessionId();
        await applyDefaultModelToNewSession(newId);
        deps.recordMobileNavigation({ kind: "chat", id: newId });
        const next = deps.createNewTopicWorkspace(newId, {
            tabs: contextState.tabs,
            appTabs: contextState.appTabs,
            loadingMap: contextState.loadingMap,
            unreadMap: contextState.unreadMap,
        });
        contextState.tabs = next.tabs;
        contextState.appTabs = next.appTabs;
        contextState.activeTab = next.activeTab;
        contextState.sessionId = next.sessionId;
        contextState.history = next.history;
        contextState.activeIsApp = next.activeIsApp;
        contextState.loadingMap = next.loadingMap;
        contextState.unreadMap = next.unreadMap;
        deps.fullSaveSessionState();
        contextState.refreshTrigger++;
        if (contextState.isMobile) deps.closePanel();
    }

    async function handleNewSpecialistSession(event) {
        const specialistId = event?.detail?.specialistId;
        if (!specialistId) return;
        const newId = generateSessionId();
        try {
            const response = await deps.fetch("/specialists/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: newId, specialist_id: specialistId }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error("Failed to create specialist conversation:", error);
            return;
        }
        deps.recordMobileNavigation({ kind: "chat", id: newId });

        const next = deps.createNewTopicWorkspace(newId, {
            tabs: contextState.tabs,
            appTabs: contextState.appTabs,
            loadingMap: contextState.loadingMap,
            unreadMap: contextState.unreadMap,
        });
        contextState.tabs = next.tabs;
        contextState.appTabs = next.appTabs;
        contextState.activeTab = next.activeTab;
        contextState.sessionId = next.sessionId;
        contextState.history = next.history;
        contextState.activeIsApp = next.activeIsApp;
        contextState.loadingMap = next.loadingMap;
        contextState.unreadMap = next.unreadMap;
        deps.fullSaveSessionState();
        contextState.refreshTrigger++;
        if (contextState.isMobile) deps.closePanel();
    }

    function handleRenameTab(e) {
        const payload = typeof e === "object" && e?.detail ? e.detail : e;
        const { sessionId: sid, name } = payload;
        contextState.tabs = contextState.tabs.map((t) => (t.sessionId === sid ? { ...t, name } : t));
        deps.fullSaveSessionState();
    }

    function handleTogglePin(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        contextState.tabs = contextState.tabs.map((t) =>
            t.sessionId === sid ? { ...t, pinned: !t.pinned } : t,
        );
        deps.fullSaveSessionState();
    }

    function handleMoveTab(e) {
        const { sourceId, targetId, after = false } = e?.detail ?? e ?? {};
        if (!sourceId || !targetId) return;
        contextState.tabOrder = deps.moveTab(contextState.tabOrder, sourceId, targetId, after);
        deps.fullSaveSessionState();
    }

    async function handleCloseTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        contextState.tabOrder = contextState.tabOrder.filter((id) => id !== sid);
        const isApp = contextState.appTabs.find((t) => t.id === sid);
        if (isApp) {
            contextState.appTabs = contextState.appTabs.filter((t) => t.id !== sid);
            if (contextState.activeTab === sid) {
                contextState.activeTab = contextState.sessionId;
                contextState.activeIsApp = false;
            }
            deps.fullSaveSessionState();
            return;
        }
        // Fechar a aba NÃO cancela o turno: a geração segue no servidor e a
        // sessão reata via reconcileSession quando for reaberta.
        contextState.loadingMap = { ...contextState.loadingMap, [sid]: false };
        contextState.unreadMap = { ...contextState.unreadMap, [sid]: false };
        const next = deps.closeChatTab(sid, { tabs: contextState.tabs, activeTab: contextState.activeTab, sessionId: contextState.sessionId, history: contextState.history, activeIsApp: contextState.activeIsApp });
        contextState.tabs = next.tabs;
        contextState.activeTab = next.activeTab;
        contextState.sessionId = next.sessionId;
        contextState.history = next.history;
        contextState.activeIsApp = next.activeIsApp;
        deps.fullSaveSessionState();
        if (next.sessionId && next.sessionId !== sid) await deps.activateSession(next.sessionId);
        (delete contextState.sessionCache[sid], contextState.sessionCache = contextState.sessionCache);
        contextState.refreshTrigger++;
    }

    function handleCloseAllChats() {
        const next = deps.closeAllChatTabs({ tabs: contextState.tabs, activeTab: contextState.activeTab, sessionId: contextState.sessionId, history: contextState.history, activeIsApp: contextState.activeIsApp, loadingMap: contextState.loadingMap, unreadMap: contextState.unreadMap });
        const retainedIds = new Set(next.tabs.map((tab) => tab.sessionId));
        const closedIds = contextState.tabs.filter((tab) => !retainedIds.has(tab.sessionId)).map((tab) => tab.sessionId);
        contextState.tabs = next.tabs;
        contextState.activeTab = next.activeTab;
        contextState.sessionId = next.sessionId;
        contextState.history = next.history;
        contextState.activeIsApp = next.activeIsApp;
        contextState.loadingMap = next.loadingMap;
        contextState.unreadMap = next.unreadMap;
        deps.fullSaveSessionState();
        for (const sid of closedIds) (delete contextState.sessionCache[sid], contextState.sessionCache = contextState.sessionCache);
        contextState.refreshTrigger++;
    }

    async function handleSelectSession(e) {
        const { sessionId: newId, history: newHistory } = e.detail;
        deps.recordMobileNavigation({ kind: "chat", id: newId });
        if (contextState.sessionCache[contextState.sessionId]) (contextState.sessionCache[contextState.sessionId] = [...contextState.history], contextState.sessionCache = contextState.sessionCache);
        const existing = contextState.tabs.find((t) => t.sessionId === newId);
        if (!existing) {
            contextState.tabs = [
                ...contextState.tabs,
                { sessionId: newId, name: "New Mission", pinned: false },
            ];
        }
        contextState.activeTab = newId;
        contextState.activeIsApp = false;
        contextState.sessionId = newId;
        deps.fullSaveSessionState();
        await deps.activateSession(newId);
        if (contextState.isMobile) deps.closePanel();
    }

    async function handleSessionDelete(e) {
        const payload = e?.detail ?? e;
        const sid =
            typeof payload === "string"
                ? payload
                : payload?.sessionId ?? payload;
        contextState.tabs = contextState.tabs.filter((t) => t.sessionId !== sid);
        contextState.appTabs = contextState.appTabs.filter((t) => t.id !== sid);
        (delete contextState.sessionCache[sid], contextState.sessionCache = contextState.sessionCache);
        if (contextState.activeTab === sid) {
            const fallback = contextState.tabs[0]?.sessionId;
            contextState.activeTab = fallback;
            contextState.activeIsApp = false;
            deps.fullSaveSessionState();
            await deps.activateSession(fallback);
        }
        deps.fullSaveSessionState();
    }

    function handleSelectChat(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        handleSelectTab(id);
    }

    function handleCloseChat(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        handleCloseTab(id);
    }

    return { generateSessionId, loadSessionPreferences, applyDefaultModelToNewSession, loadWorkspace, handleSelectTab, handleNewTab, handleNewSpecialistSession, handleRenameTab, handleTogglePin, handleMoveTab, handleCloseTab, handleCloseAllChats, handleSelectSession, handleSessionDelete, handleSelectChat, handleCloseChat };
}
