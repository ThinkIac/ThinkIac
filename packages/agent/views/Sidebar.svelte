<script>
    import { createEventDispatcher, tick } from "svelte";
    import { fly } from "svelte/transition";
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

    export let appTabs = [];
    export let chatTabs = [];
    export let activeTab = "";
    export let activeIsApp = false;
    export let loadingMap = {};
    export let unreadMap = {};
    export let collapsed = false;
    // No desktop, a coluna direita segue a mesma mecânica independente da
    // esquerda, mas nasce recolhida para não disputar espaço com o chat.
    export let rightCollapsed = true;

    const dispatch = createEventDispatcher();

    let prevIsMobile = isMobile;
    let previousMobilePanel = mobilePanel;
    let previousCollapsed = collapsed;
    let previousRightCollapsed = rightCollapsed;
    let leftScrollEl;
    let rightScrollEl;
    let desktopScrollEl;
    let rightDesktopScrollEl;

    $: activeDrawerSection = initialSection;
    $: {
        if (prevIsMobile && !isMobile) collapsed = false;
        prevIsMobile = isMobile;
    }
    // Os painéis permanecem montados durante a transição. Ao reabri-los,
    // restaura a posição inicial sem animação de scroll.
    $: {
        const openedMobilePanel = isMobile && mobilePanel && mobilePanel !== previousMobilePanel;
        const reopenedDesktopSidebar = !isMobile && !collapsed && previousCollapsed;
        const reopenedDesktopRightSidebar = !isMobile && !rightCollapsed && previousRightCollapsed;

        if (openedMobilePanel || reopenedDesktopSidebar || reopenedDesktopRightSidebar) {
            tick().then(() => {
                const scrollEl = mobilePanel === "left"
                    ? leftScrollEl
                    : mobilePanel === "right"
                        ? rightScrollEl
                        : reopenedDesktopSidebar
                            ? desktopScrollEl
                            : reopenedDesktopRightSidebar
                                ? rightDesktopScrollEl
                                : null;
                if (scrollEl) scrollEl.scrollTop = 0;
            });
        }

        previousMobilePanel = mobilePanel;
        previousCollapsed = collapsed;
        previousRightCollapsed = rightCollapsed;
    }
    // Edição só faz sentido com a coluna expandida.
    $: if ($menuEditMode && collapsed) collapsed = false;

    function handleSelectSession(e) { dispatch("selectSession", e.detail); }
    function handleOpenApp(e) { dispatch("openApp", e.detail); }
    function handleDeleteSession(e) { dispatch("deleteSession", e.detail); }
    function handleClose() { dispatch("close"); }
    function handleSelectApp(e) { dispatch("selectApp", e.detail); }
    function handleCloseApp(e) { dispatch("closeApp", e.detail); }
    function handleCloseAllApps() { dispatch("closeAllApps"); }
    function handleSelectChat(e) { dispatch("selectChat", e.detail); }
    function handleCloseChat(e) { dispatch("closeChat", e.detail); }
    function handleCloseAllChats() { dispatch("closeAllChats"); }
    function handleTogglePin(e) { dispatch("togglePin", e.detail); }
    function handleToggleTheme() { dispatch("toggleTheme"); }
    function handleNewTopic() { dispatch("clear"); handleClose(); }
    function collapseSidebar() {
        setMenuEditMode(false);
        collapsed = true;
    }
    function collapseRightSidebar() {
        setMenuEditMode(false);
        rightCollapsed = true;
    }

    // Fechar o painel/sidebar sai também do modo edição (evita reabrir já em
    // edição sem intenção).
    function closeAll() { setMenuEditMode(false); handleClose(); }

    // Variantes de callback: no mobile, abrir/selecionar fecha o painel; no
    // desktop, não.
    const openAppMobile = (e) => { handleOpenApp(e); handleClose(); };
    const selectAppMobile = (e) => { handleSelectApp(e); handleClose(); };
    const selectChatMobile = (e) => { handleSelectChat(e); handleClose(); };
</script>

{#if isMobile}
    <!-- ── Painel esquerdo (Docks & sessões) ── -->
    <aside
        class="fixed inset-y-0 left-0 z-10 flex w-[min(86vw,340px)] flex-col"
        style="
            background: var(--rail-bg);
            padding-top: var(--safe-top, env(safe-area-inset-top));
            padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));
            transform: {mobilePanel === 'left' ? 'translateX(0)' : 'translateX(-100%)'};
            transition: transform 0.32s cubic-bezier(0.32,0.72,0,1);
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
            <button class="hdr-btn" on:click={closeAll} aria-label="Close">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>

        <!-- Body -->
        <div bind:this={leftScrollEl} class="flex flex-1 flex-col gap-4 overflow-y-auto px-4 pb-4 pt-3 overscroll-contain [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            <MenuList
                context="left"
                editMode={$menuEditMode}
                appsLauncher
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={openAppMobile}
                onSelectApp={selectAppMobile}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
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
        class="fixed inset-y-0 right-0 z-10 flex w-[min(92vw,400px)] flex-col"
        style="
            background: var(--rail-bg);
            padding-top: var(--safe-top, env(safe-area-inset-top));
            padding-bottom: var(--safe-bottom, env(safe-area-inset-bottom));
            transform: {mobilePanel === 'right' ? 'translateX(0)' : 'translateX(100%)'};
            transition: transform 0.32s cubic-bezier(0.32,0.72,0,1);
        "
        aria-hidden={mobilePanel !== 'right'}
        aria-label="Packages"
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
            <button class="hdr-btn" on:click={closeAll} aria-label="Close">
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" width="16" height="16"><path d="M4 4l8 8M12 4l-8 8"/></svg>
            </button>
        </div>

        <div bind:this={rightScrollEl} class="flex-1 overflow-y-auto px-4 pb-4 pt-4 overscroll-contain [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            <MenuList
                context="right"
                editMode={$menuEditMode}
                appsLauncher
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={openAppMobile}
                onSelectApp={selectAppMobile}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
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
    {#if collapsed}
        <button
            class="sidebar-reopen"
            on:click={() => (collapsed = false)}
            title="Open sidebar"
            aria-label="Open sidebar"
            in:fly={{ y: 10, duration: 220 }}
            out:fly={{ y: 10, duration: 180 }}
        >
            <svg viewBox="0 0 18 18" fill="none" width="17" height="17" aria-hidden="true">
                <rect x="2.25" y="2.25" width="13.5" height="13.5" rx="2.5" stroke="currentColor" stroke-width="1.35"/>
                <path d="M6.5 2.75v12.5M9 6.25L11.75 9 9 11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
    {:else}
        <aside
            in:fly={{ x: -244, duration: 260, opacity: 1 }}
            out:fly={{ x: -244, duration: 240, opacity: 1 }}
            class="relative z-2 flex h-[100dvh] w-[244px] min-w-[244px] flex-col"
            style="border-right: 1px solid var(--rail-border); background: var(--rail-bg);"
        >
        <!-- Brand / header padronizado -->
        <div class="hdr">
            <span class="sigma-loose">Σ</span>
            <div class="desktop-hdr-actions">
                {#if $menuEditMode}
                    <button class="hdr-btn" on:click={handleToggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label={theme === "dark" ? "Light theme" : "Dark theme"}>
                        {#if theme === "dark"}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                        {:else}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                        {/if}
                    </button>
                {/if}
                <button class="hdr-btn" class:active={$menuEditMode} on:click={toggleMenuEditMode} title={$menuEditMode ? "Finish" : "Edit menu"} aria-label={$menuEditMode ? "Finish editing" : "Edit menu"}>
                    {#if $menuEditMode}
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    {:else}
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                    {/if}
                </button>
                <button
                    class="hdr-btn"
                    on:click={collapseSidebar}
                    title="Enter fullscreen"
                    aria-label="Enter fullscreen"
                >
                    <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
                        <path d="M6.25 2.5H2.5v3.75M9.75 2.5h3.75v3.75M13.5 9.75v3.75H9.75M2.5 9.75v3.75h3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            </div>
        </div>

        <div bind:this={desktopScrollEl} class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[var(--rail-border-hi)]">
            <MenuList
                context="left"
                editMode={$menuEditMode}
                {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                onOpenApp={handleOpenApp}
                onSelectApp={handleSelectApp}
                onCloseApp={handleCloseApp}
                onCloseAllApps={handleCloseAllApps}
                onSelectChat={handleSelectChat}
                onCloseChat={handleCloseChat}
                onCloseAllChats={handleCloseAllChats}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onTogglePin={handleTogglePin}
                onNewTopic={handleNewTopic}
            />
        </div>
        </aside>
    {/if}

    {#if rightCollapsed}
        <button
            class="sidebar-reopen sidebar-reopen-right"
            on:click={() => (rightCollapsed = false)}
            title="Open right sidebar"
            aria-label="Open right sidebar"
            in:fly={{ y: 10, duration: 220 }}
            out:fly={{ y: 10, duration: 180 }}
        >
            <svg viewBox="0 0 18 18" fill="none" width="17" height="17" aria-hidden="true">
                <rect x="2.25" y="2.25" width="13.5" height="13.5" rx="2.5" stroke="currentColor" stroke-width="1.35"/>
                <path d="M11.5 2.75v12.5M9 6.25L6.25 9 9 11.75" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>
        </button>
    {:else}
        <aside
            in:fly={{ x: 244, duration: 260, opacity: 1 }}
            out:fly={{ x: 244, duration: 240, opacity: 1 }}
            class="desktop-sidebar-right relative z-2 flex h-[100dvh] w-[244px] min-w-[244px] flex-col"
            style="border-left: 1px solid var(--rail-border); background: var(--rail-bg);"
        >
            <div class="hdr">
                <span class="sigma-loose">Σ</span>
                <div class="desktop-hdr-actions">
                    {#if $menuEditMode}
                        <button class="hdr-btn" on:click={handleToggleTheme} title={theme === "dark" ? "Light theme" : "Dark theme"} aria-label={theme === "dark" ? "Light theme" : "Dark theme"}>
                            {#if theme === "dark"}
                                <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/><path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
                            {:else}
                                <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/></svg>
                            {/if}
                        </button>
                    {/if}
                    <button class="hdr-btn" class:active={$menuEditMode} on:click={toggleMenuEditMode} title={$menuEditMode ? "Finish" : "Edit menu"} aria-label={$menuEditMode ? "Finish editing" : "Edit menu"}>
                        {#if $menuEditMode}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M3.5 8.5l3 3 6-6.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                        {:else}
                            <svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="M8 5.3a2.7 2.7 0 100 5.4 2.7 2.7 0 000-5.4z" stroke="currentColor" stroke-width="1.3"/><path d="M13.2 8c0 .34-.03.66-.08.97l1.36 1.06-1.36 2.36-1.6-.54c-.5.4-1.08.72-1.7.94l-.25 1.7H6.43l-.25-1.7a5.3 5.3 0 01-1.7-.94l-1.6.54-1.36-2.36 1.36-1.06A5.4 5.4 0 012.8 8c0-.34.03-.66.08-.97L1.52 5.97l1.36-2.36 1.6.54c.5-.4 1.08-.72 1.7-.94l.25-1.7h3.14l.25 1.7c.62.22 1.2.54 1.7.94l1.6-.54 1.36 2.36-1.36 1.06c.05.31.08.63.08.97z" stroke="currentColor" stroke-width="1.15" stroke-linejoin="round"/></svg>
                        {/if}
                    </button>
                    <button class="hdr-btn" on:click={collapseRightSidebar} title="Close right sidebar" aria-label="Close right sidebar">
                        <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
                            <path d="M6.25 2.5H2.5v3.75M9.75 2.5h3.75v3.75M13.5 9.75v3.75H9.75M2.5 9.75v3.75h3.75" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                </div>
            </div>

            <div bind:this={rightDesktopScrollEl} class="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-3 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[var(--rail-border-hi)]">
                <MenuList
                    context="right"
                    editMode={$menuEditMode}
                    appsLauncher
                    {appTabs} {chatTabs} {activeTab} {loadingMap} {unreadMap} {refreshTrigger} {sessionId} {activeIsApp} {theme}
                    onOpenApp={handleOpenApp}
                    onSelectApp={handleSelectApp}
                    onCloseApp={handleCloseApp}
                    onCloseAllApps={handleCloseAllApps}
                    onSelectChat={handleSelectChat}
                    onCloseChat={handleCloseChat}
                    onCloseAllChats={handleCloseAllChats}
                    onSelectSession={handleSelectSession}
                    onDeleteSession={handleDeleteSession}
                    onTogglePin={handleTogglePin}
                    onNewTopic={handleNewTopic}
                />
            </div>
        </aside>
    {/if}
{/if}

<style>
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
  /* Chapado sem bordas: só o ícone, realce discreto no hover/ativo. */
  .hdr-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 34px;
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

  .sidebar-reopen {
    position: fixed;
    z-index: 50;
    bottom: calc(var(--safe-bottom, env(safe-area-inset-bottom)) + 18px);
    left: 14px;
    display: flex;
    width: 38px;
    height: 38px;
    align-items: center;
    justify-content: center;
    border: 1px solid var(--rail-border);
    border-radius: 50%;
    background: color-mix(in srgb, var(--rail-surface) 92%, transparent);
    color: var(--rail-txt-2);
    box-shadow: var(--rail-shadow-rest);
    cursor: pointer;
    transition: transform 0.28s ease-out, opacity 0.28s ease-out, color 0.2s ease-out;
    -webkit-tap-highlight-color: transparent;
  }
  .sidebar-reopen-right { left: auto; right: 14px; }
  .sidebar-reopen:hover { transform: translateY(-2px); color: var(--rail-txt); }
  .sidebar-reopen:active { transform: scale(0.96); }
  .sidebar-reopen:focus-visible { outline: 2px solid var(--rail-border-hi); outline-offset: 2px; }

  /* Sidebar.svelte emite as duas colunas antes da área principal no DOM.
     No desktop, empurra a coluna direita para depois do conteúdo; no mobile
     ela permanece fixa e esta regra não participa do layout. */
  @media (min-width: 768px) {
    .desktop-sidebar-right { order: 2; }
  }
</style>
