<script>
    import { createEventDispatcher, onMount } from "svelte";
    import MenuList from "./MenuList.svelte";
    import SlateIcon from "./components/SlateIcon.svelte";
    import { menuEditMode, toggleMenuEditMode, setMenuEditMode } from "./lib/menu_bootstrap.js";

    export let system = { provider: "—", model: "—", connections: [] };
    export let sessionId = "default";
    export let refreshTrigger = 0;
    export let isMobile = false;
    export let sidebarOpen = false;
    export let initialSection = "windows";
    export let mobilePanel = null;
    export let theme = "dark";
    export let desktopHost = false;
    // appId é fornecido pela WebView Flutter; fora do APK esse controle não
    // existe para não alterar a navegação web/PWA.
    export let nativeApp = false;

    export let appTabs = [];
    export let chatTabs = [];
    export let activeTab = "";
    export let activeIsApp = false;
    export let loadingMap = {};
    export let unreadMap = {};
    export let collapsed = false;
    // No primeiro uso as duas colunas começam abertas. Depois disso cada lado
    // restaura seu próprio estado persistido.
    export let rightCollapsed = false;

    const dispatch = createEventDispatcher();

    let prevIsMobile = isMobile;
    const SIDEBAR_MIN_WIDTH = 244;
    const SIDEBAR_DEFAULT_WIDTH = 280;
    // Área invisível na borda para revelar o painel recolhido. Ela não reserva
    // largura no layout: a sombra pode avançar sobre o conteúdo sem deslocá-lo.
    const SIDEBAR_EDGE_WIDTH = 28;
    const HOVER_OPEN_DELAY = 140;
    const HOVER_CLOSE_DELAY = 120;
    const LEFT_WIDTH_KEY = "shell:sidebar-left-width";
    const RIGHT_WIDTH_KEY = "shell:sidebar-right-width";
    const LEGACY_WIDTH_KEY = "shell:sidebar-width";
    const LEFT_COLLAPSED_KEY = "shell:sidebar-left-collapsed";
    const RIGHT_COLLAPSED_KEY = "shell:sidebar-right-collapsed";
    // These are also bound by the Shell frame. Keeping the measured widths at
    // the layout boundary lets the content and its tab strip reserve exactly
    // the same space as the resizable desktop rails.
    export let sidebarWidth = null;
    export let rightSidebarWidth = null;
    let sidebarStateHydrated = false;
    let leftEditMode = false;
    let rightEditMode = false;
    let stopResize = null;
    let hoverPreview = false;
    let hoverOpenTimer = null;
    let hoverCloseTimer = null;
    let rightHoverPreview = false;
    let rightHoverOpenTimer = null;
    let rightHoverCloseTimer = null;

    function clearHoverTimers() {
        if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverOpenTimer = null;
        hoverCloseTimer = null;
    }

    function clearRightHoverTimers() {
        if (rightHoverOpenTimer !== null) clearTimeout(rightHoverOpenTimer);
        if (rightHoverCloseTimer !== null) clearTimeout(rightHoverCloseTimer);
        rightHoverOpenTimer = null;
        rightHoverCloseTimer = null;
    }

    onMount(() => {
        const maxWidth = () => Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth * 0.25);
        const clampWidth = (width) => Math.min(maxWidth(), Math.max(SIDEBAR_MIN_WIDTH, width));
        let storedWidth = null;
        let storedRightWidth = null;
        try {
            const legacyWidth = localStorage.getItem(LEGACY_WIDTH_KEY);
            storedWidth = Number(localStorage.getItem(LEFT_WIDTH_KEY) ?? legacyWidth);
            storedRightWidth = Number(localStorage.getItem(RIGHT_WIDTH_KEY) ?? legacyWidth);
            const storedCollapsed = localStorage.getItem(LEFT_COLLAPSED_KEY);
            const storedRightCollapsed = localStorage.getItem(RIGHT_COLLAPSED_KEY);
            if (storedCollapsed !== null) collapsed = storedCollapsed === "true";
            if (storedRightCollapsed !== null) rightCollapsed = storedRightCollapsed === "true";
        } catch (_) {}
        sidebarWidth = Number.isFinite(storedWidth) && storedWidth > 0
            ? clampWidth(storedWidth)
            : clampWidth(SIDEBAR_DEFAULT_WIDTH);
        rightSidebarWidth = Number.isFinite(storedRightWidth) && storedRightWidth > 0
            ? clampWidth(storedRightWidth)
            : clampWidth(SIDEBAR_DEFAULT_WIDTH);
        sidebarStateHydrated = true;

        const handleViewportResize = () => {
            if (!isMobile && sidebarWidth !== null) sidebarWidth = clampWidth(sidebarWidth);
            if (!isMobile && rightSidebarWidth !== null) rightSidebarWidth = clampWidth(rightSidebarWidth);
        };
        window.addEventListener("resize", handleViewportResize);
        return () => {
            window.removeEventListener("resize", handleViewportResize);
            clearHoverTimers();
            clearRightHoverTimers();
            stopResize?.();
        };
    });

    $: activeDrawerSection = initialSection;
    $: {
        if (prevIsMobile && !isMobile) collapsed = false;
        prevIsMobile = isMobile;
    }
    // Edição só faz sentido com a coluna expandida.
    $: if ($menuEditMode && collapsed) collapsed = false;
    $: if (sidebarStateHydrated) {
        try {
            localStorage.setItem(LEFT_COLLAPSED_KEY, String(collapsed));
            localStorage.setItem(RIGHT_COLLAPSED_KEY, String(rightCollapsed));
        } catch (_) {}
    }

    function handleSelectSession(e) { dispatch("selectSession", e.detail); }
    function handleOpenApp(e) { dispatch("openApp", e.detail); }
    function handleAppInfo(e) { dispatch("appInfo", e.detail); }
    function handleDeleteSession(e) { dispatch("deleteSession", e.detail); }
    function handleClose() { dispatch("close"); }
    function handleSelectApp(e) { dispatch("selectApp", e.detail); }
    function handleCloseApp(e) { dispatch("closeApp", e.detail); }
    function handleCloseAllApps() { dispatch("closeAllApps"); }
    function handleReorderApps(e) { dispatch("reorderApps", e.detail); }
    function handleSelectChat(e) { dispatch("selectChat", e.detail); }
    function handleCloseChat(e) { dispatch("closeChat", e.detail); }
    function handleCloseAllChats() { dispatch("closeAllChats"); }
    function handleTogglePin(e) { dispatch("togglePin", e.detail); }
    function handleToggleTheme() { dispatch("toggleTheme"); }
    function handleNewTopic() { dispatch("clear"); handleClose(); }
    function collapseSidebar() {
        leftEditMode = false;
        clearHoverTimers();
        hoverPreview = false;
        collapsed = true;
    }
    function openSidebar() {
        clearHoverTimers();
        hoverPreview = false;
        collapsed = false;
    }
    function collapseRightSidebar() {
        rightEditMode = false;
        clearRightHoverTimers();
        rightHoverPreview = false;
        rightCollapsed = true;
    }
    function openRightSidebar() {
        clearRightHoverTimers();
        rightHoverPreview = false;
        rightCollapsed = false;
    }
    function toggleLeftEditMode() { leftEditMode = !leftEditMode; }
    function toggleRightEditMode() { rightEditMode = !rightEditMode; }
    function showHoverPreview() {
        if (!collapsed || hoverPreview || hoverOpenTimer !== null) return;
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
        hoverOpenTimer = setTimeout(() => {
            hoverOpenTimer = null;
            if (collapsed) hoverPreview = true;
        }, HOVER_OPEN_DELAY);
    }
    function cancelHoverPreviewOpen() {
        if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
        hoverOpenTimer = null;
    }
    function handleHoverPreviewEnter() {
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
    }
    function handleHoverPreviewLeave() {
        cancelHoverPreviewOpen();
        if (!collapsed || !hoverPreview) return;
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(() => {
            hoverCloseTimer = null;
            if (collapsed) hoverPreview = false;
        }, HOVER_CLOSE_DELAY);
    }
    function showRightHoverPreview() {
        if (!rightCollapsed || rightHoverPreview || rightHoverOpenTimer !== null) return;
        if (rightHoverCloseTimer !== null) clearTimeout(rightHoverCloseTimer);
        rightHoverCloseTimer = null;
        rightHoverOpenTimer = setTimeout(() => {
            rightHoverOpenTimer = null;
            if (rightCollapsed) rightHoverPreview = true;
        }, HOVER_OPEN_DELAY);
    }
    function cancelRightHoverPreviewOpen() {
        if (rightHoverOpenTimer !== null) clearTimeout(rightHoverOpenTimer);
        rightHoverOpenTimer = null;
    }
    function handleRightHoverPreviewEnter() {
        if (rightHoverCloseTimer !== null) clearTimeout(rightHoverCloseTimer);
        rightHoverCloseTimer = null;
    }
    function handleRightHoverPreviewLeave() {
        cancelRightHoverPreviewOpen();
        if (!rightCollapsed || !rightHoverPreview) return;
        if (rightHoverCloseTimer !== null) clearTimeout(rightHoverCloseTimer);
        rightHoverCloseTimer = setTimeout(() => {
            rightHoverCloseTimer = null;
            if (rightCollapsed) rightHoverPreview = false;
        }, HOVER_CLOSE_DELAY);
    }
    function startResize(event, side = "left") {
        if (isMobile) return;
        event.preventDefault();
        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        const maxWidth = () => Math.max(SIDEBAR_MIN_WIDTH, window.innerWidth * 0.25);
        const move = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            const rawWidth = side === "right"
                ? window.innerWidth - moveEvent.clientX
                : moveEvent.clientX;
            const nextWidth = Math.min(maxWidth(), Math.max(SIDEBAR_MIN_WIDTH, rawWidth));
            if (side === "right") rightSidebarWidth = nextWidth;
            else sidebarWidth = nextWidth;
            if (moveEvent.altKey) {
                sidebarWidth = nextWidth;
                rightSidebarWidth = nextWidth;
            }
        };
        let finished = false;
        const end = () => {
            if (finished) return;
            finished = true;
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            window.removeEventListener("blur", end);
            handle.removeEventListener("lostpointercapture", end);
            if (handle.hasPointerCapture?.(pointerId)) handle.releasePointerCapture(pointerId);
            document.body.style.cursor = "";
            document.body.style.userSelect = "";
            try {
                localStorage.setItem(LEFT_WIDTH_KEY, String(Math.round(sidebarWidth)));
                localStorage.setItem(RIGHT_WIDTH_KEY, String(Math.round(rightSidebarWidth)));
            } catch (_) {}
            stopResize = null;
        };
        stopResize?.();
        stopResize = end;
        document.body.style.cursor = "col-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("blur", end);
        handle.addEventListener("lostpointercapture", end);
        handle.setPointerCapture?.(pointerId);
    }
    // Desktop/Shell switching controls are intentionally kept out of the
    // header for now. Their routes can return here if that navigation does.
    function returnToModeChoice() { dispatch("returnToModeChoice"); }

    // Fechar o painel/sidebar sai também do modo edição (evita reabrir já em
    // edição sem intenção).
    function closeAll() { setMenuEditMode(false); handleClose(); }

    // Variantes de callback: no mobile, abrir/selecionar fecha o painel; no
    // desktop, não.
    const openAppMobile = (e) => { handleOpenApp(e); handleClose(); };
    const showAppInfoMobile = (e) => { handleAppInfo(e); handleClose(); };
    const selectAppMobile = (e) => { handleSelectApp(e); handleClose(); };
    const selectChatMobile = (e) => { handleSelectChat(e); handleClose(); };
</script>

{#if isMobile}
    <!-- ── Painel esquerdo (Docks & sessões) ── -->
    <aside
        class="mobile-drawer mobile-drawer-left"
        style="
            background: var(--rail-bg);
            padding-top: var(--safe-top, env(safe-area-inset-top));
            padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));
            transform: {mobilePanel === 'left' ? 'translateX(0)' : 'translateX(-100%)'};
            transition: transform 0.32s cubic-bezier(0.32,0.72,0,1);
            pointer-events: {mobilePanel === 'left' ? 'auto' : 'none'};
        "
        aria-hidden={mobilePanel !== 'left'}
        aria-label="Workstation and conversations"
    >
        <!-- Header mobile: Σ em Ubuntu semibold + botões chapados -->
        <div class="hdr">
            <span class="sigma-loose sigma-mobile">Σ</span>
            {#if $menuEditMode}
                <button class="hdr-btn" on:click={handleToggleTheme} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
                    {#if theme === "dark"}
                        <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    {:else}
                        <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                    {/if}
                </button>
            {/if}
            <button class="hdr-btn" class:active={$menuEditMode} on:click={toggleMenuEditMode} aria-label={$menuEditMode ? "Finish editing" : "Edit menu"} title={$menuEditMode ? "Finish" : "Edit menu"}>
                {#if $menuEditMode}
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                {:else}
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                {/if}
            </button>
            <!-- Desktop/Shell shortcuts reserved for a future navigation revision. -->
            {#if nativeApp}
                <button class="hdr-btn" on:click={returnToModeChoice} aria-label="Return to mode selection" title="Return to mode selection">
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M8 2.25H3.5a1 1 0 00-1 1v9.5a1 1 0 001 1H8M8.5 5l3 3-3 3M11.25 8H5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            {/if}
            <button class="hdr-btn" on:click={closeAll} aria-label="Close">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>

        <!-- Body -->
        <div class="drawer-scroll flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3 overscroll-contain [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            <MenuList
                context="left"
                editMode={$menuEditMode}
                widgetsEnabled={mobilePanel === 'left'}
                appsLauncher
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={openAppMobile}
                onAppInfo={showAppInfoMobile}
                onSelectApp={selectAppMobile}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
                onReorderApps={handleReorderApps}
                onSelectChat={selectChatMobile}
                onCloseChat={handleCloseChat}
                onCloseAllChats={handleCloseAllChats}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onTogglePin={handleTogglePin}
                onNewTopic={handleNewTopic}
            />
        </div>
    </aside>

    <!-- ── Painel direito: Apps ── -->
    <aside
        class="mobile-drawer mobile-drawer-right"
        style="
            background: var(--rail-bg);
            padding-top: var(--safe-top, env(safe-area-inset-top));
            padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));
            transform: {mobilePanel === 'right' ? 'translateX(0)' : 'translateX(100%)'};
            transition: transform 0.32s cubic-bezier(0.32,0.72,0,1);
            pointer-events: {mobilePanel === 'right' ? 'auto' : 'none'};
        "
        aria-hidden={mobilePanel !== 'right'}
        aria-label="Sigma"
    >
        <div class="hdr">
            <span class="sigma-loose sigma-mobile">Σ</span>
            {#if $menuEditMode}
                <button class="hdr-btn" on:click={handleToggleTheme} aria-label={theme === "dark" ? "Light theme" : "Dark theme"} title={theme === "dark" ? "Light theme" : "Dark theme"}>
                    {#if theme === "dark"}
                        <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                    {:else}
                        <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                    {/if}
                </button>
            {/if}
            <button class="hdr-btn" class:active={$menuEditMode} on:click={toggleMenuEditMode} aria-label={$menuEditMode ? "Finish editing" : "Edit menu"} title={$menuEditMode ? "Finish" : "Edit menu"}>
                {#if $menuEditMode}
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                {:else}
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                {/if}
            </button>
            <!-- Desktop/Shell shortcuts reserved for a future navigation revision. -->
            {#if nativeApp}
                <button class="hdr-btn" on:click={returnToModeChoice} aria-label="Return to mode selection" title="Return to mode selection">
                    <svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M8 2.25H3.5a1 1 0 00-1 1v9.5a1 1 0 001 1H8M8.5 5l3 3-3 3M11.25 8H5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>
                </button>
            {/if}
            <button class="hdr-btn" on:click={closeAll} aria-label="Close">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>

        <div class="drawer-scroll flex-1 overflow-y-auto px-4 pb-4 pt-4 overscroll-contain [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            <MenuList
                context="right"
                editMode={$menuEditMode}
                widgetsEnabled={mobilePanel === 'right'}
                appsLauncher
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={openAppMobile}
                onAppInfo={showAppInfoMobile}
                onSelectApp={selectAppMobile}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
                onReorderApps={handleReorderApps}
                onSelectChat={selectChatMobile}
                onCloseChat={handleCloseChat}
                onCloseAllChats={handleCloseAllChats}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onTogglePin={handleTogglePin}
                onNewTopic={handleNewTopic}
            />
        </div>
    </aside>
{:else}
    <!-- ══ DESKTOP: Sidebar ══ -->
    <div
        class="desktop-sidebar-slot"
        class:collapsed
        style="width: {collapsed
            ? (hoverPreview ? `${sidebarWidth === null ? SIDEBAR_DEFAULT_WIDTH : sidebarWidth}px` : '0px')
            : (sidebarWidth === null ? `${SIDEBAR_DEFAULT_WIDTH}px` : `${sidebarWidth}px`)};"
        on:mouseenter={handleHoverPreviewEnter}
        on:mouseleave={handleHoverPreviewLeave}
    >
    {#if collapsed}
        <div class="sidebar-edge-trigger sidebar-edge-trigger-top" on:mouseenter={showHoverPreview} on:mouseleave={cancelHoverPreviewOpen} aria-hidden="true"></div>
        <div class="sidebar-edge-trigger sidebar-edge-trigger-bottom" on:mouseenter={showHoverPreview} on:mouseleave={cancelHoverPreviewOpen} aria-hidden="true"></div>
    {/if}
        <aside
            class="desktop-sidebar relative z-2 flex h-[100dvh] flex-col"
            class:hover-preview={collapsed && hoverPreview}
            class:sidebar-hidden={collapsed && !hoverPreview}
            style="width: {sidebarWidth === null ? `${SIDEBAR_DEFAULT_WIDTH}px` : `${sidebarWidth}px`}; border-right: 1px solid var(--rail-border); background: var(--rail-bg);"
        >
        <!-- Brand / header padronizado -->
        <div class="hdr">
            <span class="sigma-loose">Σ</span>
            <div class="desktop-hdr-actions">
                {#if leftEditMode}
                    <button class="hdr-btn" on:click={handleToggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label={theme === "dark" ? "Light theme" : "Dark theme"}>
                        {#if theme === "dark"}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                        {:else}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                        {/if}
                    </button>
                {/if}
                <button class="hdr-btn" class:active={leftEditMode} on:click={toggleLeftEditMode} title={leftEditMode ? "Finish" : "Edit menu"} aria-label={leftEditMode ? "Finish editing" : "Edit menu"}>
                    {#if leftEditMode}
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {:else}
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                    {/if}
                </button>
                <!-- Desktop/Shell shortcuts reserved for a future navigation revision. -->
                {#if nativeApp}
                    <button class="hdr-btn" on:click={returnToModeChoice} title="Return to mode selection" aria-label="Return to mode selection">
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15" aria-hidden="true"><path d="M8 2.25H3.5a1 1 0 00-1 1v9.5a1 1 0 001 1H8M8.5 5l3 3-3 3M11.25 8H5" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                {/if}
            </div>
        </div>

        <div class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[var(--rail-border-hi)]">
            <MenuList
                context="left"
                editMode={leftEditMode}
                guardWindows
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={handleOpenApp}
                onAppInfo={handleAppInfo}
                onSelectApp={handleSelectApp}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
                onReorderApps={handleReorderApps}
                onSelectChat={handleSelectChat}
                onCloseChat={handleCloseChat}
                onCloseAllChats={handleCloseAllChats}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onTogglePin={handleTogglePin}
                onNewTopic={handleNewTopic}
            />
        </div>
        <div class="sidebar-resize-handle" role="separator" aria-orientation="vertical" aria-label="Resize sidebar" on:pointerdown={startResize}></div>
        </aside>
    </div>
    <button
        class="sidebar-toggle"
        class:collapsed
        class:preview-hidden={hoverPreview}
        style="left: {collapsed ? '2px' : `${(sidebarWidth === null ? SIDEBAR_DEFAULT_WIDTH : sidebarWidth) + 8}px`};"
        on:click={collapsed ? openSidebar : collapseSidebar}
        title={collapsed ? "Keep sidebar open" : "Close sidebar"}
        aria-label={collapsed ? "Keep sidebar open" : "Close sidebar"}
    >
        <svg viewBox="0 0 16 26" fill="none" width="16" height="26" aria-hidden="true"><path d="M11 3.5L5 13l6 9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>

    <!-- A segunda coluna é a contraparte desktop do painel direito mobile. -->
    <div
        class="desktop-sidebar-slot desktop-sidebar-right-slot"
        data-menu-context="right"
        class:collapsed={rightCollapsed}
        style="width: {rightCollapsed
            ? (rightHoverPreview ? `${rightSidebarWidth === null ? SIDEBAR_DEFAULT_WIDTH : rightSidebarWidth}px` : '0px')
            : (rightSidebarWidth === null ? `${SIDEBAR_DEFAULT_WIDTH}px` : `${rightSidebarWidth}px`)};"
        on:mouseenter={handleRightHoverPreviewEnter}
        on:mouseleave={handleRightHoverPreviewLeave}
    >
        {#if rightCollapsed}
            <div class="sidebar-edge-trigger sidebar-edge-trigger-top" on:mouseenter={showRightHoverPreview} on:mouseleave={cancelRightHoverPreviewOpen} aria-hidden="true"></div>
            <div class="sidebar-edge-trigger sidebar-edge-trigger-bottom" on:mouseenter={showRightHoverPreview} on:mouseleave={cancelRightHoverPreviewOpen} aria-hidden="true"></div>
        {/if}
        <aside
            class="desktop-sidebar desktop-sidebar-right relative z-2 flex h-[100dvh] flex-col"
            class:hover-preview={rightCollapsed && rightHoverPreview}
            class:sidebar-hidden={rightCollapsed && !rightHoverPreview}
            style="width: {rightSidebarWidth === null ? `${SIDEBAR_DEFAULT_WIDTH}px` : `${rightSidebarWidth}px`}; border-left: 1px solid var(--rail-border); background: var(--rail-bg);"
        >
            <div class="hdr">
                <!-- This is a distinct menu context, not a second rendering of
                     the left rail. Keep the destination explicit in the
                     desktop chrome as it already is in the mobile drawer. -->
                <span class="sigma-loose" aria-label="Sigma">Σ</span>
                <div class="desktop-hdr-actions">
                    {#if rightEditMode}
                        <button class="hdr-btn" on:click={handleToggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label={theme === "dark" ? "Light theme" : "Dark theme"}>
                            {#if theme === "dark"}
                                <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                            {:else}
                                <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                            {/if}
                        </button>
                    {/if}
                    <button class="hdr-btn" class:active={rightEditMode} on:click={toggleRightEditMode} title={rightEditMode ? "Finish" : "Edit menu"} aria-label={rightEditMode ? "Finish editing" : "Edit menu"}>
                        {#if rightEditMode}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        {:else}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                        {/if}
                    </button>
                    <button class="hdr-btn" on:click={collapseRightSidebar} title="Close right sidebar" aria-label="Close right sidebar">
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M6.25 2.5H2.5v3.75M9.75 2.5h3.75v3.75M13.5 9.75v3.75H9.75M2.5 9.75v3.75h3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                </div>
            </div>

            <div class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[var(--rail-border-hi)]">
                <MenuList
                    context="right"
                    editMode={rightEditMode}
                    appsLauncher
                    {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                    onOpenApp={handleOpenApp}
                    onAppInfo={handleAppInfo}
                    onSelectApp={handleSelectApp}
                    onCloseApp={handleCloseApp}
                    onCloseAllApps={handleCloseAllApps}
                    onReorderApps={handleReorderApps}
                    onSelectChat={handleSelectChat}
                    onCloseChat={handleCloseChat}
                    onCloseAllChats={handleCloseAllChats}
                    onSelectSession={handleSelectSession}
                    onDeleteSession={handleDeleteSession}
                    onTogglePin={handleTogglePin}
                    onNewTopic={handleNewTopic}
                />
            </div>
            <div class="sidebar-resize-handle sidebar-resize-handle-right" role="separator" aria-orientation="vertical" aria-label="Resize right sidebar" on:pointerdown={(event) => startResize(event, "right")}></div>
        </aside>
    </div>
    <button
        class="sidebar-toggle sidebar-toggle-right"
        class:collapsed={rightCollapsed}
        class:preview-hidden={rightHoverPreview}
        style="right: {rightCollapsed ? '2px' : `${(rightSidebarWidth === null ? SIDEBAR_DEFAULT_WIDTH : rightSidebarWidth) + 8}px`};"
        on:click={rightCollapsed ? openRightSidebar : collapseRightSidebar}
        title={rightCollapsed ? "Open right sidebar" : "Close right sidebar"}
        aria-label={rightCollapsed ? "Open right sidebar" : "Close right sidebar"}
    >
        <svg viewBox="0 0 16 26" fill="none" width="16" height="26" aria-hidden="true"><path d="M5 3.5l6 9.5-6 9.5" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
{/if}

<style>
  /* These drawers are part of the Shell's structural layout. Keep their
     geometry in component CSS instead of relying on host Tailwind utilities:
     the Edge runtime compiles Svelte by itself and intentionally has no
     application-wide Tailwind stylesheet. Without this rule the two asides
     become ordinary flex children and squeeze .main-area to zero width. */
  .mobile-drawer {
    position: fixed;
    inset-block: 0;
    z-index: 10;
    display: flex;
    flex-direction: column;
    box-sizing: border-box;
    height: 100dvh;
    overflow: hidden;
  }
  .mobile-drawer-left {
    left: 0;
    width: min(86vw, 340px);
  }
  .mobile-drawer-right {
    right: 0;
    width: min(92vw, 400px);
  }
  .drawer-scroll {
    flex: 1 1 0%;
    min-height: 0;
    overflow-y: auto;
    overscroll-behavior: contain;
    -webkit-overflow-scrolling: touch;
  }
  @keyframes -global-mp-fade { from { opacity: 0 } to { opacity: 1 } }

  /* ── Header padronizado (desktop + os 2 painéis mobile) ──
     Σ solto em Ubuntu, sem caixa; botões chapados sem borda. */
  .hdr {
    display: flex;
    align-items: center;
    gap: 8px;
    flex-shrink: 0;
    min-height: 60px;
    padding: 12px 16px;
    border-bottom: 1px solid var(--rail-border);
  }
  .sigma-loose {
    flex-shrink: 0;
    font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
    font-size: 22px;
    font-weight: 600;
    line-height: 1;
    color: var(--rail-txt);
  }
  .sigma-mobile {
    margin-right: auto;
  }
  .desktop-hdr-actions {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-left: auto;
  }
  .sidebar-context-label {
    margin-right: auto;
    color: var(--rail-txt);
    font-family: var(--tk-font);
    font-size: 12px;
    font-weight: 700;
    letter-spacing: 0.08em;
    text-transform: uppercase;
  }
  /* Chapado sem bordas: só o ícone, realce discreto no hover/ativo. */
  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    border: none;
    border-radius: 10px;
    background: transparent;
    color: var(--rail-txt-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.15s, background 0.15s;
  }
  .hdr-btn:hover { color: var(--rail-txt); background: var(--rail-flat); }
  .hdr-btn.active { color: var(--rail-txt); background: var(--rail-flat); }

  .desktop-sidebar-slot {
    position: relative;
    z-index: 30;
    height: 100dvh;
    min-width: 0;
    flex: 0 0 auto;
    transition: width 260ms cubic-bezier(0.22, 0.75, 0.18, 1);
  }
  .desktop-sidebar-right-slot { order: 2; }
  .sidebar-toggle {
    position: fixed;
    z-index: 50;
    top: 50%;
    display: flex;
    width: 24px;
    height: 46px;
    align-items: center;
    justify-content: center;
    border: 0;
    border-radius: 0;
    background: transparent;
    color: var(--rail-txt-2);
    box-shadow: none;
    cursor: pointer;
    transform: translateY(-50%);
    opacity: 0.46;
    transition: left 260ms cubic-bezier(0.22, 0.75, 0.18, 1), transform 260ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease, color 180ms ease;
    -webkit-tap-highlight-color: transparent;
  }
  .sidebar-toggle.collapsed { transform: translateY(-50%) rotate(180deg); }
  .sidebar-toggle-right { left: auto; transition-property: right, transform, opacity, color; }
  .sidebar-toggle:hover { color: var(--rail-txt); background: transparent; opacity: 0.9; }
  .sidebar-toggle:active { opacity: 0.72; }
  .sidebar-toggle:focus-visible { outline: 2px solid var(--rail-border-hi); outline-offset: 2px; }
  .sidebar-toggle.preview-hidden { opacity: 0; pointer-events: none; }

  .sidebar-edge-trigger {
    position: absolute;
    z-index: 29;
    left: 0;
    width: 28px;
  }
  .sidebar-edge-trigger-top { top: 0; bottom: calc(50% + 36px); }
  .sidebar-edge-trigger-bottom { top: calc(50% + 36px); bottom: 0; }
  .desktop-sidebar-right-slot .sidebar-edge-trigger { left: auto; right: 0; }

  .desktop-sidebar {
    position: absolute;
    inset-block: 0;
    left: 0;
    z-index: 30;
    min-width: 244px;
    max-width: max(244px, 25vw);
    flex: 0 0 auto;
    transform: translateX(0);
    opacity: 1;
    box-shadow: 4px 0 16px rgba(0, 0, 0, 0.12), 1px 0 0 rgba(255, 255, 255, 0.025);
    transition: transform 260ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease, box-shadow 180ms ease;
    will-change: transform;
  }
  .desktop-sidebar-right {
    left: auto;
    right: 0;
    box-shadow: -4px 0 16px rgba(0, 0, 0, 0.12), -1px 0 0 rgba(255, 255, 255, 0.025);
  }
  .desktop-sidebar.sidebar-hidden {
    transform: translateX(-100%);
    opacity: 0.92;
    pointer-events: none;
  }
  /* Must come after the generic hidden state: both selectors have the same
     specificity. The right rail closes out through the right edge, while its
     collapsed chevron points left to reveal it back into the workspace. */
  .desktop-sidebar-right.sidebar-hidden { transform: translateX(100%); }
  .desktop-sidebar.hover-preview {
    box-shadow: 6px 0 20px rgba(0, 0, 0, 0.16), 1px 0 0 rgba(255, 255, 255, 0.03);
  }
  .desktop-sidebar-right.hover-preview {
    box-shadow: -6px 0 20px rgba(0, 0, 0, 0.16), -1px 0 0 rgba(255, 255, 255, 0.03);
  }
  .sidebar-resize-handle {
    position: absolute;
    z-index: 3;
    inset-block: 0;
    right: -4px;
    width: 8px;
    cursor: col-resize;
    touch-action: none;
  }
  .sidebar-resize-handle:hover { background: color-mix(in srgb, var(--rail-border-hi) 45%, transparent); }
  .sidebar-resize-handle-right { left: -4px; right: auto; }
  @media (prefers-reduced-motion: reduce) {
    .desktop-sidebar-slot, .desktop-sidebar, .sidebar-toggle { transition-duration: 1ms; }
  }
</style>
