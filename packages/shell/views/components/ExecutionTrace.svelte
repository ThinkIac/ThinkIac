<script>
    // Projeção local e somente-leitura do histórico já carregado pelo Chat.
    // Não pede nem persiste dados novos: abrir o inspector nunca altera a sessão.
    export let history = [];
    export let sessionId = "";
    let selectedId = null;
    let projection = "sequence";

    const text = (value) => {
        if (value === null || value === undefined || value === "") return "Not recorded";
        if (typeof value === "string") return value;
        try { return JSON.stringify(value, null, 2); } catch { return String(value); }
    };
    const when = (value) => value ? new Date(value).toLocaleString() : "Live / not recorded";
    const toolState = (step) => step?.result === undefined || step?.result === null ? "running" : "completed";
    const preview = (value, limit = 88) => {
        const source = typeof value === "string" ? value : text(value);
        return source.length > limit ? `${source.slice(0, limit - 1)}…` : source;
    };
    const laneFor = (kind) => kind === "tool" ? 2 : kind === "context" ? 1 : 0;
    const laneName = ["Conversation", "Context", "Tools"];
    const stamp = (value) => {
        const parsed = Date.parse(value);
        return Number.isFinite(parsed) ? parsed : null;
    };

    $: turns = history.reduce((all, message, index) => {
        if (message?.role === "user") {
            all.push({ id: `turn-${index}`, user: message, assistant: null, index });
        } else if (message?.role === "assistant") {
            const current = all[all.length - 1];
            if (current && !current.assistant) current.assistant = message;
            else all.push({ id: `turn-${index}`, user: null, assistant: message, index });
        }
        return all;
    }, []);
    $: records = turns.flatMap((turn) => {
        const out = [];
        if (turn.user) out.push({ id: `${turn.id}-user`, kind: "input", label: "User", content: turn.user.content, at: turn.user.createdAt, turn });
        if (turn.assistant?.allReasoning) out.push({ id: `${turn.id}-context`, kind: "context", label: "Context", content: turn.assistant.allReasoning, at: turn.assistant.createdAt, turn });
        for (const [stepIndex, step] of (turn.assistant?.steps ?? []).entries()) {
            out.push({ id: `${turn.id}-tool-${step.toolCallId ?? stepIndex}`, kind: "tool", label: step.label || "Tool", step, at: step.startedAt ?? turn.assistant?.createdAt, turn });
        }
        if (turn.assistant) out.push({ id: `${turn.id}-output`, kind: "output", label: turn.assistant.streaming ? "Assistant · running" : "Assistant", content: turn.assistant.content, at: turn.assistant.createdAt, turn });
        return out;
    });
    $: timeline = records.map((record, index) => {
        const started = stamp(record.at);
        const finished = stamp(record.step?.finishedAt ?? record.step?.completedAt);
        return { ...record, index, lane: laneFor(record.kind), started, duration: Math.max(700, (finished && started ? finished - started : record.step?.durationMs) || 1200) };
    });
    $: timelineStart = projection === "time" && timeline.some((record) => record.started) ? Math.min(...timeline.filter((record) => record.started).map((record) => record.started)) : 0;
    $: timelineEnd = projection === "time" && timelineStart ? Math.max(...timeline.map((record) => (record.started ?? timelineStart) + record.duration)) : Math.max(timeline.length, 1);
    $: timelineBars = timeline.map((record) => {
        const start = projection === "time" && timelineStart ? ((record.started ?? timelineStart) - timelineStart) / Math.max(timelineEnd - timelineStart, 1) : record.index / Math.max(timeline.length, 1);
        const width = projection === "time" && timelineStart ? record.duration / Math.max(timelineEnd - timelineStart, 1) : 1 / Math.max(timeline.length, 1);
        return { ...record, left: Math.max(0, start * 100), width: Math.max(2.5, width * 100) };
    });
    $: if (!selectedId && records.length) selectedId = records[records.length - 1].id;
    $: selected = records.find((record) => record.id === selectedId) ?? null;
</script>

<section class="trace" aria-labelledby="execution-trace-title">
        <header>
            <div><p>EXECUTION</p><h2 id="execution-trace-title">Trajectory</h2><small>{sessionId || "Current conversation"}</small></div>
            <div class="projection" aria-label="Timeline projection"><button type="button" class:active={projection === "sequence"} on:click={() => projection = "sequence"}>Sequence</button><button type="button" class:active={projection === "time"} on:click={() => projection = "time"}>Duration</button></div>
        </header>
        <div class="trace-summary"><span>{turns.length} turns</span><span>{records.filter((r) => r.kind === "tool").length} tools</span><span class:live={history.some((m) => m.streaming)}>{history.some((m) => m.streaming) ? "Live" : "Complete"}</span></div>
        <div class="trajectory" aria-label="Execution timeline">
            <div class="trajectory-heading"><strong>Timeline</strong><small>{projection === "time" && timelineStart ? "Recorded duration" : "Event sequence"}</small></div>
            {#each laneName as name, lane}<div class="trajectory-lane"><span>{name}</span><div class="trajectory-track">{#each timelineBars.filter((record) => record.lane === lane) as record (record.id)}<button type="button" class:active={selectedId === record.id} class:tool={record.kind === "tool"} class:context={record.kind === "context"} style={`left:${record.left}%;width:${record.width}%`} title={record.label} on:click={() => selectedId = record.id}>{record.label}</button>{/each}</div></div>{/each}
        </div>
        <div class="trace-main">
            <nav aria-label="Execution events">
                {#if !records.length}<p class="empty">No events recorded in this conversation yet.</p>{/if}
                {#each records as record (record.id)}
                    <button type="button" class:active={selectedId === record.id} class:tool={record.kind === "tool"} on:click={() => (selectedId = record.id)}>
                        <i aria-hidden="true"></i><span><strong>{record.label}</strong><small>{record.kind === "tool" ? toolState(record.step) : record.kind}</small>{#if record.kind === "tool"}<em>{preview(record.step.args)}</em>{/if}</span>
                    </button>
                {/each}
            </nav>
            <article aria-live="polite">
                {#if selected}
                    <p class="record-type">{selected.kind}{selected.kind === "tool" ? ` · ${toolState(selected.step)}` : ""}</p><h3>{selected.label}</h3><p class="timestamp">{when(selected.at)}</p>
                    {#if selected.kind === "tool"}
                        <h4>Call</h4><pre>{text(selected.step.args)}</pre>
                        <h4>{toolState(selected.step) === "running" ? "Awaiting result" : "Result"}</h4><pre>{text(selected.step.result)}</pre>
                        {#if selected.step.reasoning}<h4>Visible note</h4><pre>{text(selected.step.reasoning)}</pre>{/if}
                    {:else}
                        <h4>{selected.kind === "output" ? "Response" : "Content"}</h4><pre>{text(selected.content)}</pre>
                        {#if selected.kind === "output" && selected.turn.assistant?.model}<h4>Model</h4><pre>{selected.turn.assistant.provider ? `${selected.turn.assistant.provider} / ` : ""}{selected.turn.assistant.model}</pre>{/if}
                    {/if}
                {:else}<p class="empty">Choose an event to inspect its details.</p>{/if}
            </article>
        </div>
        <footer>Derived from the conversation event stream. Hidden reasoning and secrets are not exposed here.</footer>
</section>

<style>
    .trace { display: flex; min-height: 100dvh; flex-direction: column; overflow: hidden; background: var(--tk-bg, #111); color: var(--tk-text, #eee); }
    header { display: flex; align-items: center; justify-content: space-between; padding: 1.1rem 1.25rem .85rem; border-bottom: 1px solid var(--tk-border, #303030); } header p, header small, .record-type, .timestamp, footer, nav small, .trajectory small { margin: 0; color: var(--tk-muted, #999); font: 500 .65rem var(--tk-mono, monospace); letter-spacing: .08em; text-transform: uppercase; } h2 { margin: .18rem 0; font-size: 1.15rem; letter-spacing: -.02em; }.projection{display:flex;gap:.35rem}.projection button{border:1px solid var(--tk-border,#303030);border-radius:var(--tk-radius-md,8px);background:transparent;color:var(--tk-muted,#999);padding:.4rem .55rem;font:500 .67rem var(--tk-mono,monospace);cursor:pointer}.projection button.active{background:var(--tk-accent,#eee);color:var(--tk-on-accent,#111)}
    .trace-summary { display: flex; gap: .4rem; padding: .55rem 1.25rem; border-bottom: 1px solid var(--tk-border, #303030); } .trace-summary span { padding: .23rem .5rem; border-radius: 999px; background: color-mix(in srgb, var(--tk-accent, #7c9cff) 12%, transparent); color: var(--tk-muted, #aaa); font: 500 .66rem var(--tk-mono, monospace); }.trace-summary .live { color: var(--tk-accent, #9db4ff); }
    .trajectory{padding:.8rem 1.25rem;border-bottom:1px solid var(--tk-border,#303030);overflow-x:auto}.trajectory-heading{display:flex;justify-content:space-between;margin:0 0 .5rem 7.25rem}.trajectory-heading strong{font-size:.74rem}.trajectory-lane{display:grid;grid-template-columns:6.5rem minmax(25rem,1fr);gap:.75rem;align-items:center;min-height:2rem}.trajectory-lane>span{color:var(--tk-muted,#999);font-size:.68rem}.trajectory-track{position:relative;height:1.15rem;border-radius:var(--tk-radius-md,8px);background:var(--tk-surface-2,#1f1f1f);box-shadow:inset 0 0 0 1px var(--tk-border,#303030)}.trajectory-track button{position:absolute;top:.18rem;overflow:hidden;height:.8rem;border:0;border-radius:999px;background:var(--tk-accent,#eee);color:var(--tk-on-accent,#111);padding:0 .35rem;font:600 .56rem/.8rem var(--tk-mono,monospace);text-align:left;text-overflow:ellipsis;white-space:nowrap;cursor:pointer}.trajectory-track button.tool{background:color-mix(in srgb,var(--tk-accent,#eee) 70%,var(--tk-muted,#999))}.trajectory-track button.context{background:var(--tk-muted,#999)}.trajectory-track button.active{outline:2px solid var(--tk-text,#eee);outline-offset:2px}
    .trace-main { display: grid; min-height: 0; flex: 1; grid-template-columns: minmax(14rem, .88fr) minmax(0, 1.72fr); } nav { overflow: auto; padding: .55rem; border-right: 1px solid var(--tk-border, #303030); } nav button { display: flex; width: 100%; gap: .7rem; align-items: flex-start; border: 0; border-radius: 9px; background: transparent; padding: .65rem; color: inherit; text-align: left; cursor: pointer; } nav button:hover, nav button.active { background: color-mix(in srgb, var(--tk-accent, #eee) 13%, transparent); } nav i { width: .45rem; height: .45rem; margin-top: .3rem; flex: 0 0 auto; border-radius: 50%; background: var(--tk-accent,#eee); } nav .tool i { background: var(--tk-muted,#999); } nav span { min-width: 0; } nav strong { display: block; overflow: hidden; font-size: .78rem; text-overflow: ellipsis; white-space: nowrap; } nav small { display: block; margin-top: .18rem; } nav em { display: block; overflow: hidden; margin-top: .25rem; color: var(--tk-muted, #999); font: .69rem var(--tk-mono, monospace); font-style: normal; text-overflow: ellipsis; white-space: nowrap; }
    article { overflow: auto; padding: 1.1rem 1.2rem; } article h3 { margin: .2rem 0; font-size: 1rem; } h4 { margin: 1.2rem 0 .45rem; color: var(--tk-muted, #aaa); font-size: .72rem; text-transform: uppercase; } pre { overflow: auto; margin: 0; border: 1px solid var(--tk-border, #303030); border-radius: 8px; background: color-mix(in srgb, var(--tk-bg, #090909) 72%, transparent); padding: .75rem; white-space: pre-wrap; overflow-wrap: anywhere; font: 400 .75rem/1.55 var(--tk-mono, monospace); } .empty { padding: 1rem; color: var(--tk-muted, #999); font-size: .8rem; } footer { padding: .65rem 1.15rem; border-top: 1px solid var(--tk-border, #303030); letter-spacing: 0; text-transform: none; }
    @media (max-width: 600px) { .trace-main { grid-template-columns: 8.75rem minmax(0, 1fr); } nav { padding: .3rem; } nav button { padding: .55rem .4rem; gap: .4rem; } nav strong { font-size: .7rem; } article { padding: .9rem; } footer { display: none; }.trajectory{padding:.65rem .8rem}.trajectory-heading{margin-left:6.15rem}.trajectory-lane{grid-template-columns:5.5rem minmax(20rem,1fr);gap:.55rem} }
</style>
