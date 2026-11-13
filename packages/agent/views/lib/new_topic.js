export function createNewTopicWorkspace(sessionId, workspace = {}) {
    const tabs = Array.isArray(workspace.tabs) ? workspace.tabs : [];
    return {
        tabs: [
            ...tabs,
            { sessionId, name: "Nova Missão", pinned: false },
        ],
        appTabs: Array.isArray(workspace.appTabs) ? workspace.appTabs : [],
        activeTab: sessionId,
        sessionId,
        history: [],
        activeIsApp: false,
        loadingMap: workspace.loadingMap ?? {},
        unreadMap: workspace.unreadMap ?? {},
    };
}
