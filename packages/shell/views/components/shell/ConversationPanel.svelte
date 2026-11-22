<script>
    import MessageList from '../../MessageList.svelte';
    import ActivitySlot from '../ActivitySlot.svelte';
    export let activeIsApp;
    export let composerDockHeight;
    export let isMobile;
    export let historyTruncated;
    export let loadFullHistory;
    export let loadingFullHistory;
    export let history;
    export let activeAgent;
    export let activeTab;
    export let loadingMap;
    export let handleOpenCanvas;
    export let handleResolvePermission;
    export let handleMessageFeedback;
    export let retryTimedOutTurn;
    export let abrirChatPorDeepLink;
    export let listRef;
    export let message;
</script>

            <div class="chat-panel" class:hidden={activeIsApp} style={`--composer-reserve: ${composerDockHeight}px`}>
                {#if isMobile && historyTruncated}
                    <button
                        class="mobile-history-expand"
                        on:click={loadFullHistory}
                        disabled={loadingFullHistory}
                    >
                        {loadingFullHistory ? "Loading full conversation…" : "Load full conversation history"}
                    </button>
                {/if}
                <MessageList
                    {history}
                    {isMobile}
                    agentName={activeAgent?.name ?? "Agent"}
                    sessionId={activeTab}
                    loading={loadingMap[activeTab] ?? false}
                    bind:this={listRef}
                    on:openCanvas={handleOpenCanvas}
                    on:resolvePermission={handleResolvePermission}
                    on:messageFeedback={handleMessageFeedback}
                    on:retry={(e) => retryTimedOutTurn(e.detail.sessionId, e.detail.index)}
                    on:useSuggestion={(e) => (message = e.detail)}
                />

                <ActivitySlot sessionId={activeTab} on:openSession={(e) => abrirChatPorDeepLink(e.detail)}>
                </ActivitySlot>

                <slot />
            </div>

<style>
    .chat-panel {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        transition: opacity 0.15s;
    }
    .mobile-history-expand {
        position: relative;
        z-index: 2;
        flex: 0 0 auto;
        align-self: center;
        margin: 8px 12px 0;
        padding: 7px 12px;
        border: 1px solid var(--rail-border);
        border-radius: 999px;
        background: var(--rail-bg);
        color: var(--rail-txt-2);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
    }
    .mobile-history-expand:disabled {
        cursor: wait;
        opacity: 0.65;
    }
    .chat-panel :global(.ml-root) { padding-bottom: var(--composer-reserve, 122px); }
    .chat-panel.hidden {
        opacity: 0;
        pointer-events: none;
    }
</style>
