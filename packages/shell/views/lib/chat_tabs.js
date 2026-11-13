export function closeChatTab(sessionId, workspace) {
    const tabs = workspace.tabs.filter((tab) => tab.sessionId !== sessionId);
    if (tabs.length === workspace.tabs.length) return workspace;
    if (workspace.activeTab !== sessionId) return { ...workspace, tabs };

    if (tabs.length === 0) {
        return {
            ...workspace,
            tabs,
            activeTab: "",
            sessionId: "",
            history: [],
            activeIsApp: false,
        };
    }

    const closedIndex = workspace.tabs.findIndex((tab) => tab.sessionId === sessionId);
    const fallback = tabs[Math.max(0, closedIndex - 1)] ?? tabs[0];
    return {
        ...workspace,
        tabs,
        activeTab: fallback.sessionId,
        sessionId: fallback.sessionId,
        activeIsApp: false,
    };
}

export function closeAllChatTabs(workspace) {
    const hasLoadingMap = "loadingMap" in workspace;
    const hasUnreadMap = "unreadMap" in workspace;
    const loadingMap = workspace.loadingMap ?? {};
    const unreadMap = workspace.unreadMap ?? {};
    const tabs = workspace.tabs.filter((tab) => loadingMap[tab.sessionId] || unreadMap[tab.sessionId]);
    const retainedIds = new Set(tabs.map((tab) => tab.sessionId));
    const activeChatWasRetained = retainedIds.has(workspace.activeTab);
    const activeTab = workspace.activeIsApp
        ? workspace.activeTab
        : activeChatWasRetained
            ? workspace.activeTab
            : tabs[0]?.sessionId ?? "";

    return {
        ...workspace,
        tabs,
        activeTab,
        sessionId: workspace.activeIsApp ? "" : activeTab,
        history: activeChatWasRetained ? workspace.history : [],
        activeIsApp: workspace.activeIsApp,
        ...(hasLoadingMap && { loadingMap: Object.fromEntries(Object.entries(loadingMap).filter(([id]) => retainedIds.has(id))) }),
        ...(hasUnreadMap && { unreadMap: Object.fromEntries(Object.entries(unreadMap).filter(([id]) => retainedIds.has(id))) }),
    };
}
