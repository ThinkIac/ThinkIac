<script>
    /**
     * D2Frame — Renderiza diagramas D2 como SVG interativo
     *
     * @prop {string} source — código fonte D2 puro (sem delimitadores)
     */
    import { onDestroy, tick, createEventDispatcher } from "svelte";
    import * as agentRuntime from "../agents/runtime.js";

    export let source = "";

    const dispatch = createEventDispatcher();

    let state = "loading"; // 'loading' | 'ready' | 'error'
    let svgContent = "";
    let errorMsg = "";
    let containerEl;
    let svgWrapEl;
    let renderId = 0;
    let controller = null;

    // O SVG é recompilado quando a fonte muda e continua navegável depois de
    // pronto. O viewBox preserva a nitidez em qualquer nível de zoom.
    let scale = 1;
    let translateX = 0;
    let translateY = 0;
    let dragging = false;
    let dragStartX = 0;
    let dragStartY = 0;
    const MIN_SCALE = 0.2;
    const MAX_SCALE = 5;

    onDestroy(() => controller?.abort());

    function clampScale(value) {
        return Math.min(MAX_SCALE, Math.max(MIN_SCALE, value));
    }

    async function renderSource(nextSource) {
        const currentRenderId = ++renderId;
        controller?.abort();
        controller = null;

        if (!nextSource?.trim()) {
            state = "error";
            errorMsg = "Fonte D2 vazia";
            return;
        }

        state = "loading";
        errorMsg = "";
        const nextController = new AbortController();
        controller = nextController;

        try {
            const res = await agentRuntime.request("/d2/render", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ source: nextSource, layout: "dagre" }),
                signal: nextController.signal,
            });

            const data = await res.json();

            // Uma resposta lenta de uma versão anterior não pode substituir
            // o diagrama correspondente ao conteúdo mais recente.
            if (currentRenderId !== renderId) return;

            if (!res.ok || data.error) {
                state = "error";
                errorMsg = data.detail || data.error || "Failed to render D2";
                return;
            }

            svgContent = data.svg;
            state = "ready";
            await tick();
            if (currentRenderId === renderId) fitToView();

            dispatch("rendered", { success: true });
        } catch (e) {
            if (e.name === "AbortError" || currentRenderId !== renderId) return;
            state = "error";
            errorMsg = e.message || "Communication with the server failed";
        }
    }

    // Atualiza tanto no carregamento quanto durante streaming ou edição.
    $: if (source !== undefined) renderSource(source);

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

    function svgDimensions() {
        const svg = svgWrapEl?.querySelector("svg");
        const parts = svg?.getAttribute("viewBox")?.trim().split(/[\s,]+/).map(Number);
        if (parts?.length === 4 && parts[2] > 0 && parts[3] > 0) {
            return { width: parts[2], height: parts[3] };
        }
        return { width: svg?.getBBox?.().width || 800, height: svg?.getBBox?.().height || 600 };
    }

    function fitToView() {
        if (!containerEl || !svgWrapEl) return;
        const { width, height } = svgDimensions();
        const availableWidth = containerEl.clientWidth;
        const availableHeight = Math.max(260, Math.min(availableWidth * 0.7, 560));
        scale = Math.min(availableWidth / width, availableHeight / height, 1);
        translateX = (availableWidth - width * scale) / 2;
        translateY = (availableHeight - height * scale) / 2;
    }

    function zoomAt(clientX, clientY, nextScale) {
        if (!containerEl) return;
        const rect = containerEl.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        const ratio = nextScale / scale;
        translateX = x - (x - translateX) * ratio;
        translateY = y - (y - translateY) * ratio;
        scale = nextScale;
    }

    function handleWheel(event) {
        event.preventDefault();
        zoomAt(event.clientX, event.clientY, clampScale(scale * (event.deltaY > 0 ? 0.9 : 1.1)));
    }

    function handlePointerDown(event) {
        if (event.button !== 0) return;
        dragging = true;
        dragStartX = event.clientX - translateX;
        dragStartY = event.clientY - translateY;
        containerEl?.setPointerCapture?.(event.pointerId);
    }

    function handlePointerMove(event) {
        if (!dragging) return;
        translateX = event.clientX - dragStartX;
        translateY = event.clientY - dragStartY;
    }

    function handlePointerUp(event) {
        dragging = false;
        containerEl?.releasePointerCapture?.(event.pointerId);
    }
</script>

<div
    class="d2-frame"
    class:ready={state === "ready"}
    class:error={state === "error"}
    bind:this={containerEl}
    on:wheel|preventDefault={handleWheel}
    on:pointerdown={handlePointerDown}
    on:pointermove={handlePointerMove}
    on:pointerup={handlePointerUp}
    on:pointercancel={handlePointerUp}
    on:dblclick={fitToView}
>
    {#if state === "loading"}
        <div class="d2-status">
            <div class="d2-spinner"></div>
            <span class="d2-status-label">Rendering D2 diagram…</span>
        </div>
    {:else if state === "error"}
        <div class="d2-status error">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14" class="d2-error-icon">
                <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2" />
                <path d="M8 4.5v4M8 11v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" />
            </svg>
            <div class="d2-error-body">
                <span class="d2-error-title">D2 diagram error</span>
                <code class="d2-error-msg">{errorMsg}</code>
            </div>
        </div>
    {:else}
        <div class="d2-viewport">
            <div class="d2-svg-wrap" bind:this={svgWrapEl} style:transform={`translate(${translateX}px, ${translateY}px) scale(${scale})`}>
                {@html processedSvg}
            </div>
        </div>
    {/if}
</div>

<style>
    .d2-frame {
        width: 100%;
        border-radius: var(--r-lg);
        border: 1px solid var(--border);
        background: var(--surface);
        overflow: hidden;
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

    .d2-viewport {
        height: clamp(260px, 45vw, 560px);
        overflow: hidden;
        cursor: grab;
        touch-action: none;
    }
    .d2-viewport:active { cursor: grabbing; }

    .d2-svg-wrap {
        width: max-content;
        transform-origin: 0 0;
        will-change: transform;
    }
    
    /* ALTERADO: Força o SVG a ocupar 100% do box e herdar o recorte arredondado */
    .d2-svg-wrap :global(svg) {
        width: auto;
        height: auto;
        display: block;
    }
    
    .d2-svg-wrap :global(.d2-svg) {
        display: block;
    }
</style>
