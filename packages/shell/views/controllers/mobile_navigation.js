/**
 * mobile navigation controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createMobileNavigation({ state: contextState, deps }) {
    function currentMobileDestination() {
        if (!contextState.activeTab) return null;
        return contextState.activeIsApp ? { kind: "app", id: contextState.activeTab } : { kind: "chat", id: contextState.activeTab };
    }

    function isMobileDestinationAvailable(destination) {
        if (!destination?.id) return false;
        return destination.kind === "app"
            ? contextState.appTabs.some((tab) => tab.id === destination.id)
            : contextState.tabs.some((tab) => tab.sessionId === destination.id);
    }

    function recordMobileNavigation(next) {
        if (!contextState.isMobile || !next?.id) return;
        const current = currentMobileDestination();
        if (!current || (current.kind === next.kind && current.id === next.id)) return;
        contextState.mobileNavigation = [...contextState.mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        contextState.mobileForwardNavigation = [];
        // O Android/WebView só conhece history.pushState. Espelhar cada troca
        // interna faz o botão físico voltar para a aba anterior, sem sair do
        // Shell ou recarregar a página.
        deps.window.history.pushState(
            deps.historyStateWithMobileDestination(deps.window.history.state, next),
            "",
            deps.window.location.href,
        );
    }

    function replaceMobileBrowserHistoryEntry() {
        if (!contextState.isMobile) return;
        const current = currentMobileDestination();
        if (!current) return;
        deps.window.history.replaceState(
            deps.historyStateWithMobileDestination(deps.window.history.state, current),
            "",
            deps.window.location.href,
        );
    }

    async function handleMobileBrowserBack(event) {
        if (!contextState.isMobile) return;
        const destination = deps.mobileDestinationFromHistoryState(event.state);
        if (!destination || !isMobileDestinationAvailable(destination)) return;
        const current = currentMobileDestination();
        if (current?.kind === destination.kind && current.id === destination.id) return;

        const isSameDestination = (entry) => entry?.kind === destination.kind && entry.id === destination.id;
        // Mantém os botões do Header coerentes depois do gesto/botão físico.
        // Uma volta consome o último item da pilha anterior; um avanço consome
        // o da pilha seguinte. O navegador já decidiu a direção para nós.
        if (isSameDestination(contextState.mobileNavigation[contextState.mobileNavigation.length - 1])) {
            contextState.mobileNavigation = contextState.mobileNavigation.slice(0, -1);
            if (current) contextState.mobileForwardNavigation = [...contextState.mobileForwardNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        } else if (isSameDestination(contextState.mobileForwardNavigation[contextState.mobileForwardNavigation.length - 1])) {
            contextState.mobileForwardNavigation = contextState.mobileForwardNavigation.slice(0, -1);
            if (current) contextState.mobileNavigation = [...contextState.mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        }

        // popstate já moveu o cursor do navegador. Não chamamos
        // recordMobileNavigation aqui, pois isso criaria uma nova entrada e
        // quebraria o avançar nativo.
        deps.dismissMobileMenus();
        deps.closePanel();
        await activateMobileDestination(destination);
    }

    async function activateMobileDestination(destination) {
        if (!destination || !isMobileDestinationAvailable(destination)) return;
        contextState.activeTab = destination.id;
        contextState.activeIsApp = destination.kind === "app";
        if (destination.kind === "chat") contextState.sessionId = destination.id;
        deps.fullSaveSessionState();
        if (destination.kind === "chat") await deps.activateSession(destination.id);
    }

    async function goBackMobile() {
        const history = [...contextState.mobileNavigation];
        let destination = null;
        while (history.length && !destination) {
            const candidate = history.pop();
            if (isMobileDestinationAvailable(candidate)) destination = candidate;
        }
        contextState.mobileNavigation = history;
        contextState.chatMenuOpen = false;
        contextState.appMenuOpen = false;
        if (!destination) return;
        const current = currentMobileDestination();
        if (current) contextState.mobileForwardNavigation = [...contextState.mobileForwardNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        await activateMobileDestination(destination);
    }

    async function goForwardMobile() {
        const history = [...contextState.mobileForwardNavigation];
        let destination = null;
        while (history.length && !destination) {
            const candidate = history.pop();
            if (isMobileDestinationAvailable(candidate)) destination = candidate;
        }
        contextState.mobileForwardNavigation = history;
        contextState.chatMenuOpen = false;
        contextState.appMenuOpen = false;
        if (!destination) return;
        const current = currentMobileDestination();
        if (current) contextState.mobileNavigation = [...contextState.mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        await activateMobileDestination(destination);
    }

    async function closeActiveMobileTab() {
        const current = currentMobileDestination();
        if (!current) return;

        // A aba é removida antes da troca. Assim ela não pode reaparecer nos
        // controles de voltar ou avançar, mesmo que seja o único destino salvo.
        contextState.mobileNavigation = contextState.mobileNavigation.filter((item) => item.kind !== current.kind || item.id !== current.id);
        contextState.mobileForwardNavigation = contextState.mobileForwardNavigation.filter((item) => item.kind !== current.kind || item.id !== current.id);
        const previous = [...contextState.mobileNavigation].reverse().find(isMobileDestinationAvailable) ?? null;

        if (current.kind === "app") {
            contextState.appTabs = contextState.appTabs.filter((tab) => tab.id !== current.id);
            contextState.appLoadingMap = Object.fromEntries(Object.entries(contextState.appLoadingMap).filter(([id]) => id !== current.id));
        } else {
            contextState.tabs = contextState.tabs.filter((tab) => tab.sessionId !== current.id);
            contextState.tabOrder = contextState.tabOrder.filter((id) => id !== current.id);
            contextState.loadingMap = { ...contextState.loadingMap, [current.id]: false };
            contextState.unreadMap = { ...contextState.unreadMap, [current.id]: false };
            (delete contextState.sessionCache[current.id], contextState.sessionCache = contextState.sessionCache);
        }

        contextState.chatMenuOpen = false;
        contextState.appMenuOpen = false;
        if (previous && isMobileDestinationAvailable(previous)) {
            await activateMobileDestination(previous);
            return;
        }

        const fallbackChat = contextState.tabs[0]?.sessionId;
        if (fallbackChat) {
            await activateMobileDestination({ kind: "chat", id: fallbackChat });
            return;
        }
        const fallbackApp = contextState.appTabs[0]?.id;
        if (fallbackApp) {
            await activateMobileDestination({ kind: "app", id: fallbackApp });
            return;
        }
        contextState.activeTab = "";
        contextState.sessionId = "";
        contextState.activeIsApp = false;
        contextState.history = [];
        deps.fullSaveSessionState();
    }

    function mobileHome() {
        if (contextState.canGoBackMobile) return goBackMobile();
        if (contextState.activeIsApp && contextState.sessionId) {
            contextState.activeIsApp = false;
            contextState.activeTab = contextState.sessionId;
            contextState.appMenuOpen = false;
        }
    }

    return { currentMobileDestination, isMobileDestinationAvailable, recordMobileNavigation, replaceMobileBrowserHistoryEntry, handleMobileBrowserBack, activateMobileDestination, goBackMobile, goForwardMobile, closeActiveMobileTab, mobileHome };
}
