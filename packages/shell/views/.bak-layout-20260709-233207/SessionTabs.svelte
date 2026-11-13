<script>
    import { createEventDispatcher, tick } from "svelte";

    export let tabs = [];
    export let activeTab = "";
    export let loadingMap = {};
    export let appTabs = [];
    export let isMobile = false;

    const dispatch = createEventDispatcher();

    const TAB_ICONS = {
        chat: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
        terminal: '<polyline points="4 17 10 11 4 5"/><line x1="12" y1="19" x2="20" y2="19"/>',
        database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v6a9 3 0 0 0 18 0V5"/><path d="M3 11v6a9 3 0 0 0 18 0v-6"/>',
        bot: '<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/><path d="M12 3a2 2 0 0 1 2 2v6H10V5a2 2 0 0 1 2-2z"/>',
        folder: '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>',
        globe: '<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12 15.3 15.3 0 0 1 12 2z"/>',
    };

    function tabIconSvg(name) {
        const paths = TAB_ICONS[name] || TAB_ICONS['globe'];
        return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="11" height="11">${paths}</svg>`;
    }

    function isAppTab(sessionId) {
        return appTabs.some(t => t.id === sessionId);
    }

    function selectTab(tab) { dispatch("selectTab", tab.sessionId); }
    function handleNewTab() { dispatch("newTab"); }
    function handlePin(sessionId) { dispatch("togglePin", sessionId); }
    function handleClose(sessionId) { dispatch("closeTab", sessionId); }
    function handleOpenMenu() { dispatch("openMenu"); }

    let editingId = null;
    let editValue = "";
    let editInput;

    async function startRename(tab) {
        if (isMobile) return; // mobile renomeia via long-press menu
        editingId = tab.sessionId;
        editValue = tab.name;
        await tick();
        editInput?.focus();
        editInput?.select();
    }

    function commitRename() {
        const trimmed = editValue.trim();
        if (trimmed && editingId) {
            dispatch("renameTab", { sessionId: editingId, name: trimmed });
        }
        editingId = null;
    }

    function cancelRename() { editingId = null; }

    function isStreaming(sessionId) { return !!loadingMap[sessionId]; }

    // Mobile: menu de contexto por tab
    let mobileMenuOpen = null; // sessionId do menu aberto
    let mobileMenuTab = null;
    let mobileEditingId = null;
    let mobileEditValue = "";
    let mobileEditInput;

    function openMobileMenu(e, tab) {
        e.stopPropagation();
        if (isAppTab(tab.sessionId)) return;
        mobileMenuOpen = tab.sessionId;
        mobileMenuTab = tab;
    }

    function closeMobileMenu() {
        mobileMenuOpen = null;
        mobileMenuTab = null;
    }

    async function startMobileRename() {
        mobileEditingId = mobileMenuOpen;
        mobileEditValue = mobileMenuTab?.name ?? "";
        closeMobileMenu();
        await tick();
        mobileEditInput?.focus();
        mobileEditInput?.select();
    }

    function commitMobileRename() {
        const trimmed = mobileEditValue.trim();
        if (trimmed && mobileEditingId) {
            dispatch("renameTab", { sessionId: mobileEditingId, name: trimmed });
        }
        mobileEditingId = null;
    }

    function cancelMobileRename() { mobileEditingId = null; }

    function mobilePin() {
        if (mobileMenuTab) handlePin(mobileMenuTab.sessionId);
        closeMobileMenu();
    }

    function mobileClose() {
        if (mobileMenuTab) handleClose(mobileMenuTab.sessionId);
        closeMobileMenu();
    }

    $: chatTabs = tabs.filter(t => t.type !== 'app' && !isAppTab(t.sessionId));
    $: pinnedTabs = chatTabs.filter(t => t.pinned);
    $: unpinnedTabs = chatTabs.filter(t => !t.pinned);
    $: orderedTabs = [...pinnedTabs, ...unpinnedTabs];
</script>

{#if isMobile}
    <!-- ══ MOBILE: scrollable pill tabs ══ -->
    <div class="mobile-tab-bar">
        <button
            class="mobile-menu-btn"
            on:click={handleOpenMenu}
            aria-label="Abrir menu"
        >
            <svg viewBox="0 0 16 16" fill="none" width="15" height="15">
                <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            </svg>
        </button>
        <div class="mobile-tab-scroll">
            {#each orderedTabs as tab (tab.sessionId)}
                {@const active = tab.sessionId === activeTab}
                {@const streaming = isStreaming(tab.sessionId)}
                {@const editing = mobileEditingId === tab.sessionId}
                {@const menuOpen = mobileMenuOpen === tab.sessionId}

                <div
                    class="mobile-tab"
                    class:active
                    class:pinned={tab.pinned}
                    on:click={() => selectTab(tab)}
                    on:contextmenu|preventDefault={(e) => openMobileMenu(e, tab)}
                >
                    {#if tab.pinned}
                        <span class="mobile-pin-dot"></span>
                    {/if}

                    {#if editing}
                        <input
                            bind:this={mobileEditInput}
                            class="mobile-edit-input"
                            bind:value={mobileEditValue}
                            on:keydown={(e) => {
                                if (e.key === 'Enter') commitMobileRename();
                                if (e.key === 'Escape') cancelMobileRename();
                            }}
                            on:blur={commitMobileRename}
                            on:click|stopPropagation
                        />
                    {:else}
                        <span class="mobile-tab-name">{tab.name}</span>
                        {#if streaming}
                            <span class="mobile-stream-dot"></span>
                        {/if}
                    {/if}

                    <button
                        class="mobile-tab-close"
                        on:click|stopPropagation={() => handleClose(tab.sessionId)}
                        aria-label="Fechar"
                    >
                        <svg viewBox="0 0 10 10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="8" height="8">
                            <line x1="2" y1="2" x2="8" y2="8"/><line x1="8" y1="2" x2="2" y2="8"/>
                        </svg>
                    </button>

                    <!-- Context menu -->
                    {#if menuOpen}
                        <div class="mobile-ctx-menu" on:click|stopPropagation>
                            <button class="ctx-item" on:click={startMobileRename}>
                                <svg viewBox="0 0 16 16" fill="none" width="12" height="12"><path d="M11 2l3 3-9 9H2v-3L11 2z" stroke="currentColor" stroke-width="1.3" stroke-linejoin="round"/></svg>
                                Renomear
                            </button>
                            <button class="ctx-item" on:click={mobilePin}>
                                {#if tab.pinned}
                                    <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M9 2L6 5.5 4 6l.5 2L2 12l4-2.5 2 .5L5 7l2-2.5L9 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    Desafixar
                                {:else}
                                    <svg viewBox="0 0 14 14" fill="none" width="12" height="12"><path d="M9 2L6 5.5 4 6l.5 2L2 12l4-2.5 2 .5L5 7l2-2.5L9 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
                                    Fixar
                                {/if}
                            </button>
                            <button class="ctx-item danger" on:click={mobileClose}>
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="10" height="10"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                                Fechar
                            </button>
                        </div>
                        <!-- click-away -->
                        <div class="ctx-overlay" on:click|stopPropagation={closeMobileMenu}></div>
                    {/if}
                </div>
            {/each}

            <button class="mobile-new-btn" on:click={handleNewTab} aria-label="Nova aba">
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                    <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
    </div>

{:else}
    <!-- ══ DESKTOP: tab bar original ══ -->
    <div class="tab-bar">
        {#each tabs.filter(t => t.pinned) as tab (tab.sessionId)}
            {@const active = tab.sessionId === activeTab}
            {@const editing = editingId === tab.sessionId}
            {@const isApp = tab.type === 'app' || isAppTab(tab.sessionId)}
            <div
                class="tab-item pinned"
                class:active
                class:app-tab={isApp}
                on:click={() => selectTab(tab)}
                on:dblclick|preventDefault={() => !isApp && startRename(tab)}
            >
                {#if editing}
                    <span class="pin">📌</span>
                    <input
                        bind:this={editInput}
                        class="tab-name-input"
                        bind:value={editValue}
                        on:keydown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') cancelRename();
                        }}
                        on:blur={commitRename}
                    />
                {:else}
                    {#if isApp}
                        <span class="tab-icon">{@html tabIconSvg(tab.icon || 'globe')}</span>
                    {:else}
                        <span class="pin">📌</span>
                    {/if}
                    <span class="tab-name">{tab.name}</span>
                    {#if !isApp && isStreaming(tab.sessionId)}
                        <span class="stream-dot"></span>
                    {/if}
                {/if}

                {#if !isApp}
                    <button class="tab-mini-btn" on:click|stopPropagation={() => handlePin(tab.sessionId)} title={tab.pinned ? "Desafixar" : "Fixar"}>
                        <svg viewBox="0 0 14 14" fill="none" width="10" height="10">
                            <path d="M9 2L6 5.5 4 6l.5 2L2 12l4-2.5 2 .5L5 7l2-2.5L9 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                {/if}
                <button class="tab-close-btn" on:click|stopPropagation={() => handleClose(tab.sessionId)} title="Fechar">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="9" height="9">
                        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                    </svg>
                </button>
            </div>
        {/each}

        {#each tabs.filter(t => !t.pinned) as tab (tab.sessionId)}
            {@const active = tab.sessionId === activeTab}
            {@const editing = editingId === tab.sessionId}
            {@const isApp = tab.type === 'app' || isAppTab(tab.sessionId)}
            <div
                class="tab-item"
                class:active
                class:app-tab={isApp}
                on:click={() => selectTab(tab)}
                on:dblclick|preventDefault={() => !isApp && startRename(tab)}
            >
                {#if editing}
                    <input
                        bind:this={editInput}
                        class="tab-name-input"
                        bind:value={editValue}
                        on:keydown={(e) => {
                            if (e.key === 'Enter') commitRename();
                            if (e.key === 'Escape') cancelRename();
                        }}
                        on:blur={commitRename}
                    />
                {:else}
                    {#if isApp}
                        <span class="tab-icon">{@html tabIconSvg(tab.icon || 'globe')}</span>
                    {/if}
                    <span class="tab-name">{tab.name}</span>
                    {#if !isApp && isStreaming(tab.sessionId)}
                        <span class="stream-dot"></span>
                    {/if}
                {/if}

                {#if !isApp}
                    <button class="tab-mini-btn" on:click|stopPropagation={() => handlePin(tab.sessionId)} title="Fixar aba">
                        <svg viewBox="0 0 14 14" fill="none" width="10" height="10">
                            <path d="M9 2L6 5.5 4 6l.5 2L2 12l4-2.5 2 .5L5 7l2-2.5L9 2z" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    </button>
                {/if}
                <button class="tab-close-btn" on:click|stopPropagation={() => handleClose(tab.sessionId)} title="Fechar">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="9" height="9">
                        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                    </svg>
                </button>
            </div>
        {/each}

        <button class="tab-new-btn" on:click={handleNewTab} title="Nova aba">
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
                <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
        </button>
    </div>
{/if}

<style>
/* ══ MOBILE ══ */
.mobile-tab-bar {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    height: 38px;
    position: relative;
    z-index: 5;
}
.mobile-menu-btn {
    flex-shrink: 0;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 34px;
    height: 100%;
    border: none;
    border-right: 1px solid var(--border);
    background: transparent;
    color: var(--txt-2);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
}
.mobile-menu-btn:active {
    background: var(--w05);
    color: var(--txt);
}
.mobile-tab-scroll {
    display: flex;
    align-items: center;
    height: 100%;
    flex: 1;
    min-width: 0;
    overflow-x: auto;
    overflow-y: hidden;
    scrollbar-width: none;
    gap: 3px;
    padding: 0 8px;
}
.mobile-tab-scroll::-webkit-scrollbar { display: none; }

.mobile-tab {
    position: relative;
    display: flex;
    align-items: center;
    gap: 5px;
    padding: 0 7px 0 9px;
    height: 26px;
    border-radius: 6px;
    background: var(--w03);
    border: 1px solid transparent;
    color: var(--txt-3);
    font-family: var(--font-body);
    font-size: 11px;
    font-weight: 400;
    cursor: pointer;
    white-space: nowrap;
    flex-shrink: 0;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
    -webkit-tap-highlight-color: transparent;
    max-width: 130px;
    user-select: none;
}
.mobile-tab.active {
    background: var(--w08);
    border-color: var(--w14);
    color: var(--txt);
}
.mobile-tab.pinned {
    border-color: var(--w10);
}

.mobile-pin-dot {
    width: 4px; height: 4px;
    border-radius: 50%;
    background: var(--txt-2);
    opacity: 0.5;
    flex-shrink: 0;
}

.mobile-tab-name {
    flex: 1;
    overflow: hidden;
    text-overflow: ellipsis;
    min-width: 0;
}

.mobile-stream-dot {
    width: 4px; height: 4px; border-radius: 50%;
    background: var(--txt);
    flex-shrink: 0;
    animation: stream-pulse 1s ease-in-out infinite;
}

.mobile-tab-close {
    display: flex; align-items: center; justify-content: center;
    width: 14px; height: 14px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: var(--txt-3);
    cursor: pointer;
    flex-shrink: 0;
    padding: 0;
    opacity: 0.5;
    transition: opacity 0.1s, background 0.1s;
    -webkit-tap-highlight-color: transparent;
}
.mobile-tab.active .mobile-tab-close { opacity: 0.8; }
.mobile-tab-close:active {
    opacity: 1;
    background: var(--w10);
}

.mobile-edit-input {
    flex: 1; min-width: 50px; padding: 0 4px;
    background: var(--w07);
    border: 1px solid var(--w20);
    border-radius: 3px;
    color: var(--txt); font-size: 11px;
    font-family: var(--font-body); outline: none;
    height: 18px;
}

/* Context menu */
.ctx-overlay {
    position: fixed;
    inset: 0;
    z-index: 98;
}
.mobile-ctx-menu {
    position: absolute;
    top: calc(100% + 4px);
    left: 0;
    z-index: 99;
    background: #1a1a1a;
    border: 1px solid var(--w12);
    border-radius: 8px;
    padding: 4px;
    min-width: 130px;
    box-shadow: 0 8px 24px rgba(0,0,0,0.6);
    animation: ctx-pop 0.12s ease;
}
@keyframes ctx-pop {
    from { opacity: 0; transform: translateY(-4px) scale(0.96); }
    to   { opacity: 1; transform: translateY(0) scale(1); }
}
.ctx-item {
    display: flex;
    align-items: center;
    gap: 8px;
    width: 100%;
    padding: 8px 10px;
    border: none;
    background: transparent;
    color: var(--txt-2);
    font-family: var(--font-body);
    font-size: 12px;
    border-radius: 5px;
    cursor: pointer;
    text-align: left;
    transition: background 0.1s, color 0.1s;
    -webkit-tap-highlight-color: transparent;
}
.ctx-item:active { background: var(--w07); color: var(--txt); }
.ctx-item.danger { color: rgba(255,90,90,0.8); }
.ctx-item.danger:active { background: rgba(255,70,70,0.08); color: rgba(255,90,90,1); }

.mobile-new-btn {
    display: flex; align-items: center; justify-content: center;
    min-width: 28px; height: 24px;
    border-radius: 6px;
    border: 1px dashed var(--w10);
    background: transparent;
    color: var(--txt-3);
    cursor: pointer;
    flex-shrink: 0;
    transition: all 0.15s;
    -webkit-tap-highlight-color: transparent;
}
.mobile-new-btn:active {
    background: var(--w04);
    color: var(--txt);
    border-color: var(--w22);
}

/* ══ DESKTOP ══ */
.tab-bar {
    display: flex; align-items: stretch;
    height: 40px;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none; gap: 1px; padding: 0 4px;
}
.tab-bar::-webkit-scrollbar { display: none; }

.tab-item {
    display: flex; align-items: center; gap: 4px;
    padding: 0 8px 0 10px;
    min-width: 76px; max-width: 160px;
    background: transparent; border: none;
    border-bottom: 1.5px solid transparent;
    color: var(--txt-3);
    font-family: var(--font-body); font-size: 11.5px; font-weight: 400;
    cursor: pointer; letter-spacing: 0.01em;
    transition: color 0.12s, background 0.12s, border-color 0.12s;
    white-space: nowrap; flex-shrink: 0;
}
.tab-item:hover { color: var(--txt-2); background: var(--w02); }
.tab-item.active { color: var(--txt); border-bottom-color: var(--txt); background: var(--w03); }
.tab-item.pinned { border-left: 1.5px solid var(--w12); }
.tab-item.app-tab { border-left: 1.5px solid var(--w20); }
.tab-item.app-tab.active { color: var(--txt); border-bottom-color: var(--w80); background: var(--w04); }

.tab-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; color: var(--txt-2); opacity: 0.7; }
.tab-item.active .tab-icon { opacity: 1; }
.pin { font-size: 9px; flex-shrink: 0; opacity: 0.5; }
.tab-name { flex: 1; overflow: hidden; text-overflow: ellipsis; text-align: left; }
.tab-name-input {
    flex: 1; min-width: 50px; padding: 1px 5px;
    background: var(--w07);
    border: 1px solid var(--w20);
    border-radius: 4px;
    color: var(--txt); font-size: 11px;
    font-family: var(--font-body); outline: none;
}
.stream-dot {
    width: 5px; height: 5px; border-radius: 50%;
    background: var(--txt); flex-shrink: 0;
    animation: stream-pulse 1s ease-in-out infinite;
}
@keyframes stream-pulse {
    0%, 100% { opacity: 0.2; transform: scale(0.7); }
    50%       { opacity: 1;   transform: scale(1.1); }
}
.tab-mini-btn {
    display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 3px;
    border: none; background: transparent;
    color: var(--txt-3); cursor: pointer; flex-shrink: 0; padding: 0;
    opacity: 0; transition: background 0.1s, color 0.1s, opacity 0.1s;
}
.tab-item:hover .tab-mini-btn,
.tab-item.active .tab-mini-btn { opacity: 0.5; }
.tab-mini-btn:hover { opacity: 1 !important; background: var(--w07); color: var(--txt); }
.tab-close-btn {
    display: flex; align-items: center; justify-content: center;
    width: 16px; height: 16px; border-radius: 3px;
    border: none; background: transparent;
    color: var(--txt-3); cursor: pointer; flex-shrink: 0; padding: 0;
    opacity: 0; transition: background 0.1s, color 0.1s, opacity 0.1s;
}
.tab-item:hover .tab-close-btn,
.tab-item.active .tab-close-btn { opacity: 1; }
.tab-close-btn:hover { background: var(--w07); color: var(--txt); }
.tab-new-btn {
    display: flex; align-items: center; justify-content: center;
    min-width: 28px; height: 24px; margin: auto 3px;
    border-radius: 6px;
    border: 1px dashed var(--w12);
    background: transparent;
    color: var(--txt-3); cursor: pointer; transition: all 0.15s;
}
.tab-new-btn:hover { background: var(--w04); color: var(--txt); border-color: var(--w25); }
</style>