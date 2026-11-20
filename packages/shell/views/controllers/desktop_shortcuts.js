/**
 * desktop shortcuts controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createDesktopShortcuts({ state: contextState, deps }) {
    async function handleDesktopShortcut(event) {
        if (event.isComposing) return;
        if (event.key === "Escape" && !contextState.isMobile) {
            if (contextState.canvasOpen) contextState.canvasOpen = false;
            else if (!contextState.sidebarCollapsed) contextState.sidebarCollapsed = true;
            else if (!contextState.rightSidebarCollapsed) contextState.rightSidebarCollapsed = true;
            else return;
            event.preventDefault();
            return;
        }

        const action = deps.desktopShortcutAction(event, { isMobile: contextState.isMobile });
        if (!action) return;
        if (deps.isEditableShortcutTarget(event.target) && deps.isTextEditingShortcut(event, action)) return;
        event.preventDefault();

        const ordered = contextState.allTabs;
        if (action.type === "select-index") {
            const id = ordered[action.index]?.sessionId;
            if (id) await deps.handleSelectTab(id);
        } else if (action.type === "next-tab" || action.type === "previous-tab") {
            const id = deps.adjacentTabId(ordered, contextState.activeTab, action.type === "next-tab" ? 1 : -1);
            if (id) await deps.handleSelectTab(id);
        } else if (action.type === "close-active") {
            if (contextState.activeTab) await deps.handleCloseTab(contextState.activeTab);
        } else if (action.type === "close-all") {
            deps.handleCloseAllApps();
            deps.handleCloseAllChats();
        } else if (action.type === "toggle-sidebar") {
            contextState.sidebarCollapsed = !contextState.sidebarCollapsed;
        } else if (action.type === "refresh-active") {
            await deps.refreshActive(false);
        } else if (action.type === "reopen-active") {
            await deps.refreshActive(true);
        } else if (action.type === "refresh-all") {
            await deps.refreshAllTabs();
        } else if (action.type === "recover-runtime") {
            deps.busEmit("open:app", "process-manager");
        }
    }

    return { handleDesktopShortcut };
}
