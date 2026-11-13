export function closeAllAppTabs(workspace) {
    return {
        ...workspace,
        appTabs: [],
        activeTab: workspace.activeIsApp ? workspace.sessionId || "" : workspace.activeTab,
        activeIsApp: false,
    };
}
