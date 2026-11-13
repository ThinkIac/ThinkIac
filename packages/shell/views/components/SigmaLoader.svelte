<script>
    // Réplica do indicador de loading do app mobile (Flutter): o Σ se
    // preenche de baixo pra cima e depois desaparece, em loop contínuo.
    // Frações e timing espelham `_SplashScreenState`/`_SigmaLoadingIndicator`
    // em apps/mobile/lib/main.dart (fill 0→72%, plateau até 78%, fade até 100%).
    export let size = 70;
    export let color = "currentColor";
    export let variant = "fill"; // "fill" | "wave"
    export let loop = true;
</script>

{#if variant === "wave"}
    <span class="sigma-wave" style="--sigma-size: {size}px; --sigma-color: {color};" role="status" aria-label="Processando">
        <span aria-hidden="true">Σ</span><span aria-hidden="true">Σ</span><span aria-hidden="true">Σ</span>
    </span>
{:else}
    <span
        class="sigma-loader"
        style="--sigma-size: {size}px; --sigma-color: {color}; --sigma-iterations: {loop ? 'infinite' : 1};"
        role="status"
        aria-label="Loading"
    >
        <span class="sigma-loader__glyph sigma-loader__glyph--track" aria-hidden="true">Σ</span>
        <span class="sigma-loader__glyph sigma-loader__glyph--fill" aria-hidden="true">Σ</span>
    </span>
{/if}

<style>
    .sigma-loader {
        display: inline-grid;
        place-items: center;
        width: var(--sigma-size);
        height: var(--sigma-size);
        animation: sigma-loader-fade 1800ms linear var(--sigma-iterations);
    }
    .sigma-loader__glyph {
        grid-area: 1 / 1;
        font-size: var(--sigma-size);
        line-height: 1;
        font-weight: 600;
        /* Ubuntu explícito, como o resto do Σ da marca (Sidebar, SlateIcon):
           herdar a fonte do contexto fazia o glifo mudar de desenho conforme
           onde o loader fosse usado. */
        font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
        color: var(--sigma-color);
    }
    .sigma-loader__glyph--track {
        opacity: 0.2;
    }
    .sigma-loader__glyph--fill {
        animation: sigma-loader-fill 1800ms linear var(--sigma-iterations);
    }
    .sigma-wave {
        display: inline-flex;
        align-items: center;
        gap: 1px;
        height: var(--sigma-size);
        color: var(--sigma-color);
        font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
        font-size: var(--sigma-size);
        font-weight: 600;
        line-height: 1;
    }
    .sigma-wave span { display: inline-block; animation: sigma-wave 900ms ease-out infinite; }
    .sigma-wave span:nth-child(2) { animation-delay: 120ms; }
    .sigma-wave span:nth-child(3) { animation-delay: 240ms; }
    @keyframes sigma-wave {
        0%, 100% { opacity: 0.26; transform: translateY(0); }
        45% { opacity: 1; transform: translateY(-2px); }
    }
    @keyframes sigma-loader-fade {
        0% { opacity: 0; }
        8% { opacity: 1; }
        78% { opacity: 1; }
        100% { opacity: 0; }
    }
    @keyframes sigma-loader-fill {
        0% { clip-path: inset(100% 0 0 0); }
        72% { clip-path: inset(0% 0 0 0); }
        100% { clip-path: inset(0% 0 0 0); }
    }

    /* Quem pede menos movimento continua precisando saber que ALGO está
       acontecendo — este é um indicador de estado, não enfeite. Trocamos o
       preenchimento em loop por uma pulsação lenta de opacidade: sinal de
       "vivo" preservado, sem o movimento contínuo. */
    @media (prefers-reduced-motion: reduce) {
        .sigma-loader {
            animation: sigma-loader-pulse 2400ms ease-in-out infinite;
        }
        .sigma-loader__glyph--fill {
            animation: none;
            clip-path: none;
        }
        .sigma-loader__glyph--track {
            opacity: 0;
        }
        .sigma-wave span { animation: none; opacity: 0.72; }
        @keyframes sigma-loader-pulse {
            0%, 100% { opacity: 0.45; }
            50%      { opacity: 1; }
        }
    }
</style>
