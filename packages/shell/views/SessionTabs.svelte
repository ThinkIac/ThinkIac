<script>
    import { createEventDispatcher, onMount, tick } from "svelte";
    import SlateIcon from "./components/SlateIcon.svelte";

    export let tabs = [];
    export let activeTab = "";
    export let loadingMap = {};
    export let appTabs = [];
    export let isMobile = false;
    export let theme = "dark";
    export let hostedByDesktop = false;
    export let headerActions = [];

    const dispatch = createEventDispatcher();

    function isAppTab(sessionId) {
        return appTabs.some(t => t.id === sessionId);
    }

    function selectTab(tab) { dispatch("selectTab", tab.sessionId); }
    function handleNewTab() { dispatch("newTab"); }
    function handleClose(sessionId) { dispatch("closeTab", sessionId); }
    function handleOpenMenu() { dispatch("openMenu"); }
    function openSeparate(tab) { dispatch("openSeparate", tab); }
    let headerMenuOpen = false;
    function runHeaderAction(action) { headerMenuOpen = false; dispatch("headerAction", action); }

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

    function mobileClose() {
        if (mobileMenuTab) handleClose(mobileMenuTab.sessionId);
        closeMobileMenu();
    }

    $: chatTabs = tabs.filter(t => t.type !== 'app' && !isAppTab(t.sessionId));
    $: orderedTabs = chatTabs;
    const TAB_BAR_MIN_HEIGHT = 32;
    const TAB_BAR_DEFAULT_HEIGHT = 40;
    const TAB_BAR_MAX_HEIGHT = 56;
    const TAB_BAR_HEIGHT_KEY = "shell:tab-bar-height";
    const HOVER_OPEN_DELAY = 140;
    const HOVER_CLOSE_DELAY = 140;
    let tabBarHeight = TAB_BAR_DEFAULT_HEIGHT;
    let collapsed = false;
    let hoverPreview = false;
    let hoverOpenTimer = null;
    let hoverCloseTimer = null;
    let stopResize = null;
    let draggingId = null;
    let overId = null;

    onMount(() => {
        try {
            const storedHeight = Number(localStorage.getItem(TAB_BAR_HEIGHT_KEY));
            if (Number.isFinite(storedHeight) && storedHeight > 0) {
                tabBarHeight = Math.min(TAB_BAR_MAX_HEIGHT, Math.max(TAB_BAR_MIN_HEIGHT, storedHeight));
            }
        } catch (_) {}
        return () => {
            clearHoverTimers();
            stopResize?.();
        };
    });

    function clearHoverTimers() {
        if (hoverOpenTimer !== null) clearTimeout(hoverOpenTimer);
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverOpenTimer = null;
        hoverCloseTimer = null;
    }
    function collapseTabBar() {
        clearHoverTimers();
        hoverPreview = false;
        collapsed = true;
    }
    function openTabBar() {
        clearHoverTimers();
        hoverPreview = false;
        collapsed = false;
    }
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
    function handlePreviewEnter() {
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = null;
    }
    function handlePreviewLeave() {
        cancelHoverPreviewOpen();
        if (!collapsed || !hoverPreview) return;
        if (hoverCloseTimer !== null) clearTimeout(hoverCloseTimer);
        hoverCloseTimer = setTimeout(() => {
            hoverCloseTimer = null;
            if (collapsed) hoverPreview = false;
        }, HOVER_CLOSE_DELAY);
    }
    function startResize(event) {
        event.preventDefault();
        const handle = event.currentTarget;
        const pointerId = event.pointerId;
        const startY = event.clientY;
        const startHeight = tabBarHeight;
        const move = (moveEvent) => {
            if (moveEvent.pointerId !== pointerId) return;
            tabBarHeight = Math.min(TAB_BAR_MAX_HEIGHT, Math.max(TAB_BAR_MIN_HEIGHT, startHeight + moveEvent.clientY - startY));
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
            try { localStorage.setItem(TAB_BAR_HEIGHT_KEY, String(Math.round(tabBarHeight))); } catch (_) {}
            stopResize = null;
        };
        stopResize?.();
        stopResize = end;
        document.body.style.cursor = "row-resize";
        document.body.style.userSelect = "none";
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
        window.addEventListener("blur", end);
        handle.addEventListener("lostpointercapture", end);
        handle.setPointerCapture?.(pointerId);
    }

    function dragStart(event, tab) {
        draggingId = tab.sessionId;
        event.dataTransfer.effectAllowed = "move";
        event.dataTransfer.setData("text/plain", tab.sessionId);
    }
    function dragEnd() {
        draggingId = null;
        overId = null;
    }
    function dragOver(event, tab) {
        if (!draggingId || draggingId === tab.sessionId) return;
        event.preventDefault();
        overId = tab.sessionId;
    }
    function dropOn(event, tab) {
        event.preventDefault();
        const sourceId = draggingId || event.dataTransfer.getData("text/plain");
        const targetId = tab.sessionId;
        const bounds = event.currentTarget.getBoundingClientRect();
        const offset = event.clientX - bounds.left;
        // Agrupamento fica deliberadamente adiado. Todo drop, inclusive no
        // centro, apenas reorganiza a ordem única de chats e aplicativos.
        if (sourceId && targetId) dispatch("moveTab", { sourceId, targetId, after: offset > bounds.width / 2 });
        draggingId = null;
        overId = null;
    }
    function dropBetween(event, targetId, after) {
        event.preventDefault();
        const sourceId = draggingId || event.dataTransfer.getData("text/plain");
        if (sourceId && targetId) dispatch("moveTab", { sourceId, targetId, after });
        draggingId = null;
        overId = null;
    }
</script>

{#if isMobile}
    <!-- ══ MOBILE: scrollable pill tabs ══ -->
    <div class="mobile-tab-bar">
        <button
            class="mobile-menu-btn"
            on:click={handleOpenMenu}
            aria-label="Open menu"
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
                    on:click={() => selectTab(tab)}
                    on:contextmenu|preventDefault={(e) => openMobileMenu(e, tab)}
                >
                    <span class="mobile-tab-icon">
                        {#if isAppTab(tab.sessionId) || tab.type === 'app'}
                            <SlateIcon app={tab} {theme} size={13} radius={4} />
                        {:else}
                            <SlateIcon sigma size={13} radius={4} />
                        {/if}
                    </span>

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
                        aria-label="Close"
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
                                Rename
                            </button>
                            <button class="ctx-item danger" on:click={mobileClose}>
                                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="10" height="10"><line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/></svg>
                                Close
                            </button>
                        </div>
                        <!-- click-away -->
                        <div class="ctx-overlay" on:click|stopPropagation={closeMobileMenu}></div>
                    {/if}
                </div>
            {/each}

            <button class="mobile-new-btn" on:click={handleNewTab} aria-label="New tab">
                <svg viewBox="0 0 14 14" fill="none" width="12" height="12">
                    <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>
                </svg>
            </button>
        </div>
    </div>

{:else}
    <!-- ══ DESKTOP: order is shared by chat and apps ══ -->
    <div
        class="tab-bar-slot"
        class:collapsed
        class:hover-preview={collapsed && hoverPreview}
        style="height: {collapsed && !hoverPreview ? 0 : tabBarHeight}px"
        on:mouseenter={handlePreviewEnter}
        on:mouseleave={handlePreviewLeave}
    >
    {#if collapsed}<div class="tab-edge-trigger" on:mouseenter={showHoverPreview} on:mouseleave={cancelHoverPreviewOpen} aria-hidden="true"></div>{/if}
    <div class="tab-bar" class:hidden={collapsed && !hoverPreview} style="height: {tabBarHeight}px" on:dragover|preventDefault>
        {#each tabs as tab, index (tab.sessionId)}
            {@const active = tab.sessionId === activeTab}
            {@const editing = editingId === tab.sessionId}
            {@const isApp = tab.type === 'app' || isAppTab(tab.sessionId)}
            <div
                class="tab-item"
                class:active
                class:app-tab={isApp}
                class:dragging={draggingId === tab.sessionId}
                class:reorder-target={overId === tab.sessionId}
                draggable="true"
                on:click={() => selectTab(tab)}
                on:dblclick|preventDefault={() => !isApp && startRename(tab)}
                on:dragstart={(event) => dragStart(event, tab)}
                on:dragend={dragEnd}
                on:dragover={(event) => dragOver(event, tab)}
                on:drop={(event) => dropOn(event, tab)}
            >
                {#if editing}
                    <span class="tab-icon"><SlateIcon sigma /></span>
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
                    <span class="tab-icon">
                        {#if isApp}
                            <SlateIcon app={tab} {theme} />
                        {:else}
                            <SlateIcon sigma />
                        {/if}
                    </span>
                    <span class="tab-name">{tab.name}</span>
                    {#if !isApp && isStreaming(tab.sessionId)}
                        <span class="stream-dot"></span>
                    {/if}
                {/if}

                {#if hostedByDesktop}
                    <button class="tab-mini-btn" on:click|stopPropagation={() => openSeparate(tab)} title="Open in separate window" aria-label="Open in separate window">
                        <svg viewBox="0 0 14 14" fill="none" width="10" height="10"><rect x="2" y="2" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/><path d="M6 5h6v7H5V6" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
                    </button>
                {/if}
                <button class="tab-close-btn" on:click|stopPropagation={() => handleClose(tab.sessionId)} title="Close">
                    <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="9" height="9">
                        <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                    </svg>
                </button>
            </div>
        {/each}

        <button class="tab-new-btn" on:click={handleNewTab} title="New tab">
            <svg viewBox="0 0 14 14" fill="none" width="14" height="14">
                <path d="M7 2v10M2 7h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
            </svg>
        </button>
        {#if headerActions.length}
            <div class="header-actions-menu" on:click|stopPropagation>
                <button class="header-actions-trigger" type="button" on:click={() => (headerMenuOpen = !headerMenuOpen)} aria-label="View actions" aria-expanded={headerMenuOpen} title="View actions">•••</button>
                {#if headerMenuOpen}
                    <div class="header-actions-dropdown" role="menu" aria-label="View actions">
                        {#each headerActions as action (`${action.sourcePackage}:${action.id}`)}
                            <button type="button" role="menuitem" on:click={() => runHeaderAction(action)}>
                                <strong>{action.label}</strong>{#if action.description}<small>{action.description}</small>{/if}
                            </button>
                        {/each}
                    </div>
                {/if}
            </div>
        {/if}
        <div class="tab-resize-handle" role="separator" aria-orientation="horizontal" aria-label="Adjust tab height" on:pointerdown={startResize}></div>
    </div>
    </div>
    <button class="tab-bar-toggle" class:collapsed class:preview-hidden={hoverPreview} style="top: {collapsed ? 1 : tabBarHeight - 1}px" on:click={collapsed ? openTabBar : collapseTabBar} aria-label={collapsed ? "Keep tabs open" : "Collapse tabs"} title={collapsed ? "Keep tabs open" : "Collapse tabs"}>
        <svg viewBox="0 0 26 16" fill="none" width="26" height="16" aria-hidden="true"><path d="M3.5 11L13 5l9.5 6" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
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

.mobile-tab-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    opacity: 0.8;
}
.mobile-tab.active .mobile-tab-icon { opacity: 1; }

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
    background: var(--surface-2);
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
    position: absolute;
    inset: 0 0 auto 0;
    display: flex; align-items: stretch;
    background: var(--surface);
    border-bottom: 1px solid var(--border);
    flex-shrink: 0;
    overflow-x: auto; overflow-y: hidden;
    scrollbar-width: none; gap: 1px; padding: 0 4px;
    transform: translateY(0);
    opacity: 1;
    transition: height 180ms ease, transform 260ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease;
    will-change: height, transform;
}
.tab-bar-slot { position: relative; z-index: 8; flex: 0 0 auto; min-height: 0; transition: height 260ms cubic-bezier(0.22, 0.75, 0.18, 1); }
.tab-bar-slot.hover-preview { z-index: 40; }
.tab-bar.hidden { transform: translateY(-100%); opacity: .92; pointer-events: none; }
.tab-edge-trigger { position: fixed; z-index: 39; inset: 0 0 auto 0; height: 24px; }
.tab-bar-toggle { position: absolute; z-index: 50; left: 50%; display: flex; width: 46px; height: 24px; align-items: center; justify-content: center; padding: 0; border: 0; border-radius: 0; background: transparent; color: var(--txt-3); box-shadow: none; cursor: pointer; transform: translateX(-50%); opacity: .42; transition: top 260ms cubic-bezier(0.22, 0.75, 0.18, 1), transform 260ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease, color 180ms ease; }
.tab-bar-toggle.collapsed { transform: translateX(-50%) rotate(180deg); }
.tab-bar-toggle:hover { color: var(--txt); opacity: .86; }
.tab-bar-toggle.preview-hidden { opacity: 0; pointer-events: none; }
.tab-resize-handle { position: absolute; z-index: 3; inset: auto 0 -4px; height: 8px; cursor: row-resize; touch-action: none; }
.tab-resize-handle:hover { background: color-mix(in srgb, var(--border-hi) 42%, transparent); }
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
/* A restrained touch of the Slate elevation language — a flush tab bar
   can't take a translateY lift without breaking alignment with its
   neighbors, so the active tab just gets a tight ambient shadow instead
   of the full floating-object shadow used elsewhere. */
.tab-item.active { color: var(--txt); border-bottom-color: var(--txt); background: var(--w03); box-shadow: 0 4px 10px -8px rgba(0, 0, 0, 0.3); }
.tab-item.pinned { border-left: 1.5px solid var(--w12); }
.tab-item.app-tab { border-left: 1.5px solid var(--w20); }
.tab-item.app-tab.active { color: var(--txt); border-bottom-color: var(--w80); background: var(--w04); }
.tab-item.dragging { opacity: .42; }
.tab-item.reorder-target { box-shadow: inset 0 0 0 1px var(--w25); }

/* O bloco Slate é o identificador da aba: fica levemente recuado quando a
   aba está inativa, como os ícones do dock. */
.tab-icon { display: flex; align-items: center; justify-content: center; flex-shrink: 0; opacity: 0.75; transition: opacity 0.12s; }
.tab-item:hover .tab-icon,
.tab-item.active .tab-icon { opacity: 1; }
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
.header-actions-menu { position: relative; display: grid; place-items: center; flex: 0 0 auto; margin: 0 3px; }
.header-actions-trigger { min-width: 29px; height: 24px; border: 1px solid var(--w12); border-radius: 6px; background: transparent; color: var(--txt-2); cursor: pointer; letter-spacing: 1px; }
.header-actions-trigger:hover, .header-actions-trigger:focus-visible { background: var(--w06); color: var(--txt); outline: none; }
.header-actions-dropdown { position: absolute; top: calc(100% + 4px); right: 0; z-index: 60; display: grid; min-width: 190px; overflow: hidden; border: 1px solid var(--w18); border-radius: 8px; background: var(--surface-2); box-shadow: 0 10px 26px rgba(0,0,0,.35); }
.header-actions-dropdown button { display: grid; gap: 2px; padding: 9px 11px; border: 0; background: transparent; color: var(--txt); text-align: left; cursor: pointer; }
.header-actions-dropdown button:hover, .header-actions-dropdown button:focus-visible { background: var(--w06); outline: none; }
.header-actions-dropdown strong { font: 600 12px var(--font-body); }
.header-actions-dropdown small { color: var(--txt-3); font: 400 10px var(--font-body); }
@media (prefers-reduced-motion: reduce) {
    .tab-bar-slot, .tab-bar, .tab-bar-toggle { transition-duration: 1ms; }
}
</style>
