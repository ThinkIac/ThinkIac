<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from './api';
  import { getTheme } from './theme.js';
  import AppCell from './AppCell.svelte';
  import { recordOpen } from './lib/app_usage.js';
  import {
    FAVORITE_APPS_KEY,
    favoriteAppId,
    readFavoriteApps,
    sortAppsWithFavorites,
    toggleFavoriteApp,
    writeFavoriteApps,
  } from './lib/favorite_apps.js';

  export let apps = [];
  export let variant = 'compact';
  export let exclude = [];
  $: isLauncher = variant === 'launcher';

  const dispatch = createEventDispatcher();
  let pollingInterval;
  let appsLoading = false;
  let appsLoadError = '';
  let theme = 'dark';
  let mobileViewport = false;
  let query = '';
  let page = 0;
  let refreshing = false;
  let touchStartX = 0;
  let touchStartY = 0;
  let mouseStartX = 0;
  let dragging = false;
  let favoriteIds = [];
  const APPS_CACHE_KEY = 'shell:apps-cache:v1';
  const MAX_CACHED_APPS = 200;

  // O Shell é a superfície que hospeda este Widget de Menu, não um pacote
  // que possa ser aberto dentro dele. Ignorá-lo aqui também limpa caches
  // antigos, antes que a próxima consulta ao catálogo termine.
  function isMenuPreviewApp(app) {
    return String(app?.packageName || '').trim().toLowerCase() !== 'shell';
  }

  function restoreAppsCache() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const cached = JSON.parse(localStorage.getItem(APPS_CACHE_KEY) || 'null');
      if (!Array.isArray(cached)) return false;
      apps = cached.filter(isMenuPreviewApp);
      return true;
    } catch {
      return false;
    }
  }

  function saveAppsCache(nextApps) {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(APPS_CACHE_KEY, JSON.stringify(nextApps.slice(0, MAX_CACHED_APPS))); } catch {}
  }

  function onThemeChanged(e) { theme = e.detail; }

  async function fetchApps() {
    appsLoading = true;
    appsLoadError = '';
    try {
      const deviceId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('appId')
        : null;
      const suffix = deviceId ? `?appId=${encodeURIComponent(deviceId)}` : '';
      const list = await api(`/apps/list${suffix}`, 'GET', null, 'shell', { timeoutMs: 12000 });
      if (!Array.isArray(list)) {
        apps = [];
        appsLoadError = list?.error
          ? `${list.error}${list.status ? ` (HTTP ${list.status})` : ''}`
          : 'The packages API did not return a list. Reload and try again.';
        return;
      }
      const nextApps = list
        .filter((app) => (app?.url || app?.mobile) && app?.default === true)
        .filter((app) => app?.mobileSupported !== false || !mobileViewport)
        .filter(isMenuPreviewApp)
        .filter((app) => !exclude.includes(app.packageName))
        .map((app, index) => ({ ...app, id: app.id || String(index) }));
      apps = nextApps;
      saveAppsCache(nextApps);
    } catch (error) {
      // Não descarte a última lista válida: o widget continua útil durante
      // quedas transitórias do Runtime e tenta atualizar de novo no polling.
      appsLoadError = apps.length ? '' : (error?.message || 'Failed to load packages.');
      console.error('Erro ao atualizar apps:', error);
    } finally {
      appsLoading = false;
    }
  }

  onMount(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    const syncViewport = () => {
      mobileViewport = mobileQuery.matches || coarsePointerQuery.matches;
      fetchApps();
    };
    restoreAppsCache();
    favoriteIds = readFavoriteApps();
    theme = getTheme();
    window.addEventListener('think:theme-changed', onThemeChanged);
    window.addEventListener('storage', onStorage);
    mobileQuery.addEventListener('change', syncViewport);
    coarsePointerQuery.addEventListener('change', syncViewport);
    syncViewport();
    pollingInterval = setInterval(fetchApps, 30000);
    return () => {
      clearInterval(pollingInterval);
      window.removeEventListener('think:theme-changed', onThemeChanged);
      window.removeEventListener('storage', onStorage);
      mobileQuery.removeEventListener('change', syncViewport);
      coarsePointerQuery.removeEventListener('change', syncViewport);
    };
  });

  function onStorage(event) {
    if (event.key === FAVORITE_APPS_KEY) favoriteIds = readFavoriteApps();
  }

  function isFavorite(app) {
    return favoriteIds.includes(favoriteAppId(app));
  }

  function toggleFavorite(app) {
    favoriteIds = toggleFavoriteApp(favoriteIds, app);
    writeFavoriteApps(favoriteIds);
    page = 0;
  }

  function openApp(app) {
    recordOpen(app.id);
    query = '';
    if (app?.mobile?.launchable) {
      const bridge = window.FlutterBridge || window.ThinkiacEdge;
      bridge?.postMessage?.(JSON.stringify({ type: 'mobile-app-launch', packageName: app.mobile.packageName }));
      api('/apps/mobile/launch', 'POST', { appId: app.mobile.appId, packageName: app.mobile.packageName }, 'shell');
      return;
    }
    dispatch('open', app);
  }

  function showAppInfo(app) {
    query = '';
    dispatch('info', app);
  }

  // O Widget de Menu oferece três densidades de leitura e uma organização
  // simples: favoritos locais ficam antes dos demais pacotes.
  let layout = 'compact';
  $: filtered = sortAppsWithFavorites(apps, favoriteIds)
    .filter((app) => app.name.toLowerCase().includes(query.toLowerCase()));
  // O Grid tem três colunas. Nove itens completam três linhas sem deixar uma
  // célula vazia; os outros modos mantêm a paginação atual.
  $: perPage = layout === 'grid' ? 9 : 8;
  $: totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  $: if (query !== undefined) page = Math.min(page, totalPages - 1);
  $: visible = filtered.slice(page * perPage, (page + 1) * perPage);

  function changePage(nextPage) { page = Math.max(0, Math.min(nextPage, totalPages - 1)); }
  function prev() { changePage(page - 1); }
  function next() { changePage(page + 1); }
  function swipe(deltaX) { if (deltaX < 0) next(); else prev(); }
  function onTouchStart(event) {
    touchStartX = event.touches[0].clientX;
    touchStartY = event.touches[0].clientY;
  }
  function onTouchEnd(event) {
    const deltaX = event.changedTouches[0].clientX - touchStartX;
    const deltaY = event.changedTouches[0].clientY - touchStartY;
    if (Math.abs(deltaX) > Math.abs(deltaY) && Math.abs(deltaX) > 40) swipe(deltaX);
  }
  function onMouseDown(event) { mouseStartX = event.clientX; dragging = true; }
  function onMouseUp(event) {
    if (!dragging) return;
    dragging = false;
    const deltaX = event.clientX - mouseStartX;
    if (Math.abs(deltaX) > 40) swipe(deltaX);
  }
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    await fetchApps();
    refreshing = false;
  }
</script>

<svelte:window on:mouseup={onMouseUp} />

<div class="flex flex-col {isLauncher ? 'gap-3' : 'gap-2'}">
  <div class="flex items-center gap-1.5 px-1 {isLauncher ? 'h-8' : 'h-[28px]'}"
    style="background: transparent; border: 0; border-bottom: 0.5px solid color-mix(in srgb, var(--rail-border) 72%, transparent);">
    <svg class="{isLauncher ? 'w-4 h-4' : 'w-3 h-3'} shrink-0" style="stroke: var(--rail-txt-3);" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input bind:value={query} type="text" placeholder="Search" aria-label="Search apps"
      class="bg-transparent border-none outline-none {isLauncher ? 'text-[12px]' : 'text-[10px]'} w-full placeholder:opacity-30" style="color: var(--rail-txt-2);" />
    {#if query}
      <button on:click={() => query = ''} aria-label="Clear search" class="shrink-0 text-sm leading-none cursor-pointer bg-transparent border-none px-0.5 rounded" style="color: var(--rail-txt-3);">×</button>
    {/if}
    <button on:click={refresh} disabled={refreshing} aria-label="Refresh apps" class="w-5 h-5 shrink-0 flex items-center justify-center bg-transparent border-none cursor-pointer rounded-[5px] p-0 disabled:opacity-40" style="color: var(--rail-txt-3);">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:spinning={refreshing}>
        <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
      </svg>
    </button>
  </div>

  <div class="flex items-center justify-end gap-0.5 px-1" role="group" aria-label="Package view mode">
    {#each [
      { id: 'grid', label: 'Grid' },
      { id: 'compact', label: 'Compact' },
      { id: 'list', label: 'List' },
    ] as mode}
      <button
        class:active-layout={layout === mode.id}
        class="layout-mode-button"
        on:click={() => layout = mode.id}
        aria-pressed={layout === mode.id}
      >{mode.label}</button>
    {/each}
  </div>

  <div class="overflow-hidden select-none cursor-grab active:cursor-grabbing" on:touchstart={onTouchStart} on:touchend={onTouchEnd} on:mousedown={onMouseDown} role="grid" aria-label="Package list">
    <div class={layout === 'list' ? 'flex flex-col gap-1' : layout === 'compact' ? 'grid grid-cols-4 gap-1' : 'grid grid-cols-3 gap-1.5'}>
      {#if visible.length}
        {#each visible as app (app.id)}
          <AppCell
            {app}
            isLauncher={true}
            {theme}
            {layout}
            showFavorite
            favorite={isFavorite(app)}
            on:favorite={() => toggleFavorite(app)}
            on:open={() => openApp(app)}
            on:info={() => showAppInfo(app)}
          />
        {/each}
      {:else if appsLoading}
        <p class="flex items-center justify-center text-[11px] italic py-[18px] m-0" style="color: var(--rail-txt-3);">Loading packages…</p>
      {:else if appsLoadError}
        <div class="flex flex-col items-center justify-center gap-2 py-[18px] text-center">
          <p class="m-0 text-[11px]" style="color: var(--rail-txt-2);">Could not load packages</p>
          <p class="m-0 max-w-full break-words text-[10px]" style="color: var(--rail-txt-3);">{appsLoadError}</p>
          <button on:click={fetchApps} class="cursor-pointer rounded-lg px-3 py-1.5 text-[11px]" style="background: var(--rail-flat); border: 0.5px solid var(--rail-border); color: var(--rail-txt);">Try again</button>
        </div>
      {:else}
        <p class="flex items-center justify-center text-[11px] italic py-[18px] m-0" style="color: var(--rail-txt-3);">no apps found</p>
      {/if}
    </div>
  </div>

  {#if totalPages > 1}
    <div class="flex items-center justify-between gap-2">
      <button class="flex items-center justify-center w-[24px] h-[24px] rounded-[8px]" style="border: 0.5px solid var(--rail-border); background: transparent; color: var(--rail-txt-2);" on:click={prev} disabled={page === 0} aria-label="Previous page">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <span class="text-[10px]" style="color: var(--rail-txt-3);">{page + 1} / {totalPages}</span>
      <button class="flex items-center justify-center w-[24px] h-[24px] rounded-[8px]" style="border: 0.5px solid var(--rail-border); background: transparent; color: var(--rail-txt-2);" on:click={next} disabled={page === totalPages - 1} aria-label="Next page">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  {/if}
</div>

<style>
  .spinning { animation: spin 0.7s linear infinite; }
  .layout-mode-button {
    border: 0;
    border-radius: 5px;
    background: transparent;
    color: var(--rail-txt-3);
    cursor: pointer;
    font: inherit;
    font-size: 9px;
    line-height: 1;
    padding: 4px 5px;
  }
  .layout-mode-button:hover,
  .layout-mode-button:focus-visible {
    color: var(--rail-txt-2);
    background: var(--rail-flat);
    outline: none;
  }
  .layout-mode-button.active-layout {
    color: var(--rail-txt);
    background: var(--rail-flat);
  }
  @keyframes spin { to { transform: rotate(360deg); } }
</style>
