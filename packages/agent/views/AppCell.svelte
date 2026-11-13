<script>
  // AppCell — um app no grid (lista solta, dentro de pasta, ou dock compact).
  // Puramente apresentacional: o drag&drop (reordenar, criar pasta, soltar em
  // pasta) vive no Apps.svelte, que escuta o `pointerdown` encaminhado aqui.
  import { createEventDispatcher } from 'svelte';

  export let app = { id: '', name: 'App' };
  export let isLauncher = false;
  export let isPinned = false;
  export let theme = 'dark';
  export let editMode = false;   // "jiggle mode" — habilita arrastar, some o open
  export let dragging = false;   // este cell é o que está sendo arrastado agora
  export let folding = false;    // alvo de "soltar aqui pra criar pasta" (anel)
  export let layout = 'grid';    // 'grid' | 'compact' | 'list' (só no launcher)
  export let pinPos = 'top-1 right-1'; // posição do favorito (na pasta vai pro canto)

  const dispatch = createEventDispatcher();

  $: isList = isLauncher && layout === 'list';
  $: isCompactGrid = isLauncher && layout === 'compact';

  $: cellBtnCls = isList
    ? 'flex-row items-center justify-start gap-3 py-2 px-2 rounded-[12px]'
    : isLauncher
      ? (isCompactGrid ? 'pt-2 pb-1 px-0.5 gap-1.5 rounded-[12px]' : 'pt-2.5 pb-1.5 px-0.5 gap-2 rounded-[14px]')
      : 'pt-3 pb-2.5 px-1 gap-1.5 rounded-[12px]';
  $: iconBoxCls = isList
    ? 'w-9 h-9 rounded-[11px]'
    : isLauncher
      ? (isCompactGrid ? 'w-8 h-8 rounded-[9px]' : 'w-11 h-11 rounded-[13px]')
      : 'w-8 h-8 rounded-[9px]';
  $: iconTxtCls = isLauncher ? 'text-[17px]' : 'text-[16px]';
  $: nameTxtCls = isList
    ? 'text-[13px] text-[var(--rail-txt)] leading-snug text-left flex-1'
    : isLauncher
      ? 'text-[11px] text-[var(--rail-txt)] leading-snug'
      : 'text-[10px] text-[var(--rail-txt-2)] leading-tight';

  // Guarda defensiva: classe Tailwind ("bg-emerald-500") como valor de cor
  // CSS já vazou do backend antes — "verdadeiro" em JS, inválido em CSS, o
  // navegador ignora a declaração e o ícone fica sem fundo (branco no dark).
  function isRealColor(v) {
    return typeof v === 'string' && v.trim().length > 0 && !v.trim().startsWith('bg-');
  }
  function clampPadding(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(10, Math.max(0, n));
  }
  // Luminância relativa (WCAG) para escolher glifo claro ou escuro sobre a cor
  // da marca. Sem isso, um ícone de fundo claro com glifo branco some.
  function readableOn(color) {
    const hex = String(color).trim().replace('#', '');
    const full =
      hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null; // var(), rgb(), hsl(): não dá pra medir
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return L > 0.5 ? '#111111' : '#ffffff';
  }

  // O fundo do ícone usa a COR DA MARCA do pacote. `manifest.color` é o que os
  // pacotes já declaram (`#513F81` no code-editor, `#0EA5E9` no hermes) e era
  // assim que o desktop antigo pintava: a grade fica reconhecível de relance,
  // cada app com sua cor, em vez de um tabuleiro de quadrados cinzas.
  //
  // `bgColor` continua mandando quando existe (é o override explícito), e quem
  // não declara cor nenhuma cai no plano do tema, como antes.
  function iconStyle(a) {
    const p = [];
    const brand = isRealColor(a.bgColor)
      ? a.bgColor
      : isRealColor(a.color)
        ? a.color
        : null;

    p.push(`background:${brand || 'var(--rail-flat)'}`);

    // Com fundo de marca, o glifo precisa contrastar COM ELE, não com o tema.
    // Sem fundo de marca, `color` volta a ser a cor do próprio glifo.
    if (brand) {
      p.push(`color:${readableOn(brand) || 'var(--rail-txt)'}`);
      p.push('border-color:transparent');
    } else {
      p.push(`color:${isRealColor(a.color) ? a.color : 'var(--rail-txt)'}`);
    }

    const pad = clampPadding(a.padding);
    if (pad !== null) p.push(`padding:${pad}px`);
    if (a.noBorder) p.push('border:none');
    return p.join(';');
  }

  function handleClick() {
    if (editMode) return; // em edição, o toque não abre — só arrasta/edita
    dispatch('open');
  }
  function handleTogglePin(e) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('togglePin');
  }
  function handleHomeShortcut(e) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('homeShortcut');
  }
</script>

<!-- Root encaminha pointerdown pro Apps.svelte (drag). data-app-id é o alvo
     de drop detectado via elementFromPoint. -->
<div
  class="relative min-w-0"
  class:jiggle={editMode && !dragging}
  class:app-dragging={dragging}
  role="gridcell"
  data-app-id={app.id}
  data-drop="cell"
  on:pointerdown
>
  <button
    class="group relative flex {cellBtnCls} w-full bg-transparent border-none cursor-pointer text-inherit transition-all duration-150 min-w-0 [-webkit-tap-highlight-color:transparent] {isList ? '' : 'flex-col items-center justify-start'}"
    style="background: transparent; {editMode ? 'touch-action:none;' : ''}"
    on:click={handleClick}
    title={app.name}
  >
    <!-- Favorito: botão circular (mesmo estilo do "remover" da pasta). A área
         de clique = o círculo (20px), então não dispara ao tocar fora dele. -->
    <span
      class="absolute {pinPos} z-10 w-5 h-5 flex items-center justify-center rounded-full [-webkit-tap-highlight-color:transparent] touch-manipulation transition-opacity duration-150 {isPinned ? 'opacity-100' : 'opacity-50 group-hover:opacity-100 focus-within:opacity-100'} {isList ? 'hidden' : ''}"
      style="background: var(--rail-flat); border: 0.5px solid var(--rail-border); color: {isPinned ? 'var(--rail-txt)' : 'var(--rail-txt-2)'};"
      role="button"
      tabindex={0}
      aria-label={isPinned ? 'Unpin' : 'Pin'}
      aria-pressed={isPinned}
      on:click={handleTogglePin}
      on:keydown={(e) => e.key === 'Enter' && handleTogglePin(e)}
    >
      <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" aria-hidden="true" class="block">
        <g transform="translate(5,5)">
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(0)"/>
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(60)"/>
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(120)"/>
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(180)"/>
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(240)"/>
          <rect x="-0.85" y="-4.2" width="1.7" height="4.2" rx="0.85" transform="rotate(300)"/>
        </g>
      </svg>
    </span>

    <!-- Atalho p/ tela inicial (só no APK; badge inferior-direito) -->
    {#if app.homeShortcut}
      <span
        class="absolute bottom-0 right-0 z-10 w-[30px] h-[30px] pb-[3px] pr-[3px] flex items-end justify-end rounded-[11px_0_11px_0] [-webkit-tap-highlight-color:transparent] touch-manipulation opacity-[0.42] transition-opacity duration-150 group-hover:opacity-100 {isList ? 'hidden' : ''}"
        role="button"
        tabindex={0}
        aria-label="Add {app.name} to home screen"
        on:click={handleHomeShortcut}
        on:keydown={(e) => e.key === 'Enter' && handleHomeShortcut(e)}
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="color: var(--rail-txt);">
          <rect x="4" y="4" width="16" height="16" rx="2"/>
          <path d="M12 8v8M8 12h8"/>
        </svg>
      </span>
    {/if}

    <!-- Ícone -->
    <div
      class="app-icon-box {iconBoxCls} shrink-0 overflow-hidden flex items-center justify-center font-semibold leading-none pointer-events-none"
      class:folding-target={folding}
      style="border: 0.5px solid var(--rail-border); {iconStyle(app)}"
    >
      {#if theme === 'dark' && app.iconDarkSvg}
        <span class="app-icon-svg">{@html app.iconDarkSvg}</span>
      {:else if theme === 'dark' && app.iconDark}
        <img src={app.iconDark} alt={app.name} class="w-full h-full object-cover" draggable="false" />
      {:else if app.iconSvg}
        <span class="app-icon-svg">{@html app.iconSvg}</span>
      {:else if app.icon}
        <img src={app.icon} alt={app.name} class="w-full h-full object-cover" draggable="false" />
      {:else if app.name === 'Agent'}
        <span class="app-icon-sigma" style="font-size: 15px">Σ</span>
      {:else}
        <span class={iconTxtCls}>{app.name[0].toUpperCase()}</span>
      {/if}
      {#if !app.public}
        <span class="access-lock" title="Acesso restrito" aria-hidden="true">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="5" y="11" width="14" height="9" rx="1"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/></svg>
        </span>
      {/if}
    </div>

    <!-- Nome -->
    <span class="{nameTxtCls} {isList ? 'truncate' : 'w-full text-center tracking-[0.01em] overflow-hidden whitespace-nowrap text-ellipsis max-w-full block'} transition-colors duration-150 pointer-events-none">
      {app.name}
    </span>
  </button>
</div>

<style>
  .app-icon-box {
    position: relative;
    box-shadow: var(--rail-shadow-rest);
    transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.16s ease, border-color 0.16s;
  }

  .access-lock {
    position: absolute;
    right: -3px;
    bottom: -3px;
    display: grid;
    place-items: center;
    width: 15px;
    height: 15px;
    border: 1px solid var(--rail-border);
    border-radius: 999px;
    background: var(--rail-flat);
    color: var(--rail-txt-3);
  }
  .group:hover .app-icon-box, .group:focus-visible .app-icon-box {
    transform: translateY(-2px);
    box-shadow: var(--rail-shadow-hover);
  }
  .group:active .app-icon-box { transform: translateY(0); }

  .app-icon-sigma {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: var(--tk-surface-2, #1f1f1f); color: var(--tk-text, #f5f5f5);
    font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
  }

  .app-icon-svg {
    display: flex; align-items: center; justify-content: center;
    width: 100%; height: 100%;
  }
  .app-icon-svg :global(svg) {
    width: 100%; height: 100%; display: block;
  }

  /* Jiggle sutil do modo edição (estilo macOS/iOS). */
  @keyframes jiggle {
    0%   { transform: rotate(-1deg); }
    50%  { transform: rotate(1deg); }
    100% { transform: rotate(-1deg); }
  }
  .jiggle { animation: jiggle 0.28s ease-in-out infinite; }
  .app-dragging { opacity: 0.35; }

  /* Alvo de "soltar aqui pra criar pasta": anel + leve zoom (feedback claro). */
  .folding-target {
    transform: scale(1.08);
    border-color: var(--rail-txt) !important;
    box-shadow: 0 0 0 2px var(--rail-txt);
  }
</style>
