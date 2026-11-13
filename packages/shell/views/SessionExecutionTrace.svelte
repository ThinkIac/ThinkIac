<script>
    import { onMount } from "svelte";
    import ExecutionTrace from "./components/ExecutionTrace.svelte";

    let sessionId = "";
    let history = [];
    let loading = true;
    let error = "";

    async function loadTrace() {
        if (!sessionId) return;
        loading = true;
        error = "";
        try {
            const response = await fetch(`/agent/sessions/${encodeURIComponent(sessionId)}/history?limit=all`);
            const payload = await response.json();
            const data = payload?.data ?? payload;
            if (!response.ok || !Array.isArray(data)) throw new Error(payload?.error || payload?.message || "Unable to load the conversation trace.");
            history = data;
        } catch (cause) {
            history = [];
            error = cause?.message || "Unable to load the conversation trace.";
        } finally {
            loading = false;
        }
    }

    onMount(() => {
        sessionId = new URLSearchParams(window.location.search).get("sessionId")?.trim() || "";
        if (!sessionId) {
            loading = false;
            error = "Session identifier was not provided.";
            return;
        }
        loadTrace();
    });
</script>

{#if loading}
    <main class="state">Loading execution trace…</main>
{:else if error}
    <main class="state"><p>{error}</p><button type="button" on:click={loadTrace}>Try again</button></main>
{:else}
    <ExecutionTrace {history} {sessionId} />
{/if}

<style>
    :global(*){box-sizing:border-box}:global(body){margin:0;background:var(--tk-bg,#111);color:var(--tk-text,#eee);font-family:var(--tk-font,system-ui,sans-serif)}.state{display:grid;min-height:100dvh;place-content:center;gap:.8rem;color:var(--tk-muted,#999);text-align:center}.state p{margin:0}.state button{border:1px solid var(--tk-border,rgba(255,255,255,.14));border-radius:var(--tk-radius-md,8px);background:var(--tk-surface,#181818);color:inherit;padding:.5rem .7rem;font:inherit;cursor:pointer}
</style>
