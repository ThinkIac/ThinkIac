<script>
    import { createEventDispatcher } from "svelte";
    import Apps from "./Apps.svelte";
    import Windows from "./Windows.svelte";
    import Sessions from "./Sessions.svelte";

    export let system = { provider: "—", model: "—", connections: [] };
    export let sessionId = "default";
    export let refreshTrigger = 0;
    export let isMobile = false;
    export let sidebarOpen = false;
    export let initialSection = "windows"; // "windows" | "apps"
    export let theme = "dark";

    // Para o painel Windows
    export let appTabs = [];
    export let chatTabs = [];
    export let activeTab = "";

    const dispatch = createEventDispatcher();

    let collapsed = false;
    let prevIsMobile = isMobile;

    $: activeDrawerSection = initialSection;
    $: {
        // Só reseta o collapsed quando a transição é mobile → desktop,
        // nunca em toda atualização reativa (era o bug anterior).
        if (prevIsMobile && !isMobile) collapsed = false;
        prevIsMobile = isMobile;
    }

    // Apps favoritados (vindos do Apps.svelte), usados na barra colapsada
    let pinnedApps = [];
    function handlePinnedChange(e) {
        pinnedApps = (e.detail || []).slice(0, 5);
    }

    function handleSelectSession(e) {
        dispatch("selectSession", e.detail);
    }
    function handleOpenApp(e) {
        dispatch("openApp", e.detail);
    }
    function handleDeleteSession(e) {
        dispatch("deleteSession", e.detail);
    }
    function handleClose() {
        dispatch("close");
    }
    function handleSelectApp(e) {
        dispatch("selectApp", e.detail);
    }
    function handleCloseApp(e) {
        dispatch("closeApp", e.detail);
    }
    function handleSelectChat(e) {
        dispatch("selectChat", e.detail);
    }
    function handleCloseChat(e) {
        dispatch("closeChat", e.detail);
    }
    function handleToggleTheme() {
        dispatch("toggleTheme");
    }
</script>

{#if isMobile}
    <!-- ══ MOBILE: Bottom sheet drawer ══ -->
    <aside
        class="fixed bottom-0 left-0 right-0 z-30 flex max-h-[calc(85dvh-env(safe-area-inset-bottom))] flex-col rounded-t-[18px] border-t border-[var(--border)] bg-[var(--bg-elevated)] transition-transform duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] will-change-transform {sidebarOpen ? 'translate-y-0' : 'translate-y-full'}"
        aria-hidden={!sidebarOpen}
        aria-label="Menu lateral"
    >
        <!-- Handle -->
        <div class="flex shrink-0 justify-center pt-2.5" aria-hidden="true">
            <div class="h-1 w-9 rounded-sm bg-[var(--border-strong)]"></div>
        </div>

        <!-- Header com tabs -->
        <div class="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4 pb-3 pt-2.5">
            <div class="flex flex-1 gap-1" role="tablist">
                <button
                    role="tab"
                    class="relative flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border px-3.5 py-1.5 font-sans text-[13px] font-medium transition-all duration-150 [-webkit-tap-highlight-color:transparent] {activeDrawerSection === 'windows' ? 'border-[var(--border-strong)] bg-[var(--w07)] text-[var(--txt)]' : 'border-transparent bg-transparent text-[var(--txt-3)]'}"
                    aria-selected={activeDrawerSection === "windows"}
                    on:click={() => (activeDrawerSection = "windows")}
                >
                    <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        width="14"
                        height="14"
                        aria-hidden="true"
                    >
                        <rect
                            x="2"
                            y="6"
                            width="16"
                            height="11"
                            rx="2"
                            stroke="currentColor"
                            stroke-width="1.4"
                        />
                        <path
                            d="M2 9h16"
                            stroke="currentColor"
                            stroke-width="1.2"
                            stroke-linecap="round"
                        />
                        <rect
                            x="4"
                            y="3"
                            width="5"
                            height="4"
                            rx="1"
                            fill="currentColor"
                            opacity="0.4"
                        />
                        <rect
                            x="10"
                            y="3"
                            width="5"
                            height="4"
                            rx="1"
                            stroke="currentColor"
                            stroke-width="1.2"
                            opacity="0.6"
                        />
                    </svg>
                    Dock
                    {#if appTabs.length > 0}
                        <span class="min-w-4 rounded px-1 py-px text-center font-mono text-[9px] {activeDrawerSection === 'windows' ? 'bg-[var(--w20)] text-[var(--txt)]' : 'bg-[var(--w12)] text-[var(--txt-2)]'}">
                            {appTabs.length}
                        </span>
                    {/if}
                </button>
                <button
                    role="tab"
                    class="relative flex min-h-9 cursor-pointer items-center gap-1.5 rounded-[9px] border px-3.5 py-1.5 font-sans text-[13px] font-medium transition-all duration-150 [-webkit-tap-highlight-color:transparent] {activeDrawerSection === 'apps' ? 'border-[var(--border-strong)] bg-[var(--w07)] text-[var(--txt)]' : 'border-transparent bg-transparent text-[var(--txt-3)]'}"
                    aria-selected={activeDrawerSection === "apps"}
                    on:click={() => (activeDrawerSection = "apps")}
                >
                    <svg
                        viewBox="0 0 20 20"
                        fill="none"
                        width="14"
                        height="14"
                        aria-hidden="true"
                    >
                        <rect
                            x="2"
                            y="2"
                            width="7"
                            height="7"
                            rx="1.5"
                            stroke="currentColor"
                            stroke-width="1.4"
                        />
                        <rect
                            x="11"
                            y="2"
                            width="7"
                            height="7"
                            rx="1.5"
                            stroke="currentColor"
                            stroke-width="1.4"
                        />
                        <rect
                            x="2"
                            y="11"
                            width="7"
                            height="7"
                            rx="1.5"
                            stroke="currentColor"
                            stroke-width="1.4"
                        />
                        <rect
                            x="11"
                            y="11"
                            width="7"
                            height="7"
                            rx="1.5"
                            stroke="currentColor"
                            stroke-width="1.4"
                        />
                    </svg>
                    Apps
                </button>
            </div>
            <button
                class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-transparent text-[var(--txt-3)] transition-[color,border-color] duration-150 [-webkit-tap-highlight-color:transparent] active:border-[var(--border-strong)] active:text-[var(--txt)]"
                on:click={handleToggleTheme}
                title={theme === "dark" ? "Tema claro" : "Tema escuro"}
                aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
            >
                <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                    {#if theme === "dark"}
                        <circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/>
                        <path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                    {:else}
                        <path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                    {/if}
                </svg>
            </button>
            <button
                class="flex h-8 w-8 shrink-0 cursor-pointer items-center justify-center rounded-lg border border-[var(--border)] bg-transparent text-[var(--txt-3)] transition-[color,border-color] duration-150 [-webkit-tap-highlight-color:transparent] active:border-[var(--border-strong)] active:text-[var(--txt)]"
                on:click={handleClose}
                aria-label="Fechar"
            >
                <svg
                    viewBox="0 0 16 16"
                    fill="none"
                    stroke="currentColor"
                    stroke-width="1.6"
                    stroke-linecap="round"
                    width="14"
                    height="14"
                >
                    <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
            </button>
        </div>

        <!-- Body -->
        <div class="flex flex-1 flex-col overflow-y-auto px-4 py-3.5 overscroll-contain [-webkit-overflow-scrolling:touch] [&::-webkit-scrollbar]:hidden">
            {#if activeDrawerSection === "windows"}
                <div>
                    <Windows
                        {appTabs}
                        {chatTabs}
                        {activeTab}
                        on:selectApp={(e) => {
                            handleSelectApp(e);
                            handleClose();
                        }}
                        on:closeApp={handleCloseApp}
                        on:selectChat={(e) => {
                            handleSelectChat(e);
                            handleClose();
                        }}
                        on:closeChat={handleCloseChat}
                    />

                    <Sessions
                        {refreshTrigger}
                        currentSessionId={sessionId}
                        on:selectSession={handleSelectSession}
                        on:deleteSession={handleDeleteSession}
                    />
                </div>
            {:else}
                <Apps
                    on:open={(e) => {
                        handleOpenApp(e);
                        handleClose();
                    }}
                    on:pinnedChange={handlePinnedChange}
                />
            {/if}
        </div>

        <!-- Footer com nova missão -->
        <div class="shrink-0 border-t border-[var(--border)] px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]">
            <button
                class="flex min-h-11 w-full cursor-pointer items-center justify-center gap-2 rounded-[10px] border border-[var(--border)] bg-[var(--w04)] px-3.5 py-2.5 font-sans text-[13px] font-medium text-[var(--txt-2)] transition-[background,color] duration-150 [-webkit-tap-highlight-color:transparent] active:bg-[var(--w08)] active:text-[var(--txt)]"
                on:click={() => {
                    dispatch("clear");
                    handleClose();
                }}
            >
                <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                    <path
                        d="M8 3v10M3 8h10"
                        stroke="currentColor"
                        stroke-width="1.6"
                        stroke-linecap="round"
                    />
                </svg>
                New Topic
            </button>
        </div>
    </aside>
{:else}
    <!-- ══ DESKTOP: Sidebar colapsável ══ -->
    <aside
        class="relative z-2 flex h-screen flex-col border-r border-[var(--border)] bg-[var(--bg-elevated)] transition-[width,min-width] duration-200 ease-[cubic-bezier(0.4,0,0.2,1)] {collapsed ? 'w-12 min-w-12' : 'w-60 min-w-60'}"
    >
        <!-- Brand -->
        <div
            class="flex min-h-[60px] items-center gap-2.5 border-b border-[var(--border)] pb-3.5 pt-[18px] {collapsed ? 'justify-center px-0' : 'px-4'}"
        >
            {#if !collapsed}
                <div class="flex-1 font-sans text-[13px] font-medium uppercase tracking-[0.14em] text-[var(--txt)]">ThinkIac</div>
                <button
                    class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-transparent text-[var(--txt-2)] transition-[background,color,border-color] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--w06)] hover:text-[var(--txt)]"
                    on:click={handleToggleTheme}
                    title={theme === "dark" ? "Tema claro" : "Tema escuro"}
                    aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
                >
                    <svg viewBox="0 0 16 16" fill="none" width="13" height="13">
                        {#if theme === "dark"}
                            <circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/>
                            <path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                        {:else}
                            <path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                        {/if}
                    </svg>
                </button>
            {/if}
            <button
                class="flex h-6 w-6 shrink-0 cursor-pointer items-center justify-center rounded-md border border-[var(--border)] bg-transparent text-[var(--txt-2)] transition-[background,color,border-color] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--w06)] hover:text-[var(--txt)] {collapsed ? 'ml-0' : 'ml-auto'}"
                on:click={() => (collapsed = !collapsed)}
                title={collapsed ? "Expandir" : "Recolher"}
            >
                <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                    {#if collapsed}
                        <path
                            d="M6 3l5 5-5 5"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    {:else}
                        <path
                            d="M10 3L5 8l5 5"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                            stroke-linejoin="round"
                        />
                    {/if}
                </svg>
            </button>
        </div>

        <!-- Conteúdo expandido (montado sempre, oculto via CSS quando colapsado
             para o Apps.svelte manter o polling e o estado de pin vivos) -->
        <div class="flex flex-1 flex-col gap-4 overflow-y-auto px-3 py-3.5 [&::-webkit-scrollbar]:w-0.5 [&::-webkit-scrollbar-track]:bg-transparent [&::-webkit-scrollbar-thumb]:rounded-sm [&::-webkit-scrollbar-thumb]:bg-[var(--w08)] {collapsed ? 'hidden' : ''}">
            <Apps on:open={handleOpenApp} on:pinnedChange={handlePinnedChange} />

            {#if appTabs.length > 0 || chatTabs.length > 1}
                <Windows
                    {appTabs}
                    {chatTabs}
                    {activeTab}
                    on:selectApp={handleSelectApp}
                    on:closeApp={handleCloseApp}
                    on:selectChat={handleSelectChat}
                    on:closeChat={handleCloseChat}
                />
            {/if}

            <Sessions
                {refreshTrigger}
                currentSessionId={sessionId}
                on:selectSession={handleSelectSession}
                on:deleteSession={handleDeleteSession}
            />
        </div>

        {#if !collapsed}
            <div class="flex flex-col gap-2 border-t border-[var(--border)] px-3 pb-4 pt-3">
                <div>
                    <span class="mb-1 block font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-[var(--txt-3)]">Session</span>
                    <div class="group flex items-center gap-1.5 overflow-hidden rounded-md border border-[var(--border)] bg-[var(--w03)] px-2 py-1.5">
                        <span class="flex-1 overflow-hidden truncate font-mono text-[10px] text-[var(--txt-2)]">{sessionId}</span>
                        <span class="shrink-0 cursor-default text-[9px] text-[var(--txt-3)] transition-opacity group-hover:text-[var(--txt-2)]" title="Copiar ID">⌘</span>
                    </div>
                </div>
                <button
                    class="flex w-full cursor-pointer items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] bg-transparent px-3 py-2 font-sans text-xs font-medium text-[var(--txt-2)] transition-[background,color,border-color] duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--w06)] hover:text-[var(--txt)]"
                    on:click={() => dispatch("clear")}
                >
                    <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path
                            d="M8 3v10M3 8h10"
                            stroke="currentColor"
                            stroke-width="1.6"
                            stroke-linecap="round"
                        />
                    </svg>
                    New Topic
                </button>
            </div>
        {:else}
            <!-- ══ Barra colapsada: favoritos no topo, nova conversa + histórico no rodapé ══ -->
            <div class="flex flex-1 flex-col items-center justify-between gap-1.5 border-t border-[var(--border)] px-1.5 py-3">

                <div class="flex flex-col items-center gap-1.5 overflow-y-auto [&::-webkit-scrollbar]:hidden">
                    {#each pinnedApps as app (app.id)}
                        <button
                            class="group relative flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--w03)] text-[var(--txt-2)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--w06)] hover:text-[var(--txt)]"
                            on:click={() => handleOpenApp({ detail: app })}
                            title={app.name}
                        >
                            {#if app.icon}
                                <img src={app.icon} alt={app.name} class="h-full w-full rounded-[var(--radius-md)] object-cover" draggable="false" />
                            {:else}
                                <span class="text-[13px] font-semibold">{app.name[0].toUpperCase()}</span>
                            {/if}
                        </button>
                    {/each}
                </div>

                <div class="flex flex-col items-center gap-1.5">
                    {#if pinnedApps.length > 0}
                        <div class="mb-1 h-px w-6 bg-[var(--border)]"></div>
                    {/if}

                    <button
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-[var(--border)] bg-transparent text-[var(--txt-2)] transition-colors duration-150 hover:border-[var(--border-strong)] hover:bg-[var(--w06)] hover:text-[var(--txt)]"
                        on:click={() => dispatch("clear")}
                        title="New Topic"
                        aria-label="New Topic"
                    >
                        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                            <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
                        </svg>
                    </button>

                    <button
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-transparent bg-transparent text-[var(--txt-3)] transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--w04)] hover:text-[var(--txt-2)]"
                        on:click={() => (collapsed = false)}
                        title="Histórico"
                        aria-label="Ver histórico de sessões"
                    >
                        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                            <path d="M8 4v4l2.5 2.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
                            <circle cx="8" cy="8" r="6" stroke="currentColor" stroke-width="1.4"/>
                        </svg>
                    </button>

                    <button
                        class="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)] border border-transparent bg-transparent text-[var(--txt-3)] transition-colors duration-150 hover:border-[var(--border)] hover:bg-[var(--w04)] hover:text-[var(--txt-2)]"
                        on:click={handleToggleTheme}
                        title={theme === "dark" ? "Tema claro" : "Tema escuro"}
                        aria-label={theme === "dark" ? "Ativar tema claro" : "Ativar tema escuro"}
                    >
                        <svg viewBox="0 0 16 16" fill="none" width="14" height="14">
                            {#if theme === "dark"}
                                <circle cx="8" cy="8" r="3.4" stroke="currentColor" stroke-width="1.4"/>
                                <path d="M8 1.3v1.6M8 13.1v1.6M2.6 8H1M15 8h-1.6M4 4l1.1 1.1M11 11l1.1 1.1M12 4l-1.1 1.1M5 11l-1.1 1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
                            {:else}
                                <path d="M13.5 9.7A5.5 5.5 0 016.3 2.5 5.5 5.5 0 1013.5 9.7z" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round"/>
                            {/if}
                        </svg>
                    </button>
                </div>
            </div>
        {/if}
    </aside>
{/if}