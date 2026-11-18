<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from './api';
  import { saveWidgetCache } from './persistence.js';
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
  let appsLoading = true;
  let appsLoadError = false;
  let hasLoadedApps = false;
  let loadGeneration = 0;
  let theme = 'dark';
  let mobileViewport = false;
  let query = '';
  let page = 0;
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

  function restoreAppsCache(deviceId) {
    if (typeof localStorage === 'undefined') return false;
    try {
      const cached = JSON.parse(localStorage.getItem(APPS_CACHE_KEY) || 'null');
      const items = deviceId === null ? cached : cached?.scope === deviceId ? cached.items : null;
      if (!Array.isArray(items)) return false;
      apps = visibleApps(items);
      return true;
    } catch {
      return false;
    }
  }

  function saveAppsCache(nextApps, deviceId) {
    saveWidgetCache(APPS_CACHE_KEY, nextApps, MAX_CACHED_APPS, 'apps cache', deviceId);
  }

  function visibleApps(list) {
    return list
      .filter((app) => typeof app?.name === 'string')
      .filter((app) => app.mobileSupported !== false || !mobileViewport)
      .filter(isMenuPreviewApp)
      .filter((app) => !exclude.includes(app.packageName))
      .map((app, index) => ({ ...app, id: app.id || String(index) }));
  }

  function onThemeChanged(e) { theme = e.detail; }

  async function fetchApps() {
    const generation = ++loadGeneration;
    appsLoading = true;
    try {
      const deviceId = new URLSearchParams(window.location.search).get('appId') || null;
      const suffix = deviceId ? `?appId=${encodeURIComponent(deviceId)}` : '';
      const list = await api(`/apps/list${suffix}`, 'GET', null, 'shell', { timeoutMs: 12000 });
      if (generation !== loadGeneration) return;
      if (!Array.isArray(list)) {
        appsLoadError = true;
        console.warn('[Shell] Apps refresh failed', { status: list?.status, code: list?.code });
        return;
      }
      const catalog = list.filter((app) => (app?.url || app?.mobile) && app?.default === true)
        .filter(isMenuPreviewApp);
      const nextApps = visibleApps(catalog);
      apps = nextApps;
      appsLoadError = false;
      hasLoadedApps = true;
      saveAppsCache(catalog, deviceId);
    } catch (error) {
      if (generation !== loadGeneration) return;
      appsLoadError = true;
      console.warn('[Shell] Apps refresh failed', error?.name);
    } finally {
      if (generation === loadGeneration) appsLoading = false;
    }
  }

  onMount(() => {
    const mobileQuery = window.matchMedia('(max-width: 767px)');
    const coarsePointerQuery = window.matchMedia('(pointer: coarse)');
    const updateViewport = () => {
      mobileViewport = mobileQuery.matches || coarsePointerQuery.matches;
    };
    const syncViewport = () => {
      updateViewport();
      fetchApps();
    };
    updateViewport();
    if (!apps.length) restoreAppsCache(new URLSearchParams(window.location.search).get('appId') || null);
    favoriteIds = readFavoriteApps();
    theme = getTheme();
    window.addEventListener('think:theme-changed', onThemeChanged);
    window.addEventListener('storage', onStorage);
    window.addEventListener('online', fetchApps);
    mobileQuery.addEventListener('change', syncViewport);
    coarsePointerQuery.addEventListener('change', syncViewport);
    fetchApps();
    pollingInterval = setInterval(fetchApps, 30000);
    return () => {
      loadGeneration++;
      clearInterval(pollingInterval);
      window.removeEventListener('think:theme-changed', onThemeChanged);
      window.removeEventListener('storage', onStorage);
      window.removeEventListener('online', fetchApps);
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
    <button on:click={fetchApps} disabled={appsLoading} aria-busy={appsLoading} aria-label="Refresh apps" class="w-5 h-5 shrink-0 flex items-center justify-center bg-transparent border-none cursor-pointer rounded-[5px] p-0 disabled:opacity-40" style="color: var(--rail-txt-3);">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
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

  <div class="overflow-hidden select-none" class:cursor-grab={visible.length > 0} on:touchstart={onTouchStart} on:touchend={onTouchEnd} on:mousedown={onMouseDown} role="grid" aria-label="Package list">
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
      {:else if appsLoading && !hasLoadedApps && !apps.length}
        {#each Array(layout === 'grid' ? 6 : 4) as _}
          <div class="app-placeholder" class:placeholder-list={layout === 'list'} aria-hidden="true">
            <span class="placeholder-icon"></span>
            <span class="placeholder-label"></span>
          </div>
        {/each}
      {/if}
    </div>
    {#if !visible.length && appsLoading && !hasLoadedApps && !apps.length}
      <span class="sr-only" role="status">Loading apps</span>
    {:else if !visible.length && appsLoadError && !apps.length}
      <div class="app-state" role="status">
        <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true">
          <rect x="4" y="4" width="6" height="6" rx="1"/>
          <rect x="14" y="4" width="6" height="6" rx="1"/>
          <rect x="4" y="14" width="6" height="6" rx="1"/>
          <path d="M14 17h6"/>
        </svg>
        <span>Apps unavailable</span>
        <button class="app-retry" on:click={fetchApps}>Try again</button>
      </div>
    {:else if !visible.length}
      <p class="app-state" role="status">{query ? 'No matching apps' : 'No apps found'}</p>
    {:else if appsLoadError}
      <p class="app-state-note" role="status">Refresh failed. Showing the last available apps.</p>
    {/if}
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
  .app-state {
    display: flex;
    min-height: 112px;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 8px;
    margin: 0;
    padding: 12px;
    text-align: center;
    color: var(--tk-muted);
    font-size: 11px;
  }
  .app-state-note {
    margin: 6px 0 0;
    text-align: center;
    color: var(--tk-muted);
    font-size: 11px;
  }
  .app-retry {
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    background: var(--tk-surface);
    color: var(--tk-text);
    padding: 5px 10px;
    cursor: pointer;
  }
  .app-placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 6px;
    padding: 8px 4px;
  }
  .placeholder-list {
    flex-direction: row;
    padding: 6px;
  }
  .placeholder-icon, .placeholder-label {
    display: block;
    background: var(--tk-surface-2);
  }
  .placeholder-icon {
    width: 32px;
    height: 32px;
    border-radius: var(--tk-radius-md);
  }
  .placeholder-label {
    width: 65%;
    height: 6px;
    border-radius: var(--tk-radius-md);
  }
  .placeholder-list .placeholder-label { max-width: 88px; }
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
</style>
