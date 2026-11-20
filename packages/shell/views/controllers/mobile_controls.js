/**
 * mobile controls controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createMobileControls({ state: contextState, deps }) {
    function openLeft() { contextState.mobilePanel = contextState.mobilePanel === "left" ? null : "left"; }

    function openRight() { contextState.mobilePanel = contextState.mobilePanel === "right" ? null : "right"; }

    function closePanel() { contextState.mobilePanel = null; }

    function dismissMobileMenus() { contextState.chatMenuOpen = false; contextState.appMenuOpen = false; }

    function handleSystemSwipe(gesture) {
        if (!contextState.isMobile || gesture.type !== "swipe") return { handled: false };

        // Uma gaveta aberta fecha no gesto que a empurra de volta para a borda.
        if (contextState.mobilePanel === "left" && gesture.direction === "left") {
            closePanel();
            return { handled: true };
        }
        if (contextState.mobilePanel === "right" && gesture.direction === "right") {
            closePanel();
            return { handled: true };
        }

        // Sem gaveta: somente uma borda física pode revelar o painel oposto.
        if (!contextState.mobilePanel && gesture.fromEdge === "left" && gesture.direction === "right") {
            openLeft();
            return { handled: true };
        }
        if (!contextState.mobilePanel && gesture.fromEdge === "right" && gesture.direction === "left") {
            openRight();
            return { handled: true };
        }
        return { handled: false };
    }

    function setupGestureProtocol() {
        const router = deps.createGestureRouter();
        const iframeBridge = deps.createIframeGestureBridge({
            getActiveFrame: () => contextState.activeIsApp ? contextState.iframeRefs[contextState.activeTab] : null,
        });

        // Apps em iframe só participam depois de opt-in; Chat usa diretamente
        // o fallback abaixo, exatamente com a mesma semântica `handled`.
        contextState.gestureOffs.push(router.register((gesture) => iframeBridge.dispatch(gesture), { priority: 100 }));
        contextState.gestureOffs.push(router.register(handleSystemSwipe, { priority: 0 }));
        deps.window.addEventListener("message", iframeBridge.handleMessage);
        contextState.gestureOffs.push(() => deps.window.removeEventListener("message", iframeBridge.handleMessage));
        contextState.gestureOffs.push(deps.installNativeGestureBridge((gesture) => router.dispatch(gesture)));
        contextState.gestureOffs.push(deps.installEdgeSwipeDetector(contextState.shellEl, (gesture) => router.dispatch(gesture), () => contextState.isMobile, () => contextState.mobilePanel));
    }

    async function refreshMobileChat() {
        if (contextState.activeIsApp || contextState.chatRefreshing) return;
        contextState.chatMenuOpen = false;
        contextState.chatRefreshing = true;
        try {
            await deps.refreshChat(contextState.activeTab, false);
            contextState.refreshTrigger++;
        } finally {
            contextState.chatRefreshing = false;
        }
    }

    function refreshMobileApp() {
        if (!contextState.activeIsApp) return;
        contextState.appMenuOpen = false;
        contextState.appRefreshingMap = { ...contextState.appRefreshingMap, [contextState.activeTab]: true };
        deps.reloadApp(contextState.activeTab, false);
    }

    function enterMobileFullscreen() {
        dismissMobileMenus();
        contextState.mobileHeaderCollapsed = true;
    }

    function returnToLauncher() {
        if (!contextState.nativeApp || !deps.window.FlutterBridge?.postMessage) return;
        deps.window.FlutterBridge.postMessage("return-to-launcher");
    }

    function checkMobile() {
        // Keep touch-first phones in the mobile layout when their WebView
        // reports a wider layout viewport than the physical screen.
        contextState.isMobile = deps.window.matchMedia("(max-width: 767px)").matches
            || deps.window.matchMedia("(pointer: coarse)").matches;
        deps.maybeLoadRecentSessions();
        if (!contextState.isMobile) contextState.mobilePanel = null;
    }

    return { openLeft, openRight, closePanel, dismissMobileMenus, handleSystemSwipe, setupGestureProtocol, refreshMobileChat, refreshMobileApp, enterMobileFullscreen, returnToLauncher, checkMobile };
}
