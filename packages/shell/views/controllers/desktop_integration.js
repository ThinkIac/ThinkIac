/**
 * desktop integration controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createDesktopIntegration({ state: contextState, deps }) {
    async function openDesktopComposition(payload) {
        const detail = typeof payload === "object" && payload ? payload : { text: payload };
        const text = String(detail.text ?? "").trim();
        if (!text) return;

        const suppliedId = String(detail.sessionId ?? contextState.desktopSession ?? "").trim();
        const newId = /^[A-Za-z0-9_-]{1,200}$/.test(suppliedId) ? suppliedId : deps.generateSessionId();
        if (!suppliedId) await deps.applyDefaultModelToNewSession(newId);
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
        contextState.refreshTrigger++;
        if (detail.agentId) {
            contextState.activeAgentId = deps.writeSessionAgent(deps.localStorage, newId, detail.agentId);
            deps.agentRuntime.activateAgent(contextState.activeAgentId);
        }
        await deps.send({ detail: { ...detail, text } });
    }

    function consumeDesktopHandoff() {
        const text = String(contextState.handoff ?? "").trim();
        if (!text) return null;

        const detail = { text, sessionId: contextState.desktopSession, agentId: contextState.agentId };
        contextState.handoff = undefined;
        contextState.desktopSession = undefined;
        contextState.agentId = undefined;

        const url = new URL(deps.window.location.href);
        url.searchParams.delete("handoff");
        url.searchParams.delete("desktopSession");
        url.searchParams.delete("agentId");
        deps.window.history.replaceState(deps.window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

        return detail;
    }

    function handleOpenSeparateWindow(event) {
        if (!contextState.desktopHost) return;
        const tab = event?.detail;
        if (!tab?.sessionId) return;
        const detail = tab.type === "app"
            ? { kind: "app", appId: tab.id || tab.sessionId }
            : { kind: "chat", sessionId: tab.sessionId };
        deps.window.parent.postMessage({
            source: "thinkiac-shell",
            type: "open:shell-window",
            detail,
        }, deps.window.location.origin);
    }

    function shellControlState() {
        const windows = contextState.appTabs.map((tab) => {
            const catalogApp = contextState.shellControlApps.find((item) => item.id === tab.id || item.url === tab.url);
            return {
                id: tab.id,
                appId: catalogApp?.appId || tab.id,
                title: tab.name || catalogApp?.name || "App",
                workspace: "shell",
                isMinimized: false,
                isMaximized: false,
                isFocused: contextState.activeIsApp && contextState.activeTab === tab.id,
            };
        });
        return {
            activeWorkspace: "shell",
            workspaces: [{ id: "shell", name: "Shell" }],
            activeWindowId: contextState.activeIsApp ? contextState.activeTab : null,
            windows,
            apps: contextState.shellControlApps.map((item) => ({
                appId: item.appId,
                name: item.name,
                description: item.description,
                isOpen: windows.some((win) => win.appId === item.appId),
                windowIds: windows.filter((win) => win.appId === item.appId).map((win) => win.id),
            })),
        };
    }

    async function loadShellControlApps() {
        const response = await deps.api("/apps/list", "GET", null, "shell");
        const list = Array.isArray(response) ? response : [];
        contextState.shellControlApps = list
            .filter((item) => item?.url && item.default === true)
            .map((item) => ({
                appId: item.packageName || item.id || item.url,
                id: item.id || item.url,
                name: item.name || item.packageName || "App",
                description: item.description || "",
                url: item.url,
                source: item,
            }));
        return contextState.shellControlApps;
    }

    async function shellControlCommand(action, payload) {
        if (action === "list_apps" || action === "list_windows" || action === "get_state") return shellControlState();
        if (action !== "open_app") throw new Error("Action is not supported by Shell");
        const appId = String(payload?.appId || "").trim();
        // O Desktop pode pedir uma aba assim que o WebSocket abre, antes de a
        // consulta inicial do catálogo terminar. Resolve o catálogo aqui para
        // que esse primeiro comando não seja descartado como "não encontrado".
        if (!contextState.shellControlApps.length) await loadShellControlApps();
        const target = contextState.shellControlApps.find((item) => item.appId === appId);
        if (!target) throw new Error("App was not found in the Shell catalog");
        deps.handleOpenApp({ detail: target.source });
        await deps.tick();
        return shellControlState();
    }

    function installShellDesktopControl() {
        const bridge = deps.installShellControlBridge({
            sessionId: () => contextState.sessionId,
            state: shellControlState,
            execute: shellControlCommand,
        });
        // Não bloqueia a conexão da ponte: o primeiro comando ainda pode
        // carregar o catálogo via shellControlCommand.
        loadShellControlApps().catch((error) => {
            console.warn("[desktop-control] Shell could not load the catalog", error);
        });
        return bridge;
    }

    return { openDesktopComposition, consumeDesktopHandoff, handleOpenSeparateWindow, shellControlState, loadShellControlApps, shellControlCommand, installShellDesktopControl };
}
