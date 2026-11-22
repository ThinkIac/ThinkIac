<script>
    import SigmaLoader from '../SigmaLoader.svelte';
    // Keep frames mounted while inactive. The composition root owns their refs
    // so reload, gestures and desktop integrations use the same DOM instances.
    export let appTabs;
    export let activeTab;
    export let isMobile;
    export let appLoadingMap;
    export let appReloadKeys;
    export let iframeRefs;
    export let applyThemeToDocument;
    export let finishAppLoad;
</script>

{#each appTabs as tab (tab.id)}
    <div class="iframe-panel" class:hidden={activeTab !== tab.id} class:with-refresh-rail={isMobile && activeTab === tab.id}>
        {#if appLoadingMap[tab.id]}
            <div class="app-loader">
                <SigmaLoader size={32} color="#fff" />
            </div>
        {/if}
        {#key appReloadKeys[tab.id] || 0}
            <iframe
                bind:this={iframeRefs[tab.id]}
                src={tab.url}
                title={tab.name}
                sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                allowfullscreen
                on:load={() => {
                    try {
                        applyThemeToDocument(iframeRefs[tab.id]?.contentDocument);
                    } catch {
                        // URLs externas podem ser cross-origin e não são tematizáveis.
                    }
                    finishAppLoad(tab.id);
                }}
                on:error={() => finishAppLoad(tab.id)}
            ></iframe>
        {/key}
    </div>
{/each}

<style>
    .iframe-panel {
        position: absolute;
        inset: 0;
        transform: translateY(0);
        transition: opacity 0.18s ease, transform 0.22s ease-out;
    }
    .iframe-panel.hidden {
        opacity: 0;
        transform: translateY(-10px);
        pointer-events: none;
    }
    .iframe-panel iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: none;
        /* Transparente (era #fff): apps temáticos pintam o próprio fundo full-bleed;
           branco fixo causava flash branco no load e gutters brancos em views
           centralizadas. */
        background: transparent;
    }
    .app-loader {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
        /* O app continua recebendo interação enquanto o iframe termina de
           iniciar. Alguns WebViews não emitem `load` para navegação em aba
           oculta; o indicador jamais pode segurar a superfície por isso. */
        pointer-events: none;
    }
</style>
