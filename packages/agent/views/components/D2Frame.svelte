<script>
    /**
     * D2Frame — Renderiza diagramas D2 como SVG interativo
     *
     * @prop {string} source — código fonte D2 puro (sem delimitadores)
     */
    import { onMount, createEventDispatcher } from "svelte";

    export let source = "";

    const dispatch = createEventDispatcher();

    let state = "loading"; // 'loading' | 'ready' | 'error'
    let svgContent = "";
    let errorMsg = "";
    let containerEl;

    onMount(async () => {
        if (!source.trim()) {
            state = "error";
            errorMsg = "Fonte D2 vazia";
            return;
        }

        try {
            const res = await fetch("/agent/d2/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source, layout: "dagre" }),
            });

            const data = await res.json();

            if (!res.ok || data.error) {
                state = "error";
                errorMsg = data.detail || data.error || "Erro ao renderizar D2";
                return;
            }

            svgContent = data.svg;
            state = "ready";

            dispatch("rendered", { success: true });
        } catch (e) {
            state = "error";
            errorMsg = e.message || "Falha na comunicação com o servidor";
        }
    });

    function processSvg(svg) {
        if (!svg) return "";

        let processed = svg.replace(/<\?xml[^>]*\?>/i, "");

        processed = processed.replace(/(<svg[^>]*?)\s+width=(['"])[^'"]*\2/i, "$1");
        processed = processed.replace(/(<svg[^>]*?)\s+height=(['"])[^'"]*\2/i, "$1");

        if (!processed.includes("viewBox")) {
            processed = processed.replace("<svg", '<svg viewBox="0 0 800 600"');
        }

        return processed;
    }

    $: processedSvg = processSvg(svgContent);
</script>

<div
    class="d2-frame"
    class:ready={state === "ready"}
    class:error={state === "error"}
    bind:this={containerEl}
>
    {#if state === "loading"}
        <div class="d2-status">
            <div class="d2-spinner"></div>
            <span class="d2-status-label">Renderizando diagrama D2…</span>
        </div>
    {:else if state === "error"}
        <div class="d2-status error">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14" class="d2-error-icon">
                <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
                <path d="M8 4.5v4M8 11v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
            <div class="d2-error-body">
                <span class="d2-error-title">Erro no diagrama D2</span>
                <code class="d2-error-msg">{errorMsg}</code>
            </div>
        </div>
    {:else}
        <div class="d2-svg-wrap">
            {@html processedSvg}
        </div>
    {/if}
</div>

<style>
    .d2-frame {
        width: 100%;
        border-radius: var(--r-lg);
        border: 1px solid var(--border);
        background: var(--surface);
        overflow: hidden; /* Crucial: garante o recorte do SVG nas curvas */
        margin: 10px 0;
        transition: border-color 0.15s;
    }
    .d2-frame.ready {
        border-color: var(--w10, rgba(255, 255, 255, 0.1));
    }
    .d2-frame.error {
        border-color: rgba(255, 100, 100, 0.2);
        background: rgba(255, 100, 100, 0.03);
    }

    .d2-status {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px;
        color: var(--txt-2);
    }
    .d2-status.error {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }

    .d2-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid var(--w08, rgba(255, 255, 255, 0.08));
        border-top-color: var(--w50, rgba(255, 255, 255, 0.5));
        animation: d2-spin 0.7s linear infinite;
        flex-shrink: 0;
    }
    @keyframes d2-spin {
        to { transform: rotate(360deg); }
    }

    .d2-status-label {
        font-family: var(--font-mono);
        font-size: 11px;
        letter-spacing: 0.04em;
    }

    .d2-error-icon {
        flex-shrink: 0;
        color: rgba(255, 100, 100, 0.7);
    }
    .d2-error-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .d2-error-title {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255, 100, 100, 0.8);
    }
    .d2-error-msg {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-3);
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(0, 0, 0, 0.3);
        border: 1px solid var(--border);
        border-radius: 6px;
        padding: 8px 10px;
        max-height: 120px;
        overflow-y: auto;
    }

    /* ALTERADO: Removeu-se o padding para o SVG tocar os limites do container */
    .d2-svg-wrap {
        padding: 0; 
        width: 100%;
        display: flex;
        flex-direction: column;
    }
    
    /* ALTERADO: Força o SVG a ocupar 100% do box e herdar o recorte arredondado */
    .d2-svg-wrap :global(svg) {
        width: 100%;
        height: auto;
        display: block; /* Remove o espaçamento fantasma inferior de elementos inline */
    }
    
    .d2-svg-wrap :global(.d2-svg) {
        display: block;
    }
</style>