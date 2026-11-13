<script>
    import { createEventDispatcher, onDestroy, onMount } from 'svelte';
    import { slide } from 'svelte/transition';
    import { api } from '../api.js';
    import { on as busOn } from '../lib/bus.js';
    import { bootstrapComposerSlots } from '../lib/composer_slot_bootstrap.js';

    export let sessionId;
    const dispatch = createEventDispatcher();
    let activities = [];
    let expanded = false;
    let removeListener = null;

    async function refresh() {
        const result = await api(`/activities?sessionId=${encodeURIComponent(sessionId || '')}`, 'GET');
        if (Array.isArray(result)) activities = result;
    }
    function receive(activity) {
        if (activity?.ownerSessionId === sessionId || activity?.observerSessionIds?.includes(sessionId)) refresh();
    }
    function open(activity) {
        expanded = false;
        if (activity.targetSessionId) dispatch('openSession', activity.targetSessionId);
    }
    function stateLabel(state) { return ({ running: 'em andamento', waiting: 'aguardando', success: 'concluído', error: 'falhou', cancelled: 'cancelado' })[state] || state; }
    $: active = activities.filter((a) => !['success', 'error', 'cancelled'].includes(a.state));
    $: completed = activities.filter((a) => ['success', 'error', 'cancelled'].includes(a.state));
    $: headline = active.length ? `${active.length} ${active.length === 1 ? 'atividade em andamento' : 'atividades em andamento'}` : `${completed.length} resultado${completed.length === 1 ? '' : 's'} recente${completed.length === 1 ? '' : 's'}`;

    onMount(() => {
        refresh(); bootstrapComposerSlots();
        removeListener = busOn('agent:activity', receive);
    });
    onDestroy(() => removeListener?.());
</script>

<slot />

{#if activities.length}
    <section class="activity-slot" aria-label="Atividades em segundo plano" transition:slide={{ duration: 200 }}>
        <button class="summary" on:click={() => expanded = !expanded} aria-expanded={expanded}>
            <span class:done={!active.length} class="status-dot"></span>
            <span class="headline">{headline}</span>
            <span class="detail">{active[0]?.title || completed[0]?.title}</span>
            <svg class:open={expanded} viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="m6 8 4 4 4-4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        {#if expanded}
            <div class="activity-list" transition:slide={{ duration: 180 }}>
                {#each activities as activity (activity.id)}
                    <button class:error={activity.state === 'error'} class="activity" on:click={() => open(activity)} disabled={!activity.targetSessionId}>
                        <span class:done={activity.state === 'success'} class:error-dot={activity.state === 'error'} class="status-dot"></span>
                        <span class="copy"><strong>{activity.title}</strong><small>{activity.summary || stateLabel(activity.state)}</small></span>
                        {#if activity.progress?.total}<span class="progress">{activity.progress.current}/{activity.progress.total}</span>{/if}
                        {#if activity.targetSessionId}<svg viewBox="0 0 20 20" fill="none" width="15" height="15"><path d="m8 5 5 5-5 5" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>{/if}
                    </button>
                {/each}
            </div>
        {/if}
    </section>
{/if}

<style>
    .activity-slot { width: 100%; max-width: 960px; box-sizing: border-box; margin: 0 auto 6px; padding: 0 16px; font-family: var(--tk-font, 'Ubuntu', system-ui, sans-serif); }
    .summary, .activity { width: 100%; border: 1px solid var(--tk-border); background: var(--tk-surface); color: var(--tk-text); display: flex; align-items: center; text-align: left; cursor: pointer; }
    .summary { min-height: 38px; gap: 9px; padding: 8px 11px; border-radius: var(--tk-radius-md); }
    .summary:hover, .activity:hover { border-color: var(--tk-border-hi); background: var(--tk-surface-2); }
    .headline { font-size: 13px; font-weight: 500; white-space: nowrap; }.detail { flex: 1; color: var(--tk-muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.summary svg { color: var(--tk-muted); transition: transform 200ms ease-out; }.summary svg.open { transform: rotate(180deg); }
    .status-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--tk-text); flex: 0 0 auto; animation: pulse 1.4s ease-out infinite; }.status-dot.done { background: var(--tk-muted); animation: none; }.error-dot { background: var(--tk-text); animation: none; }
    .activity-list { margin-top: 5px; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-md); overflow: hidden; }.activity { gap: 10px; padding: 10px 11px; border: 0; border-radius: 0; border-bottom: 1px solid var(--tk-border); }.activity:last-child { border-bottom: 0; }.activity:disabled { cursor: default; }.copy { min-width: 0; flex: 1; display: grid; gap: 2px; }.copy strong { font-size: 13px; font-weight: 500; }.copy small { color: var(--tk-muted); font-size: 11px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }.progress { color: var(--tk-muted); font: 11px var(--tk-mono, monospace); }
    @keyframes pulse { 0%,100% { opacity: .45; transform: scale(.85); } 50% { opacity: 1; transform: scale(1); } }
    @media (prefers-reduced-motion: reduce) { .activity-slot, .activity-list, .status-dot, .summary svg { animation: none; transition: none; } }
    @media (max-width: 820px) { .activity-slot { padding: 0 10px; }.detail { display: none; } .summary { min-height: 34px; } }
</style>
