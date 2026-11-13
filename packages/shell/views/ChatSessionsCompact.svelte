<script>
    // ChatSessionsCompact — lista compacta só das abas de CHAT abertas (sem
    // apps, sem histórico). Existe porque no mobile a barra SessionTabs some
    // quando um app está em tela cheia ({#if isMobile && !activeIsApp} em
    // Home.svelte) — este widget dá um jeito de trocar de conversa mesmo
    // nesse estado. Diferente do builtin "windows" (Dock, mistura apps+chats)
    // e do "sessions" (histórico completo via /sessions/list).
    import { createEventDispatcher } from "svelte";
    import { hasSessionUpdate, isSessionWorking } from "./lib/session_activity.js";

    export let chatTabs = [];
    export let activeTab = "";
    export let loadingMap = {};
    export let unreadMap = {};

    const dispatch = createEventDispatcher();
    const PAGE_SIZE = 8;
    let page = 0;

    function select(id) { dispatch("selectChat", id); }
    function selectFromKeyboard(e, id) {
        if (e.target !== e.currentTarget) return;
        if (e.key !== "Enter" && e.key !== " ") return;
        e.preventDefault();
        select(id);
    }
    function togglePin(e, id) {
        e.stopPropagation();
        dispatch("togglePin", id);
    }
    function close(e, id) {
        e.stopPropagation();
        dispatch("closeChat", id);
    }

    $: orderedTabs = [
        ...chatTabs.filter((tab) => tab.pinned),
        ...chatTabs.filter((tab) => !tab.pinned),
    ];
    $: totalPages = Math.max(1, Math.ceil(orderedTabs.length / PAGE_SIZE));
    $: page = Math.min(page, totalPages - 1);
    $: pageTabs = orderedTabs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);

    function previousPage() { page = Math.max(0, page - 1); }
    function nextPage() { page = Math.min(totalPages - 1, page + 1); }
</script>

{#if chatTabs.length > 0}
    <div class="csc-list">
        {#each pageTabs as tab (tab.sessionId)}
            <div
                class="csc-item"
                class:active={activeTab === tab.sessionId}
                role="button"
                tabindex="0"
                on:click={() => select(tab.sessionId)}
                on:keydown={(e) => selectFromKeyboard(e, tab.sessionId)}
            >
                {#if isSessionWorking(tab.sessionId, loadingMap) && activeTab !== tab.sessionId}
                    <span class="csc-status csc-status-loading" aria-label="Response in progress"></span>
                {:else if hasSessionUpdate(tab.sessionId, unreadMap) && activeTab !== tab.sessionId}
                    <span class="csc-status csc-status-unread" aria-label="New response"></span>
                {/if}
                <span class="csc-label">{tab.name || tab.sessionId}</span>
                <button
                    type="button"
                    class="csc-pin"
                    class:pinned={tab.pinned}
                    on:click={(e) => togglePin(e, tab.sessionId)}
                    aria-label={tab.pinned ? "Unpin conversation" : "Pin conversation"}
                    title={tab.pinned ? "Unpin conversation" : "Pin conversation"}
                >
                    <svg viewBox="0 0 16 16" fill="none" width="13" height="13" aria-hidden="true">
                        <path d="M5.1 2.7h5.8l-.7 3.1 2 2v.9H3.8v-.9l2-2-.7-3.1zM8 8.7v4.6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
                <button
                    type="button"
                    class="csc-close"
                    on:click={(e) => close(e, tab.sessionId)}
                    aria-label="Close conversation"
                >×</button>
            </div>
        {/each}
    </div>
    {#if totalPages > 1}
        <nav class="csc-pagination" aria-label="Open conversation pages">
            <button type="button" on:click={previousPage} disabled={page === 0} aria-label="Previous page">Previous</button>
            <span aria-current="page">{page + 1} de {totalPages}</span>
            <button type="button" on:click={nextPage} disabled={page === totalPages - 1} aria-label="Next page">Next</button>
        </nav>
    {/if}
{/if}

<style>
    .csc-list {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .csc-item {
        display: flex;
        align-items: center;
        gap: 8px;
        width: 100%;
        padding: 7px 9px;
        border: 1px solid var(--rail-border);
        border-radius: 8px;
        background: var(--rail-flat);
        color: var(--rail-txt-2);
        font-family: inherit;
        font-size: 12.5px;
        font-weight: 500;
        cursor: pointer;
        transition: border-color 0.15s, color 0.15s;
        -webkit-tap-highlight-color: transparent;
    }
    .csc-item:hover { border-color: var(--rail-border-hi); color: var(--rail-txt); }
    .csc-item.active { border-color: var(--rail-border-hi); background: var(--rail-border); color: var(--rail-txt); }
    .csc-label {
        flex: 1;
        text-align: left;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .csc-status {
        width: 6px;
        height: 6px;
        flex: 0 0 6px;
        border-radius: 50%;
    }
    .csc-status-loading {
        box-sizing: border-box;
        border: 1.5px solid var(--rail-txt-3);
    }
    .csc-status-unread { background: var(--rail-txt); }
    .csc-pin {
        display: inline-flex;
        flex-shrink: 0;
        align-items: center;
        justify-content: center;
        width: 28px;
        height: 28px;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 50%;
        background: transparent;
        color: var(--rail-txt-3);
        opacity: 1;
        transition: color 0.2s ease-out, background-color 0.2s ease-out, border-color 0.2s ease-out, transform 0.2s ease-out;
    }
    .csc-pin.pinned {
        border-color: var(--rail-border-hi);
        background: var(--rail-border);
        color: var(--rail-txt);
    }
    .csc-pin:hover { color: var(--rail-txt); background: var(--rail-border); }
    .csc-pin:active { transform: scale(0.92); }
    .csc-pin:focus-visible {
        outline: 2px solid var(--rail-txt);
        outline-offset: 2px;
    }
    @media (pointer: coarse), (max-width: 820px) {
        .csc-pin {
            width: 36px;
            height: 36px;
            margin: -4px;
        }
    }
    .csc-close {
        flex-shrink: 0;
        border: 0;
        background: transparent;
        color: var(--rail-txt-3);
        font-family: inherit;
        font-size: 14px;
        line-height: 1;
        padding: 2px 4px;
    }
    .csc-close:hover { color: var(--rail-txt); }
    .csc-pagination {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
        margin-top: 6px;
        color: var(--rail-txt-3);
        font-size: 11px;
    }
    .csc-pagination button {
        border: 0;
        padding: 3px 0;
        background: transparent;
        color: var(--rail-txt-2);
        font: inherit;
        cursor: pointer;
    }
    .csc-pagination button:disabled {
        cursor: default;
        opacity: 0.4;
    }
    .csc-pagination button:not(:disabled):hover { color: var(--rail-txt); }
    .csc-pagination button:focus-visible {
        outline: 2px solid var(--rail-txt);
        outline-offset: 2px;
    }
</style>
