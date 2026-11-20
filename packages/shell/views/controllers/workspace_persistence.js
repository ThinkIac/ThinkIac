/**
 * workspace persistence controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createWorkspacePersistence({ state: contextState, deps }) {
    function fullSaveSessionState() {
        const state = {
            tabs: contextState.tabs,
            appTabs: contextState.appTabs,
            activeTab: contextState.activeTab,
            sessionId: contextState.sessionId,
            sessionCache: contextState.sessionCache,
            unreadMap: contextState.unreadMap,
            activeIsApp: contextState.activeIsApp,
            tabOrder: contextState.tabOrder,
            mobileNavigation: contextState.mobileNavigation,
        };
        // O servidor é a fonte de verdade do histórico. Nunca o coloque no
        // snapshot: uma conversa pode carregar anexos, resultados de tools e
        // cards estruturados, multiplicando o uso de localStorage em cada
        // janela aberta. O cache em memória continua deixando a troca de abas
        // instantânea; após recarregar, activateSession busca o histórico.
        delete state.sessionCache;
        deps.saveSessionState(state, contextState.shellScope);
    }

    function fullRestoreSessionState() {
        const state = deps.restoreSessionState(contextState.shellScope);
        if (!state) return false;
        try {
            if (state.tabs && state.tabs.length > 0) {
                contextState.tabs = state.tabs;
            }
            if (state.appTabs) contextState.appTabs = state.appTabs;
            if (state.activeTab) contextState.activeTab = state.activeTab;
            if (state.sessionId) contextState.sessionId = state.sessionId;
            // Snapshots antigos podem conter megabytes de histórico. Não os
            // reidratamos: o backend já é canônico e evita um parse custoso no
            // boot. A próxima gravação substitui o snapshot antigo e o reduz.
            if (state.unreadMap) contextState.unreadMap = state.unreadMap;
            if (state.activeIsApp !== undefined) contextState.activeIsApp = state.activeIsApp;
            if (Array.isArray(state.mobileNavigation)) contextState.mobileNavigation = state.mobileNavigation;
            const persistedTabs = [...contextState.tabs, ...contextState.appTabs.map((tab) => ({ sessionId: tab.id }))];
            contextState.tabOrder = deps.normalizeTabOrder(state.tabOrder, persistedTabs);
            return true;
        } catch (e) {
            console.warn("[Shell] Failed to restore state:", e.message);
            return false;
        }
    }

    return { fullSaveSessionState, fullRestoreSessionState };
}
