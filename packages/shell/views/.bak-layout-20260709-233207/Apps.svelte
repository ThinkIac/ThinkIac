<script>
  import { createEventDispatcher, onMount, onDestroy } from 'svelte';
  import { api } from './api';

  export let apps = [];

  const dispatch = createEventDispatcher();
  let pollingInterval;

  // userPinned = fonte de verdade (persistida)
  // stagedPinned = snapshot usado para ordenar; só atualiza ao mudar de página
  let userPinned  = [];
  let stagedPinned = [];

  async function fetchApps() {
    try {
      const list = await api('/apps/list', 'GET', null, 'aura-system');
      let fetched = list
        .filter(a => a?.url && a?.default === true)
        .map((a, i) => ({ ...a, id: a.id || String(i) }));
      apps = fetched;
    } catch (e) {
      console.error('Erro ao atualizar apps:', e);
    }
  }

  onMount(() => {
    const saved = localStorage.getItem('aura-pinned-packages');
    if (saved) { userPinned = JSON.parse(saved); stagedPinned = [...userPinned]; }
    fetchApps();
    pollingInterval = setInterval(fetchApps, 30000);
  });

  onDestroy(() => { if (pollingInterval) clearInterval(pollingInterval); });

  function togglePin(app, e) {
    e.stopPropagation();
    e.preventDefault();
    // Muda userPinned (reatividade visual imediata do ícone)
    // mas NÃO muda stagedPinned → grid não reordena agora
    userPinned = userPinned.includes(app.name)
      ? userPinned.filter(n => n !== app.name)
      : [...userPinned, app.name];
    localStorage.setItem('aura-pinned-packages', JSON.stringify(userPinned));
  }

  const PER_PAGE = 6;
  let query = '';
  let page = 0;

  // Ordenação usa stagedPinned → só muda quando o usuário navega de página
  $: sortedApps = [...apps].sort((a, b) => {
    const ap = stagedPinned.includes(a.name);
    const bp = stagedPinned.includes(b.name);
    if (ap && !bp) return -1;
    if (!ap && bp)  return 1;
    return a.name.localeCompare(b.name);
  });

  $: filtered   = sortedApps.filter(a => a.name.toLowerCase().includes(query.toLowerCase()));
  $: totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE));
  $: if (query !== undefined) page = 0;
  $: visible  = filtered.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
  $: phantoms = Array(Math.max(0, PER_PAGE - visible.length)).fill(null);

  function changePage(newPage) {
    // Ao navegar, sincroniza stagedPinned → reordena na próxima página
    stagedPinned = [...userPinned];
    page = newPage;
    if (page > totalPages - 1) page = Math.max(0, totalPages - 1);
  }

  function prev() { if (page > 0) changePage(page - 1); }
  function next() { if (page < totalPages - 1) changePage(page + 1); }

  // Swipe
  let touchStartX = 0, touchStartY = 0, mouseStartX = 0, dragging = false;
  function swipe(dx) { if (dx < 0) next(); else prev(); }
  function onTouchStart(e) { touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }
  function onTouchEnd(e) {
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) swipe(dx);
  }
  function onMouseDown(e) { mouseStartX = e.clientX; dragging = true; }
  function onMouseUp(e) {
    if (!dragging) return; dragging = false;
    const dx = e.clientX - mouseStartX;
    if (Math.abs(dx) > 40) swipe(dx);
  }

  // Refresh manual — permanece na mesma página
  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    await fetchApps();
    // Pequeno delay para o spin completar pelo menos uma volta
    await new Promise(r => setTimeout(r, 500));
    refreshing = false;
  }

  // Estilos inline do ícone
  function iconStyle(app) {
    const p = [];
    if (app.bgColor) p.push(`background-color:${app.bgColor}`);
    if (app.color)   p.push(`color:${app.color}`);
    return p.join(';');
  }
</script>

<svelte:window on:mouseup={onMouseUp} />

<div class="flex flex-col gap-2.5">

  <!-- Header -->
  <div class="flex items-center justify-between">
    <span class="font-mono text-[10px] font-medium tracking-[0.14em] uppercase text-[var(--txt-3)]">
      Apps
    </span>
    <button
      on:click={refresh}
      disabled={refreshing}
      aria-label="recarregar pacotes"
      class="w-[18px] h-[18px] flex items-center justify-center bg-transparent border-none cursor-pointer text-[var(--txt-3)] hover:text-[var(--txt-2)] disabled:cursor-default transition-colors duration-150 [-webkit-tap-highlight-color:transparent] rounded-md p-0"
    >
      <svg
        width="11" height="11" viewBox="0 0 24 24" fill="none"
        stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"
        class:spinning={refreshing}
        class:refresh-idle={!refreshing}
      >
        <path d="M21 2v6h-6"/>
        <path d="M3 12a9 9 0 0 1 15-6.7L21 8"/>
        <path d="M3 22v-6h6"/>
        <path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
      </svg>
    </button>
  </div>

  <!-- Search -->
  <div class="flex items-center gap-1.5 bg-[var(--w03)] border-[0.5px] border-[var(--border)] rounded-lg px-2.5 h-[30px] transition-colors duration-150 focus-within:border-[var(--w20)] focus-within:bg-[var(--w05)]">
    <svg class="w-3 h-3 stroke-[var(--txt-3)] shrink-0" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/>
      <line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input
      bind:value={query}
      type="text"
      placeholder="search package"
      class="bg-transparent border-none outline-none text-[var(--txt)] text-[11px] w-full placeholder:text-[var(--txt-3)]"
    />
    {#if query}
      <button
        on:click={() => query = ''}
        aria-label="limpar"
        class="shrink-0 text-[var(--txt-3)] hover:text-[var(--txt)] text-sm leading-none cursor-pointer bg-transparent border-none px-0.5 rounded transition-colors duration-100"
      >×</button>
    {/if}
  </div>

  <!-- Grid -->
  <div
    class="overflow-hidden cursor-grab active:cursor-grabbing select-none"
    on:touchstart={onTouchStart}
    on:touchend={onTouchEnd}
    on:mousedown={onMouseDown}
    role="grid"
    aria-label="lista de pacotes"
  >
    <!-- min-h fixa altura de 2 linhas para não colapsar -->
    <div class="grid grid-cols-3 gap-[3px] min-h-[164px]">

      {#if visible.length}
        {#each visible as app (app.id)}
          {@const isPinned = userPinned.includes(app.name)}
          <!-- Célula: largura fixa pelo grid, nunca expande -->
          <div class="relative min-w-0" role="gridcell">
            <button
              class="relative flex flex-col items-center justify-start gap-1.5 pt-2.5 pb-2 px-1 w-full bg-transparent border-none cursor-pointer text-inherit rounded-[11px] transition-[background,transform] duration-150 hover:bg-[var(--w045)] active:scale-[0.93] active:bg-[var(--w07)] min-w-0 [-webkit-tap-highlight-color:transparent]"
              on:click={() => dispatch('open', app)}
              title={app.name}
            >

              <!-- Pin — sempre visível no mobile (opacidade baixa), maior ao pinado -->
              <!-- Área de toque 36×36 via padding, glyph pequeno dentro -->
              <span
                class="
                  absolute top-0 right-0 z-10
                  w-[36px] h-[36px]
                  flex items-start justify-end
                  pt-[5px] pr-[5px]
                  rounded-[0_11px_0_11px]
                  [-webkit-tap-highlight-color:transparent]
                  touch-manipulation
                  transition-opacity duration-150
                  {isPinned
                    ? 'opacity-100 cursor-pointer'
                    : 'opacity-[0.22] cursor-pointer hover:opacity-80'}
                "
                role="button"
                tabindex={0}
                aria-label={isPinned ? 'Desfixar' : 'Fixar'}
                aria-pressed={isPinned}
                on:click={(e) => togglePin(app, e)}
                on:keydown={(e) => e.key === 'Enter' && togglePin(app, e)}
                on:touchend={(e) => { e.preventDefault(); togglePin(app, e); }}
              >
                <!-- Asterisco SVG de 6 braços retos -->
                <svg
                  width="9" height="9" viewBox="0 0 10 10"
                  fill="currentColor"
                  aria-hidden="true"
                  class="
                    text-[var(--txt)] block
                    transition-[transform,filter,opacity] duration-200
                    {isPinned ? '[filter:drop-shadow(0_0_2.5px_rgba(255,255,255,0.55))]' : ''}
                  "
                >
                  <!-- 6 braços a 0°, 60°, 120°, 180°, 240°, 300° -->
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

              <!-- Ícone -->
              <div
                class="
                  w-[34px] h-[34px] rounded-[9px] shrink-0 overflow-hidden
                  border-[0.5px] border-[var(--border)]
                  flex items-center justify-center
                  font-semibold leading-none
                  transition-[border-color,box-shadow] duration-150
                  group-hover:border-[var(--w18)]
                  {!app.bgColor && !app.color ? 'bg-[var(--w04)] text-[var(--txt)]' : ''}
                "
                style={iconStyle(app)}
              >
                {#if app.icon}
                  <img src={app.icon} alt={app.name} class="w-full h-full object-cover" draggable="false" />
                {:else}
                  <span class="text-[15px]">{app.name[0].toUpperCase()}</span>
                {/if}
              </div>

              <!-- Nome: bloco de largura fixa, trunca com ellipsis, nunca quebra linha -->
              <span class="
                text-[10px] text-[var(--txt-2)] leading-tight
                w-full text-center tracking-[0.01em]
                overflow-hidden whitespace-nowrap text-ellipsis
                max-w-full block
                transition-colors duration-150
              ">
                {app.name}
              </span>

            </button>
          </div>
        {/each}

        {#each phantoms as _, i (i)}
          <div class="invisible pointer-events-none" aria-hidden="true"></div>
        {/each}

      {:else}
        <p class="col-span-3 flex items-center justify-center text-[11px] text-[var(--txt-3)] italic py-[18px] m-0">
          no packages found
        </p>
      {/if}

    </div>
  </div>

  <!-- Paginação -->
  {#if totalPages > 1}
    <div class="flex items-center justify-between gap-2">

      <button
        class="flex items-center justify-center w-[22px] h-[22px] bg-transparent border-[0.5px] border-[var(--border)] rounded-[7px] cursor-pointer text-[var(--txt-2)] shrink-0 transition-[background,border-color,color,transform] duration-[120ms] enabled:hover:bg-[var(--w05)] enabled:hover:border-[var(--w18)] enabled:hover:text-[var(--txt)] enabled:active:scale-[0.88] disabled:opacity-[0.22] disabled:cursor-default [-webkit-tap-highlight-color:transparent]"
        on:click={prev}
        disabled={page === 0}
        aria-label="anterior"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="15 18 9 12 15 6"/>
        </svg>
      </button>

      <div class="flex items-center gap-1 flex-1 justify-center" role="tablist" aria-label="páginas">
        {#each Array(totalPages) as _, i}
          <button
            class="
              h-1 p-0 border-none cursor-pointer rounded-full
              transition-[background-color,width,border-radius] duration-[200ms]
              [-webkit-tap-highlight-color:transparent]
              {i === page
                ? 'w-3.5 bg-[var(--txt)] rounded-[2px]'
                : 'w-1 bg-[var(--w15)] hover:bg-[var(--w30)] hover:w-1.5'}
            "
            on:click={() => changePage(i)}
            role="tab"
            aria-selected={i === page}
            aria-label="página {i + 1}"
          ></button>
        {/each}
      </div>

      <button
        class="flex items-center justify-center w-[22px] h-[22px] bg-transparent border-[0.5px] border-[var(--border)] rounded-[7px] cursor-pointer text-[var(--txt-2)] shrink-0 transition-[background,border-color,color,transform] duration-[120ms] enabled:hover:bg-[var(--w05)] enabled:hover:border-[var(--w18)] enabled:hover:text-[var(--txt)] enabled:active:scale-[0.88] disabled:opacity-[0.22] disabled:cursor-default [-webkit-tap-highlight-color:transparent]"
        on:click={next}
        disabled={page >= totalPages - 1}
        aria-label="próxima"
      >
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="9 18 15 12 9 6"/>
        </svg>
      </button>

    </div>
  {/if}

</div>

<!-- spin precisa de <style> por causa do @keyframes -->
<style>
  @keyframes spin {
    to { transform: rotate(360deg); }
  }
  /* Ícone girando durante o refresh */
  .spinning {
    animation: spin 1s linear infinite;
  }
  /* Ícone em repouso: hover com giradinha suave */
  .refresh-idle {
    transition: transform 800ms ease;
  }
  .refresh-idle:hover {
    transform: rotate(40deg);
  }
</style>
