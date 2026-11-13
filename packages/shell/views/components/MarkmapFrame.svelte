<script>
    /**
     * MarkmapFrame — Renderiza markdown como mapa mental (mindmap) interativo
     * * @prop {string} source — markdown com headings (# ## ###) que vira o mindmap
     */
    import { onMount, onDestroy, tick } from 'svelte';
    import { Transformer } from 'markmap-lib';
    import { Markmap } from 'markmap-view';

    export let source = '';

    let containerEl;
    let svgEl;
    let mm = null;
    let state = 'loading'; // 'loading' | 'ready' | 'error' | 'empty'
    let errorMsg = '';
    
    // Contador para evitar condições de corrida em chamadas assíncronas
    let renderId = 0; 

    onMount(async () => {
        // Aguarda o DOM estar pronto
        await tick();
        
        // Verifica se o SVG está disponível
        if (!svgEl) {
            console.error('Markmap: SVG element not found');
            state = 'error';
            errorMsg = 'SVG element was not found in the DOM';
            // Não chamamos initMarkmap() aqui. O bloco reativo assumirá o controle.
        }
    });

    onDestroy(() => {
        destroyMarkmap();
    });

    function destroyMarkmap() {
        if (mm) {
            try { 
                mm.destroy(); 
            } catch(e) { 
                console.error('Error destroying markmap:', e);
            }
            mm = null;
        }
    }

    async function initMarkmap() {
        if (!source || !source.trim()) {
            state = 'empty';
            return;
        }

        // Incrementa o ID da renderização atual
        const currentRenderId = ++renderId;

        try {
            state = 'loading';
            
            destroyMarkmap();
            
            const transformer = new Transformer();
            const { root } = transformer.transform(source);

            if (!root || !root.children || root.children.length === 0) {
                state = 'empty';
                return;
            }

            if (svgEl) {
                svgEl.innerHTML = '';
                
                await tick();
                await new Promise(resolve => requestAnimationFrame(resolve));
                await new Promise(resolve => setTimeout(resolve, 50));

                // VERIFICAÇÃO CRÍTICA: Se o renderId mudou enquanto esperávamos, 
                // significa que uma nova renderização foi solicitada. Abortamos esta.
                if (currentRenderId !== renderId) return;

                // Cria o markmap com segurança
                mm = Markmap.create(svgEl, {
                    autoFit: true,
                    colorFreezeLevel: 2,
                    duration: 500,
                    fitRatio: 0.95,
                    maxWidth: 300,
                    nodeMinHeight: 16,
                    pan: true,
                    spacingHorizontal: 80,
                    spacingVertical: 8,
                    zoom: true,
                }, root);

                setTimeout(() => {
                    // Verifica novamente se a instância ainda é a válida antes de tentar ajustar
                    if (currentRenderId === renderId && mm && mm.fit) {
                        mm.fit();
                    }
                }, 300);

                state = 'ready';
            }
        } catch (e) {
            // Garante que o erro pertence a esta tentativa de renderização
            if (currentRenderId === renderId) {
                console.error('Markmap error:', e);
                state = 'error';
                errorMsg = e.message || 'Failed to render mind map';
            }
        }
    }

    // O bloco reativo é agora a ÚNICA fonte de acionamento do initMarkmap
    $: if (source && svgEl) {
        initMarkmap();
    }
</script>

<div class="mm-frame" 
     class:ready={state === 'ready'} 
     class:error={state === 'error'} 
     class:empty={state === 'empty'}
     bind:this={containerEl}>
    
    {#if state === 'loading'}
        <div class="mm-status">
            <div class="mm-spinner"></div>
            <span class="mm-status-label">Renderizando mindmap…</span>
        </div>
    {:else if state === 'empty'}
        <div class="mm-status">
            <span class="mm-status-label">Fonte vazia para mindmap</span>
        </div>
    {:else if state === 'error'}
        <div class="mm-status error">
            <svg viewBox="0 0 16 16" fill="none" width="14" height="14" class="mm-error-icon">
                <circle cx="8" cy="8" r="7" stroke="currentColor" stroke-width="1.2"/>
                <path d="M8 4.5v4M8 11v.01" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
            </svg>
            <div class="mm-error-body">
                <span class="mm-error-title">Mind map error</span>
                <code class="mm-error-msg">{errorMsg}</code>
            </div>
        </div>
    {/if}
    
    <!-- SVG sempre presente no DOM, mas escondido quando não está pronto -->
    <div class="mm-content" class:hidden={state !== 'ready'}>
        <!-- <div class="mm-toolbar">
            <span class="mm-badge">Mindmap</span>
            <span class="mm-hint">• Arraste para navegar • Scroll para zoom</span>
        </div> -->
        <div class="mm-svg-wrap">
            <svg bind:this={svgEl} class="mm-svg" xmlns="http://www.w3.org/2000/svg"></svg>
        </div>
    </div>
</div>

<style>
    .mm-frame {
        width: 100%;
        border-radius: var(--r-lg, 12px);
        border: 1px solid var(--border, var(--w08, rgba(255,255,255,0.08)));
        background: var(--surface, rgba(0,0,0,0.2));
        overflow: hidden;
        margin: 10px 0;
        transition: border-color 0.15s;
        min-height: 60px;
    }
    .mm-frame.ready {
        border-color: var(--w15, rgba(255,255,255,0.15));
    }
    .mm-frame.error {
        border-color: rgba(255,100,100,0.3);
        background: rgba(255,100,100,0.05);
    }
    .mm-frame.empty {
        border-color: var(--w05, rgba(255,255,255,0.05));
        opacity: 0.6;
    }

    .mm-content {
        transition: opacity 0.2s;
    }
    .mm-content.hidden {
        display: none;
    }

    .mm-status {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 16px 18px;
        color: var(--txt-2, var(--w60, rgba(255,255,255,0.6)));
    }
    .mm-status.error {
        flex-direction: column;
        align-items: flex-start;
        gap: 8px;
    }

    .mm-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid var(--w08, rgba(255,255,255,0.08));
        border-top-color: var(--w50, rgba(255,255,255,0.5));
        animation: mm-spin 0.7s linear infinite;
        flex-shrink: 0;
    }
    @keyframes mm-spin { 
        to { transform: rotate(360deg); } 
    }

    .mm-status-label {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        letter-spacing: 0.04em;
    }

    .mm-error-icon {
        flex-shrink: 0;
        color: rgba(255,100,100,0.7);
    }
    .mm-error-body {
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    .mm-error-title {
        font-family: var(--font-mono, monospace);
        font-size: 10px;
        font-weight: 600;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: rgba(255,100,100,0.8);
    }
    .mm-error-msg {
        font-family: var(--font-mono, monospace);
        font-size: 11px;
        color: var(--txt-3, var(--w40, rgba(255,255,255,0.4)));
        line-height: 1.5;
        white-space: pre-wrap;
        word-break: break-word;
        background: rgba(0,0,0,0.3);
        border: 1px solid var(--border, var(--w08, rgba(255,255,255,0.08)));
        border-radius: 6px;
        padding: 8px 10px;
        max-height: 120px;
        overflow-y: auto;
    }

    .mm-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 8px 14px;
        background: var(--w02, rgba(255,255,255,0.02));
        border-bottom: 1px solid var(--border, var(--w08, rgba(255,255,255,0.08)));
    }
    .mm-badge {
        font-family: var(--font-mono, monospace);
        font-size: 9px;
        font-weight: 600;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--txt-2, var(--w60, rgba(255,255,255,0.6)));
        background: var(--w05, rgba(255,255,255,0.05));
        border: 1px solid var(--border, var(--w08, rgba(255,255,255,0.08)));
        border-radius: 4px;
        padding: 2px 7px;
    }
    .mm-hint {
        font-family: var(--font-mono, monospace);
        font-size: 9px;
        color: var(--txt-3, var(--w40, rgba(255,255,255,0.4)));
        letter-spacing: 0.03em;
    }

    .mm-svg-wrap {
        overflow: hidden;
        min-height: 350px;
        max-height: 500px;
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        background: rgba(0,0,0,0.15);
    }
    .mm-svg {
        width: 100%;
        height: 100%;
        min-height: 350px;
    }
    
    /* Estilos para o markmap */
    :global(.mm-svg-wrap svg) {
        display: block;
        width: 100%;
        height: 100%;
    }
    :global(.markmap-node) {
        cursor: pointer;
    }
    :global(.markmap-node-circle) {
        fill: var(--w20, rgba(255,255,255,0.2));
        stroke: var(--w30, rgba(255,255,255,0.3));
        stroke-width: 1.5;
    }
    :global(.markmap-link) {
        stroke: var(--w15, rgba(255,255,255,0.15));
        stroke-width: 1.5;
        fill: none;
    }
    :global(.markmap-foreign) {
        font-family: var(--font-body, sans-serif);
        font-size: 13px;
        color: var(--txt, white);
    }
</style>
