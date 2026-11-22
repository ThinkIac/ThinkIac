<script>
    import StructuredInput from '../StructuredInput.svelte';
    import InputBar from '../../InputBar.svelte';
    import NotifyOptIn from '../NotifyOptIn.svelte';
    export let structuredProps;
    export let onStructuredSend;
    export let onEscape;
    export let appId;
    export let history;
    export let isMobile;
    export let loadingMap;
    export let activeTab;
    export let isOnline;
    export let animateComposerToDock;
    export let send;
    export let handleStop;
    export let handleNewSpecialistSession;
    export let recentSessionsLoading;
    export let visibleRecentSessions;
    export let recentSessions;
    export let recentSessionInfiniteScroll;
    export let handleRecentSessionsScroll;
    export let openRecentSession;
    export let recentSessionLabel;
    export let recentSessionMeta;
    export let composerStage;
    export let message;
</script>

                {#if structuredProps}
                    <StructuredInput
                        steps={structuredProps}
                        on:send={onStructuredSend}
                        on:escape={onEscape}
                    />
                {:else}
                    <NotifyOptIn {appId} />
                    <div bind:this={composerStage} class="composer-stage" class:initial={history.length === 0}>
                        {#if history.length === 0}
                            <h1 class="composer-title">What will we build today?</h1>
                        {/if}
                        <InputBar
                            bind:value={message}
                            initial={history.length === 0}
                            {isMobile}
                            loading={loadingMap[activeTab] ?? false}
                            sessionId={activeTab}
                            disabled={!isOnline}
                            on:depart={animateComposerToDock}
                            on:send={send}
                            on:stop={(e) => handleStop(e?.detail)}
                            on:newSpecialistSession={handleNewSpecialistSession}
                        />
                    </div>
                    {#if !isMobile && history.length === 0 && (recentSessionsLoading || visibleRecentSessions.length)}
                        <section class="recent-sessions" aria-label="Recent conversations">
                            {#if visibleRecentSessions.length}
                                <div
                                    class="recent-session-list"
                                    use:recentSessionInfiniteScroll
                                    on:scroll={handleRecentSessionsScroll}
                                >
                                    {#each visibleRecentSessions as recent (recent.id)}
                                        <button
                                            type="button"
                                            class="recent-session"
                                            on:click={() => openRecentSession(recent.id)}
                                            title={recentSessionLabel(recent)}
                                        >
                                            <span class="recent-session-title">{recentSessionLabel(recent)}</span>
                                            <span class="recent-session-meta">{recentSessionMeta(recent)}</span>
                                        </button>
                                    {/each}
                                    {#if visibleRecentSessions.length < recentSessions.length}
                                        <div class="recent-sessions-sentinel" aria-hidden="true"></div>
                                    {/if}
                                </div>
                            {:else}
                                <span class="recent-sessions-loading">Loading recent conversations…</span>
                            {/if}
                        </section>
                    {/if}
                {/if}

<style>
    .composer-stage {
        position: absolute;
        z-index: 4;
        right: 0;
        bottom: 0;
        left: 0;
        width: 100%;
        transform-origin: center bottom;
    }
    .composer-stage.initial {
        top: 50%;
        bottom: auto;
        transform: translateY(-50%);
        transform-origin: center center;
    }
    .composer-title {
        margin: 0 0 1rem;
        color: var(--txt, #f5f5f5);
        font-size: clamp(1.5rem, 2.6vw, 2rem);
        font-weight: 650;
        letter-spacing: -.035em;
        line-height: 1.15;
        text-align: center;
    }
    .recent-sessions {
        position: absolute;
        z-index: 3;
        right: 0;
        bottom: max(1.5rem, env(safe-area-inset-bottom));
        left: 0;
        display: flex;
        width: min(100% - 2rem, 38rem);
        min-height: 2rem;
        box-sizing: border-box;
        align-items: stretch;
        margin: 0 auto;
    }
    .recent-session-list {
        display: grid;
        width: 100%;
        max-height: 8.25rem;
        gap: .2rem;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: none;
    }
    .recent-session-list::-webkit-scrollbar { display: none; }
    .recent-session {
        display: grid;
        min-width: 0;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: .75rem;
        border: 0;
        border-radius: .5rem;
        background: transparent;
        padding: .3rem .45rem;
        color: var(--tk-muted, #888);
        font: inherit;
        text-align: left;
        cursor: pointer;
        opacity: .72;
        transition: background 160ms ease, color 160ms ease, opacity 160ms ease;
    }
    .recent-session:hover,
    .recent-session:focus-visible {
        background: color-mix(in srgb, var(--tk-surface, #181818) 76%, transparent);
        color: var(--tk-text, #f5f5f5);
        opacity: 1;
        outline: none;
    }
    .recent-session:focus-visible { box-shadow: 0 0 0 1px var(--tk-border-hi, rgba(255,255,255,.2)); }
    .recent-session-title {
        overflow: hidden;
        font-size: .76rem;
        font-weight: 500;
        letter-spacing: -.01em;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .recent-session-meta {
        color: var(--tk-muted-2, #666);
        font: 400 .65rem var(--tk-mono, monospace);
        line-height: 1.55;
        white-space: nowrap;
    }
    .recent-sessions-sentinel { height: 1px; }
    .recent-sessions-loading {
        margin: auto;
        color: var(--tk-muted-2, #666);
        font: 400 .67rem var(--tk-mono, monospace);
    }
    @media (max-width: 560px) {
        .composer-stage.initial { top: 46%; }
    }
</style>
