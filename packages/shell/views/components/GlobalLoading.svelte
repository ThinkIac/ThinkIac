<script>
    import SigmaLoader from "./SigmaLoader.svelte";

    export let active = false;
</script>

{#if active}
    <div class="global-loading" role="status" aria-live="polite" aria-busy="true">
        <SigmaLoader />
    </div>
{/if}

<style>
    .global-loading {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: grid;
        place-items: center;
        min-height: 100dvh;
        padding: 24px;
        /* O loading é uma transição de estado, não um véu sobre a cena.
           Manter o fundo opaco evita que a camada visual abaixo dê a ele
           um tom azulado e preserva fielmente o tema selecionado. */
        background: var(--bg);
        color: var(--txt, #f5f5f5);
        font-family: var(--font-body);
        backdrop-filter: blur(14px);
    }
</style>
