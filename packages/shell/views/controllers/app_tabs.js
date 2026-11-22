/**
 * app tabs controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createAppTabs({ state: contextState, deps }) {
    function reloadApp(id, recreate = false) {
        const frame = contextState.iframeRefs[id];
        if (recreate) {
            contextState.appReloadKeys = { ...contextState.appReloadKeys, [id]: (contextState.appReloadKeys[id] || 0) + 1 };
        } else if (frame) {
            contextState.appLoadingMap = { ...contextState.appLoadingMap, [id]: true };
            frame.src = frame.src;
        }
    }

    async function refreshChat(sid, recreate = false) {
        if (!sid) return;
        if (recreate) (delete contextState.sessionCache[sid], contextState.sessionCache = contextState.sessionCache);
        if (sid === contextState.sessionId) await deps.activateSession(sid);
        else deps.reconcileSession(sid);
    }

    async function refreshActive(recreate = false) {
        if (contextState.activeIsApp) reloadApp(contextState.activeTab, recreate);
        else await refreshChat(contextState.activeTab, recreate);
    }

    async function refreshAllTabs() {
        for (const tab of contextState.appTabs) reloadApp(tab.id, false);
        for (const tab of contextState.tabs) await refreshChat(tab.sessionId, false);
    }

    function finishAppLoad(id) {
        if (!id) return;
        if (contextState.appLoadTimers[id]) {
            clearTimeout(contextState.appLoadTimers[id]);
            delete contextState.appLoadTimers[id];
        }
        if (contextState.appLoadingMap[id]) contextState.appLoadingMap = { ...contextState.appLoadingMap, [id]: false };
        if (contextState.appRefreshingMap[id]) contextState.appRefreshingMap = { ...contextState.appRefreshingMap, [id]: false };
    }

    function startAppLoad(id) {
        if (!id) return;
        finishAppLoad(id);
        contextState.appLoadingMap = { ...contextState.appLoadingMap, [id]: true };
        contextState.appLoadTimers[id] = setTimeout(() => finishAppLoad(id), contextState.APP_LOAD_FALLBACK_MS);
    }

    function handleOpenApp(e) {
        const app = e.detail;
        const existing = contextState.appTabs.find((t) => t.id === app.id);
        deps.recordMobileNavigation({ kind: "app", id: app.id });
        if (existing) {
            contextState.activeTab = app.id;
            contextState.activeIsApp = true;
            finishAppLoad(app.id);
            contextState.appMenuOpen = false;
            deps.fullSaveSessionState();
            if (contextState.isMobile) deps.closePanel();
            return;
        }
        const newAppTab = { ...app, type: "app" };
        contextState.appTabs = [...contextState.appTabs, newAppTab];
        contextState.activeTab = app.id;
        contextState.activeIsApp = true;
        contextState.appMenuOpen = false;
        startAppLoad(app.id);
        deps.fullSaveSessionState();
        if (contextState.isMobile) deps.closePanel();
    }

    function handleSelectApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        if (!contextState.appTabs.some((tab) => tab.id === id)) return;
        contextState.activeTab = id;
        contextState.activeIsApp = true;
        // A tab can be selected again after its iframe load event was dropped
        // while it was backgrounded. Never let that stale loading state cover
        // the restored package view.
        finishAppLoad(id);
        deps.fullSaveSessionState();
        if (contextState.isMobile) deps.closePanel();
    }

    function handleCloseApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        finishAppLoad(id);
        contextState.appTabs = contextState.appTabs.filter((t) => t.id !== id);
        if (contextState.activeTab === id) {
            contextState.activeTab = contextState.sessionId;
            contextState.activeIsApp = false;
        }
        deps.fullSaveSessionState();
    }

    function handleCloseAllApps() {
        Object.keys(contextState.appLoadTimers).forEach(finishAppLoad);
        const next = deps.closeAllAppTabs({ appTabs: contextState.appTabs, activeTab: contextState.activeTab, activeIsApp: contextState.activeIsApp, sessionId: contextState.sessionId });
        contextState.appTabs = next.appTabs;
        contextState.activeTab = next.activeTab;
        contextState.activeIsApp = next.activeIsApp;
        deps.fullSaveSessionState();
    }

    function handleReorderApps(event) {
        const { id, targetId } = event?.detail || {};
        const from = contextState.appTabs.findIndex((tab) => tab.id === id);
        const to = contextState.appTabs.findIndex((tab) => tab.id === targetId);
        if (from < 0 || to < 0 || from === to) return;
        const next = [...contextState.appTabs];
        const [tab] = next.splice(from, 1);
        next.splice(to, 0, tab);
        contextState.appTabs = next;
        deps.fullSaveSessionState();
    }

    return { reloadApp, refreshChat, refreshActive, refreshAllTabs, finishAppLoad, startAppLoad, handleOpenApp, handleSelectApp, handleCloseApp, handleCloseAllApps, handleReorderApps };
}
