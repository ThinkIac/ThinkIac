<script>
  // SlateIcon — o bloco "Slate" que identifica visualmente um app.
  // Mesma linguagem do ícone do AppCell (caixa arredondada, borda fina,
  // sombra de elevação), extraída para poder aparecer também na barra de
  // abas. A cascata de conteúdo é a mesma do registro de apps
  // (packages/shell/runtime/system/apps/index.js): o que o manifest do pacote
  // declarar em icon/iconDark/color/bgColor chega aqui intacto, então um
  // pacote novo ganha ícone de aba sem tocar neste componente.
  export let app = null;
  export let theme = 'dark';
  export let size = 14;        // lado da caixa, em px
  export let radius = 4;       // cantos — abas usam bem menos que o grid
  export let sigma = false;    // ignora `app` e renderiza o Σ do Agent

  function isRealColor(v) {
    return typeof v === 'string' && v.trim().length > 0 && !v.trim().startsWith('bg-');
  }

  function clampPadding(v) {
    const n = Number(v);
    if (!Number.isFinite(n)) return null;
    return Math.min(10, Math.max(0, n));
  }

  function hasLightBackground(color) {
    const hex = String(color).trim().replace('#', '');
    const full = hex.length === 3 ? hex.split('').map((c) => c + c).join('') : hex;
    if (!/^[0-9a-f]{6}$/i.test(full)) return null;
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255);
    const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    const luminance = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return luminance > 0.5;
  }

  // O manifest expressa padding na escala dos ícones da grade (mínimo 32px).
  // Nas abas ele é proporcional, preservando ao menos 4px para o conteúdo.
  function scaledPadding(v, iconSize) {
    const padding = clampPadding(v);
    if (padding === null) return null;
    return Math.min((padding * iconSize) / 32, Math.max(0, (iconSize - 5) / 2));
  }

  $: brand = isRealColor(app?.bgColor)
    ? app.bgColor
    : isRealColor(app?.color)
      ? app.color
      : null;
  // Mantém o mesmo padrão do catálogo mesmo ao restaurar uma aba antiga,
  // anterior ao campo `padding` ter sido incluído na resposta da API.
  $: padding = scaledPadding(app?.padding ?? 6, size);
  $: lightBrand = brand ? hasLightBackground(brand) : null;
  $: brandText = lightBrand === true
    ? (theme === 'dark' ? 'var(--tk-bg, var(--rail-txt))' : 'var(--tk-text, var(--rail-txt))')
    : lightBrand === false
      ? (theme === 'dark' ? 'var(--tk-text, var(--rail-txt))' : 'var(--tk-bg, var(--rail-txt))')
      : 'var(--rail-txt, var(--txt))';
  $: boxStyle = [
    `width:${size}px`,
    `height:${size}px`,
    `border-radius:${radius}px`,
    sigma ? 'background:#050505' : `background:${brand || 'var(--rail-flat, var(--w08))'}`,
    sigma
      ? 'color:#ffffff'
      : `color:${brand ? brandText : 'var(--rail-txt, var(--txt))'}`,
    !sigma && brand ? 'border-color:transparent' : '',
    !sigma && padding !== null ? `padding:${padding}px` : '',
    !sigma && app?.noBorder ? 'border:none' : '',
  ].filter(Boolean).join(';');

  $: label = app?.name || '';
</script>

<span class="slate-icon" style={boxStyle} aria-hidden="true">
  {#if sigma}
    <span class="slate-sigma" style="font-size:{Math.round(size * 0.72)}px">Σ</span>
  {:else if theme === 'dark' && app?.iconDarkSvg}
    <span class="slate-svg">{@html app.iconDarkSvg}</span>
  {:else if theme === 'dark' && app?.iconDark}
    <img src={app.iconDark} alt="" draggable="false" />
  {:else if app?.iconSvg}
    <span class="slate-svg">{@html app.iconSvg}</span>
  {:else if app?.icon}
    <img src={app.icon} alt="" draggable="false" />
  {:else if label === 'Agent'}
    <span class="slate-sigma slate-sigma-flat" style="font-size:{Math.round(size * 0.72)}px">Σ</span>
  {:else}
    <span class="slate-letter" style="font-size:{Math.round(size * 0.62)}px">{(label[0] || '·').toUpperCase()}</span>
  {/if}
</span>

<style>
  .slate-icon {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
    box-sizing: border-box;
    overflow: hidden;
    line-height: 1;
    font-weight: 600;
    border: 0.5px solid var(--rail-border, var(--w12));
    box-shadow: var(--rail-shadow-rest, 0 1px 2px rgba(0, 0, 0, 0.25));
  }
  .slate-icon img { width: 100%; height: 100%; object-fit: cover; display: block; }
  .slate-svg { display: flex; align-items: center; justify-content: center; width: 100%; height: 100%; }
  .slate-svg :global(svg) { width: 100%; height: 100%; display: block; }

  .slate-sigma {
    width: 100%; height: 100%;
    display: flex; align-items: center; justify-content: center;
    background: #050505; color: #ffffff;
    font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
    font-weight: 500; /* Ubuntu Medium */
  }
  /* Dentro de uma caixa que já tem cor própria (app "Agent" do registro),
     o Σ não deve repintar o fundo. */
  .slate-sigma-flat { background: transparent; color: inherit; }

  .slate-letter { display: block; }
</style>
