<script>
    import { onMount } from "svelte";

    const R = 16;
    const CIRC = 2 * Math.PI * R;
    const NET_SCALE_KBS = 2048;
    const GRAPH_WIDTH = 320;
    const GRAPH_HEIGHT = 46;
    const MODES = ["CPU", "MEM", "DISCO", "REDE"];

    let stats = null;
    let history = [];
    let selectedMode = null;
    let theme = "dark";
    let timer;
    let resizeObserver;

    function send(type, detail) { parent.postMessage({ source: "agent", type, detail }, "*"); }
    function reportHeight() { send("widget:height", document.documentElement.scrollHeight); }

    async function fetchStats() {
        try {
            const res = await fetch("/system-monitor/stats");
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const json = await res.json();
            if (json?.error) { stats = null; return; }
            stats = json;
            history = [...history, json].slice(-60);
        } catch { stats = null; }
    }

    function applyTheme(nextTheme) {
        theme = nextTheme === "light" ? "light" : "dark";
        // The iframe canvas can be visible briefly while a widget resizes.
        // Keep its document surface in sync with the Shell, rather than
        // falling back to the browser's (occasionally navy) default canvas.
        document.documentElement.dataset.theme = theme;
        document.body.dataset.theme = theme;
    }
    function syncTheme() { applyTheme(localStorage.getItem("think:theme")); }
    function onStorage(event) { if (event.key === "think:theme") syncTheme(); }
    function onShellContext(event) {
        if (event.source !== parent || event.data?.source !== "thinkiac-shell" || event.data?.type !== "shell:context") return;
        applyTheme(event.data.detail?.theme);
    }
    function color(pct) {
        if (!Number.isFinite(pct)) return "var(--tk-muted-2)";
        if (pct >= 90) return "var(--tk-danger)";
        if (pct >= 70) return "var(--tk-warning)";
        return "var(--tk-accent)";
    }
    function formatRate(value) {
        if (!Number.isFinite(value)) return "-";
        return value >= 1024 ? `${(value / 1024).toFixed(1)} MB/s` : `${value.toFixed(1)} KB/s`;
    }
    function metricValue(sample, mode, series = "main") {
        if (!sample) return 0;
        if (mode === "CPU") return sample.cpu?.pct ?? 0;
        if (mode === "MEM") return sample.mem?.pct ?? 0;
        if (mode === "DISCO") return sample.disk?.pct ?? 0;
        return series === "up" ? sample.net?.txKBs ?? 0 : sample.net?.rxKBs ?? 0;
    }
    function chartPoints(mode, series = "main") {
        const values = history.map((sample) => metricValue(sample, mode, series));
        const max = Math.max(1, ...values);
        const count = Math.max(1, values.length - 1);
        return values.map((value, index) => {
            const x = (index / count) * GRAPH_WIDTH;
            const y = GRAPH_HEIGHT - (value / max) * (GRAPH_HEIGHT - 4) - 2;
            return { x, y, value, at: history[index]?.at };
        });
    }
    function points(mode, series = "main") {
        return chartPoints(mode, series).map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(" ");
    }
    function tooltip(point, mode, series = "main") {
        const time = point.at ? new Date(point.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "Agora";
        const name = mode === "REDE" ? (series === "up" ? "Upload" : "Download") : mode;
        const value = mode === "REDE" ? formatRate(point.value) : `${point.value}%`;
        return `${name}: ${value} · ${time}`;
    }
    function detailValue(mode) {
        if (!stats) return "Sem dados";
        if (mode === "CPU") return `${stats.cpu.pct}%`;
        if (mode === "MEM") return `${stats.mem.usedGB} / ${stats.mem.totalGB} GB`;
        if (mode === "DISCO") return `${stats.disk.usedGB} / ${stats.disk.totalGB} GB`;
        return `${formatRate(stats.net.rxKBs)} ↓  ${formatRate(stats.net.txKBs)} ↑`;
    }
    function detailCaption(mode) {
        return mode === "REDE" ? "↓ download  ·  ↑ upload  ·  escala do anel: 2 MB/s" : `${history.length} leituras recentes`;
    }

    $: gauges = stats ? [
        { label: "CPU", pct: stats.cpu.pct, value: `${stats.cpu.pct}%` },
        { label: "MEM", pct: stats.mem.pct, value: `${stats.mem.usedGB}GB` },
        { label: "DISCO", pct: stats.disk.pct, value: `${stats.disk.usedGB}GB` },
        { label: "REDE", pct: Math.min(100, Math.round(((stats.net.rxKBs + stats.net.txKBs) / NET_SCALE_KBS) * 100)), value: `${stats.net.rxKBs}↓ ${stats.net.txKBs}↑` },
    ] : MODES.map((label) => ({ label, pct: null, value: "-" }));

    onMount(() => {
        syncTheme();
        window.addEventListener("storage", onStorage);
        window.addEventListener("message", onShellContext);
        fetchStats();
        timer = setInterval(fetchStats, 3000);
        resizeObserver = new ResizeObserver(reportHeight);
        resizeObserver.observe(document.body);
        reportHeight();
        return () => {
            if (timer) clearInterval(timer);
            if (resizeObserver) resizeObserver.disconnect();
            window.removeEventListener("storage", onStorage);
            window.removeEventListener("message", onShellContext);
        };
    });
</script>

<div class="wrap" data-theme={theme}>
    {#if selectedMode}
        <section class="detail" aria-label={`Detalhes de ${selectedMode}`}>
            <div class="detail-head">
                <button class="back" type="button" aria-label="Voltar para visão geral" on:click={() => selectedMode = null}>
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M9.5 3 4.5 8l5 5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    Voltar
                </button>
                <span class="detail-mode">{selectedMode}</span>
                <strong>{detailValue(selectedMode)}</strong>
            </div>
            <svg class="chart" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} role="img" aria-label={`Histórico de ${selectedMode}`} preserveAspectRatio="none">
                <line x1="0" y1={GRAPH_HEIGHT - 2} x2={GRAPH_WIDTH} y2={GRAPH_HEIGHT - 2} stroke="var(--tk-border-hi)" stroke-width="1" />
                {#if history.length > 0}
                    <polyline points={points(selectedMode)} fill="none" stroke="var(--tk-accent)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><title>{selectedMode === "REDE" ? "Download" : `${selectedMode}: últimos ${history.length} pontos`}</title></polyline>
                    {#each chartPoints(selectedMode) as point, index (index)}
                        <circle cx={point.x} cy={point.y} r="4" fill="transparent"><title>{tooltip(point, selectedMode)}</title></circle>
                    {/each}
                    {#if selectedMode === "REDE"}
                        <polyline points={points(selectedMode, "up")} fill="none" stroke="var(--tk-muted)" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><title>Upload</title></polyline>
                        {#each chartPoints(selectedMode, "up") as point, index (`up-${index}`)}
                            <circle cx={point.x} cy={point.y} r="4" fill="transparent"><title>{tooltip(point, selectedMode, "up")}</title></circle>
                        {/each}
                    {/if}
                {:else}
                    <text x={GRAPH_WIDTH / 2} y="28" text-anchor="middle" class="empty-chart">Aguardando leituras</text>
                {/if}
            </svg>
            <p class="detail-caption">{detailCaption(selectedMode)}</p>
        </section>
    {:else}
        <div class="row" aria-label="Resumo do sistema">
            {#each gauges as g (g.label)}
                <button class="gauge" type="button" aria-label={`Abrir detalhes de ${g.label}`} on:click={() => selectedMode = g.label}>
                    <svg viewBox="0 0 40 40" width="40" height="40" aria-hidden="true">
                        <circle cx="20" cy="20" r={R} fill="none" stroke="var(--tk-border-hi)" stroke-width="4" />
                        <circle cx="20" cy="20" r={R} fill="none" stroke={color(g.pct)} stroke-width="4" stroke-linecap="round" stroke-dasharray={CIRC} stroke-dashoffset={CIRC * (1 - (g.pct ?? 0) / 100)} transform="rotate(-90 20 20)" />
                        <text x="20" y="23" text-anchor="middle" class="gauge-pct">{g.pct ?? 0}</text>
                    </svg>
                    <span class="gauge-label">{g.label}</span><span class="gauge-value">{g.value}</span>
                </button>
            {/each}
        </div>
    {/if}
</div>

<style>
    /* Widgets run in an iframe.  Its document must own its surface instead of
       exposing the host/browser fallback colour through transparent pixels. */
    :global(html), :global(body), :global(#app) { min-height: 100%; margin: 0; padding: 0; overflow: hidden; background: #111111; }
    :global(html[data-theme="light"]), :global(html[data-theme="light"] body), :global(html[data-theme="light"] #app) { background: #ffffff; }
    :global(*) { box-sizing: border-box; }
    [data-theme="dark"] { --tk-bg: #111111; --tk-surface: #181818; --tk-surface-2: #1f1f1f; --tk-border: rgba(255,255,255,.09); --tk-border-hi: rgba(255,255,255,.16); --tk-text: #f5f5f5; --tk-muted: #888888; --tk-muted-2: rgba(136,136,136,.5); --tk-accent: #f5f5f5; --tk-on-accent: #111111; --tk-warning: #f5a524; --tk-danger: #e5484d; --tk-radius-md: 8px; --tk-radius-lg: 14px; --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace; }
    [data-theme="light"] { --tk-bg: #ffffff; --tk-surface: #f5f5f5; --tk-surface-2: #ececec; --tk-border: rgba(0,0,0,.10); --tk-border-hi: rgba(0,0,0,.18); --tk-text: #1a1a1a; --tk-muted: #666666; --tk-muted-2: rgba(0,0,0,.4); --tk-accent: #111111; --tk-on-accent: #ffffff; --tk-warning: #b86400; --tk-danger: #c93439; --tk-radius-md: 8px; --tk-radius-lg: 14px; --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace; }
    .wrap { height: 112px; width: 100%; padding: 3px 2px; overflow: hidden; background: var(--tk-bg); color: var(--tk-text); font-family: var(--tk-font); }
    /* Keep the compact gauges centered in the same 112px canvas used by the
       expanded detail.  This prevents them jumping to the top on return. */
    .row { display: grid; height: 100%; grid-template-columns: repeat(4, minmax(0, 1fr)); align-items: center; gap: 4px; width: 100%; }
    .gauge { display: flex; flex-direction: column; align-items: center; gap: 1px; min-width: 0; margin: -7px -3px; padding: 7px 3px; border: 0; border-radius: var(--tk-radius-md); background: transparent; color: inherit; cursor: pointer; }
    .gauge:hover, .gauge:focus-visible { background: color-mix(in srgb, var(--tk-surface-2) 94%, var(--tk-bg)); outline: none; }
    .gauge svg { display: block; width: 100%; height: auto; max-width: 40px; }
    .gauge circle { transition: stroke-dashoffset 250ms ease-out, stroke 200ms ease-out; }
    .gauge-pct { font: 700 9px var(--tk-mono); fill: var(--tk-text); }
    .gauge-label { color: var(--tk-muted); font-size: 7.5px; font-weight: 600; letter-spacing: .06em; }
    .gauge-value { max-width: 100%; overflow: hidden; color: var(--tk-muted); text-overflow: ellipsis; white-space: nowrap; font: 500 8px var(--tk-mono); }
    .detail { height: 100%; padding: 1px 4px; }
    .detail-head { display: grid; grid-template-columns: 58px 1fr auto; align-items: center; gap: 5px; height: 20px; }
    .back { display: inline-flex; align-items: center; gap: 2px; padding: 1px 3px; border: 0; border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-muted); font: 500 9px var(--tk-font); cursor: pointer; }
    .back:hover, .back:focus-visible { color: var(--tk-text); background: var(--tk-surface-2); outline: none; }
    .back svg { width: 12px; height: 12px; }
    .detail-mode { color: var(--tk-muted); font-size: 9px; font-weight: 600; letter-spacing: .06em; }
    .detail-head strong { white-space: nowrap; font: 700 9px var(--tk-mono); }
    .chart { display: block; width: 100%; height: 62px; margin-top: 3px; overflow: visible; }
    .empty-chart { fill: var(--tk-muted); font: 10px var(--tk-font); }
    .detail-caption { margin: 1px 0 0; overflow: hidden; color: var(--tk-muted); text-align: center; text-overflow: ellipsis; white-space: nowrap; font: 8px var(--tk-mono); }
</style>
