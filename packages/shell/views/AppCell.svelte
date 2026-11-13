<script>
  // AppCell — apresentação de um app na lista do menu.
  import { createEventDispatcher } from 'svelte';

  export let app = { id: '', name: 'App' };
  export let isLauncher = false;
  export let theme = 'dark';
  export let layout = 'list';
  export let showFavorite = false;
  export let favorite = false;

  const dispatch = createEventDispatcher();

  $: isList = isLauncher && layout === 'list';
  $: isCompactGrid = isLauncher && layout === 'compact';

  $: cellBtnCls = isList
    ? 'flex-row items-center justify-start gap-2 py-1.5 px-1.5 rounded-[9px]'
    : isLauncher
      ? (isCompactGrid ? 'pt-2 pb-1 px-0.5 gap-1.5 rounded-[12px]' : 'pt-2.5 pb-1.5 px-0.5 gap-2 rounded-[14px]')
      : 'pt-3 pb-2.5 px-1 gap-1.5 rounded-[12px]';
  $: iconBoxCls = isList
    ? 'w-8 h-8 rounded-[9px]'
    : isLauncher
      ? (isCompactGrid ? 'w-8 h-8 rounded-[9px]' : 'w-11 h-11 rounded-[13px]')
      : 'w-8 h-8 rounded-[9px]';
  $: iconTxtCls = isLauncher ? 'text-[17px]' : 'text-[16px]';
  $: nameTxtCls = isList
    ? 'text-[12px] text-[var(--rail-txt-2)] leading-snug text-left flex-1'
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

    const pad = clampPadding(a.padding ?? 6);
    if (pad !== null) p.push(`padding:${pad}px`);
    if (a.noBorder) p.push('border:none');
    return p.join(';');
  }

  function handleClick() {
    // O card principal é a ação de navegação do Widget de Menu. Informações
    // do pacote só podem ser abertas pelo controle explícito do Shell, para
    // que tocar num app sempre abra ou foque sua aba.
    dispatch('open');
  }
  function handleHomeShortcut(e) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('homeShortcut');
  }
  function handleFavorite(e) {
    e.stopPropagation();
    e.preventDefault();
    dispatch('favorite');
  }
</script>

<div
  class="relative min-w-0"
  role="gridcell"
>
  <button
    class="group relative flex {cellBtnCls} w-full bg-transparent border-none cursor-pointer text-inherit transition-all duration-150 min-w-0 [-webkit-tap-highlight-color:transparent] {isList ? '' : 'flex-col items-center justify-start'} {showFavorite && isList ? 'pr-8' : ''}"
    style="background: transparent;"
    on:click={handleClick}
    title={app.name}
  >
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
    </div>

    <!-- Nome -->
    <span class="{nameTxtCls} {isList ? 'truncate' : 'w-full text-center tracking-[0.01em] overflow-hidden whitespace-nowrap text-ellipsis max-w-full block'} transition-colors duration-150 pointer-events-none">
      {app.name}
    </span>
  </button>
  {#if showFavorite}
    <button
      class="favorite-button"
      class:list-favorite={isList}
      class:grid-favorite={isLauncher && layout === 'grid'}
      class:is-favorite={favorite}
      on:click={handleFavorite}
      aria-pressed={favorite}
      aria-label={favorite ? `Remove ${app.name} from favorites` : `Add ${app.name} to favorites`}
      title={favorite ? 'Remove from favorites' : 'Add to favorites'}
    >
      <svg viewBox="0 0 20 20" width="14" height="14" aria-hidden="true">
        <path d="M10 2.4l2.22 4.5 4.96.72-3.59 3.5.85 4.94L10 13.72l-4.44 2.34.85-4.94-3.59-3.5 4.96-.72L10 2.4z"/>
      </svg>
    </button>
  {/if}
</div>

<style>
  .app-icon-box {
    box-shadow: var(--rail-shadow-rest);
    transition: transform 0.16s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.16s ease, border-color 0.16s;
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

  .favorite-button {
    position: absolute;
    z-index: 20;
    top: 2px;
    right: 2px;
    display: flex;
    align-items: center;
    justify-content: center;
    width: 24px;
    height: 24px;
    padding: 0;
    border: 0;
    border-radius: 7px;
    background: transparent;
    color: var(--rail-txt-3);
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
    transition: color 0.2s ease-out, background 0.2s ease-out, opacity 0.2s ease-out;
  }
  .favorite-button.list-favorite { top: 50%; transform: translateY(-50%); }
  .favorite-button.grid-favorite { top: -3px; }
  .favorite-button svg { fill: transparent; stroke: currentColor; stroke-width: 1.35; stroke-linejoin: round; }
  .favorite-button:hover, .favorite-button:focus-visible { color: var(--rail-txt); background: var(--rail-flat); outline: none; }
  .favorite-button.is-favorite { color: var(--rail-txt); }
  .favorite-button.is-favorite svg { fill: currentColor; }

</style>
