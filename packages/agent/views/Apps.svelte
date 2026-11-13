<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from './api';
  import { getTheme } from './theme.js';
  import AppCell from './AppCell.svelte';
  import {
    folders,
    createFolder,
    createFolderWith,
    renameFolder,
    deleteFolder,
    assignAppToFolder,
    unassignApp,
    looseOrder,
    setLooseOrder,
    applyLooseOrder,
  } from './lib/app_folders.js';
  import { recordOpen, usageScores } from './lib/app_usage.js';
  import { appLayout, cycleLayout, setSortMode } from './lib/app_layout.js';

  export let apps = [];
  export let variant = 'compact';
  // Pacotes que não devem aparecer na grade. Vazio por padrão — o rail do
  // Agent segue listando tudo. Existe para quem embute esta grade dentro de um
  // app: o pacote `desktop` reusa ela e precisa se esconder de si mesmo, senão
  // abre um desktop dentro do desktop.
  export let exclude = [];
  $: isLauncher = variant === 'launcher';

  const dispatch = createEventDispatcher();
  let pollingInterval;

  let userPinned  = [];
  let stagedPinned = [];

  let theme = 'dark';
  function onThemeChanged(e) { theme = e.detail; }

  async function fetchApps() {
    try {
      const deviceId = typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('appId')
        : null;
      const suffix = deviceId ? `?appId=${encodeURIComponent(deviceId)}` : '';
      const list = await api(`/apps/list${suffix}`, 'GET', null, 'aura-system');
      let fetched = list
        .filter(a => (a?.url || a?.mobile) && a?.default === true)
        .filter(a => !exclude.includes(a.packageName))
        .map((a, i) => ({ ...a, id: a.id || String(i) }));
      apps = fetched;
    } catch (e) {
      console.error('Erro ao atualizar apps:', e);
    }
  }

  onMount(() => {
    const saved = localStorage.getItem('aura-pinned-packages');
    if (saved) { userPinned = JSON.parse(saved); stagedPinned = [...userPinned]; }
    theme = getTheme();
    window.addEventListener('think:theme-changed', onThemeChanged);
    fetchApps();
    pollingInterval = setInterval(fetchApps, 30000);
    return () => {
      if (pollingInterval) clearInterval(pollingInterval);
      window.removeEventListener('think:theme-changed', onThemeChanged);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
    };
  });

  function togglePin(app) {
    userPinned = userPinned.includes(app.name)
      ? userPinned.filter(n => n !== app.name)
      : [...userPinned, app.name];
    if (typeof localStorage !== 'undefined') localStorage.setItem('aura-pinned-packages', JSON.stringify(userPinned));
  }

  // O bridge existe somente dentro do APK. No navegador a ação não deve
  // simular sucesso: o launcher Android é quem confirma/cria o atalho.
  function requestHomeShortcut(app) {
    if (!app?.homeShortcut || !window.FlutterBridge?.postMessage) return;
    window.FlutterBridge.postMessage(JSON.stringify({
      type: 'home-shortcut',
      packageName: app.homeShortcut.packageName,
      label: app.homeShortcut.label,
      icon: app.icon || null,
    }));
  }

  // Abrir um app: registra uso (auto-sort), reseta a busca e fecha modal.
  function openApp(app) {
    if (editMode) return;
    recordOpen(app.id);
    query = '';
    selectedFolder = null;
    if (app?.mobile?.launchable) {
      const bridge = window.FlutterBridge || window.ThinkiacEdge;
      if (bridge?.postMessage) {
        bridge.postMessage(JSON.stringify({ type: 'mobile-app-launch', packageName: app.mobile.packageName }));
      }
      // Quando há Hermes, o runtime também pode entregar o comando ao device.
      api('/apps/mobile/launch', 'POST', { appId: app.mobile.appId, packageName: app.mobile.packageName }, 'aura-system');
      return;
    }
    dispatch('open', app);
  }

  let query = '';
  let page = 0;

  $: sortedApps = [...apps].sort((a, b) => {
    const ap = stagedPinned.includes(a.name);
    const bp = stagedPinned.includes(b.name);
    if (ap && !bp) return -1;
    if (!ap && bp)  return 1;
    return a.name.localeCompare(b.name);
  });

  $: groupedIds = isLauncher ? new Set($folders.flatMap(f => f.appIds)) : new Set();
  $: baseApps = isLauncher ? sortedApps.filter(a => !groupedIds.has(a.id)) : sortedApps;

  // Ordenação dos apps soltos: manual (drag&drop salvo) ou auto (score de uso).
  $: looseOrdered = !isLauncher
    ? baseApps
    : $appLayout.sort === 'auto'
      ? [...baseApps].sort((a, b) => {
          const ap = stagedPinned.includes(a.name), bp = stagedPinned.includes(b.name);
          if (ap !== bp) return ap ? -1 : 1;               // fixados sempre primeiro
          const sa = $usageScores.get(a.id) || 0, sb = $usageScores.get(b.id) || 0;
          if (sb !== sa) return sb - sa;                   // mais usado primeiro
          return a.name.localeCompare(b.name);
        })
      : applyLooseOrder(baseApps, $looseOrder);

  $: looseAppsFull = looseOrdered; // ordem completa (sem busca/paginação), base do reorder
  $: filtered   = looseOrdered.filter(a => a.name.toLowerCase().includes(query.toLowerCase()));

  // O launcher pode escolher seu layout; o widget do menu mantém a grade
  // mais arejada usada no desktop.
  $: layout     = isLauncher ? $appLayout.layout : 'grid';
  $: isList     = isLauncher && layout === 'list';
  $: perPage    = !isLauncher ? 6 : (isList ? 8 : layout === 'compact' ? 18 : 10);
  $: totalPages = Math.max(1, Math.ceil(filtered.length / perPage));
  $: if (query !== undefined) page = 0;
  $: visible  = filtered.slice(page * perPage, (page + 1) * perPage);
  $: phantoms = (isList || editMode) ? [] : Array(Math.max(0, perPage - visible.length)).fill(null);

  $: gridCls = isList
    ? 'flex flex-col gap-1'
    : isLauncher
      ? (layout === 'compact' ? 'grid grid-cols-6 gap-x-1 gap-y-3' : 'grid grid-cols-5 gap-x-1.5 gap-y-4')
      : 'grid grid-cols-3 gap-[4px] min-h-[180px]';

  function changePage(newPage) {
    stagedPinned = [...userPinned];
    page = newPage;
    if (page > totalPages - 1) page = Math.max(0, totalPages - 1);
  }
  function prev() { if (page > 0) changePage(page - 1); }
  function next() { if (page < totalPages - 1) changePage(page + 1); }

  // ── Swipe de paginação (desligado em modo edição, pra não brigar c/ drag) ──
  let touchStartX = 0, touchStartY = 0, mouseStartX = 0, dragging = false;
  function swipe(dx) { if (dx < 0) next(); else prev(); }
  function onTouchStart(e) { if (editMode) return; touchStartX = e.touches[0].clientX; touchStartY = e.touches[0].clientY; }
  function onTouchEnd(e) {
    if (editMode) return;
    const dx = e.changedTouches[0].clientX - touchStartX;
    const dy = e.changedTouches[0].clientY - touchStartY;
    if (Math.abs(dx) > Math.abs(dy) && Math.abs(dx) > 40) swipe(dx);
  }
  function onMouseDown(e) { if (editMode) return; mouseStartX = e.clientX; dragging = true; }
  function onMouseUp(e) {
    if (!dragging || editMode) { dragging = false; return; }
    dragging = false;
    const dx = e.clientX - mouseStartX;
    if (Math.abs(dx) > 40) swipe(dx);
  }

  let refreshing = false;
  async function refresh() {
    if (refreshing) return;
    refreshing = true;
    await fetchApps();
    await new Promise(r => setTimeout(r, 500));
    refreshing = false;
  }

  // ── Modo edição + drag & drop (pointer events, mouse+touch) ────────────────
  let editMode = false;
  let selectedFolder = null; // pasta aberta no modal

  const drag = { active: false, app: null, x: 0, y: 0, pointerId: null };
  let dragActive = false;      // espelho reativo de drag.active pro template
  // Posição do ghost em vars reativas separadas: em Svelte 3 mutar drag.x NÃO
  // dispara re-render (safe_not_equal só olha a referência de `drag`).
  let ghostX = 0, ghostY = 0;
  let folderCandidate = null;  // id do cell sobre o qual "hover" longo → cria pasta
  let dropTargetFolder = null; // id da pasta destacada como alvo
  let hoverCellId = null;
  let folderTimer = null;

  function clearTimers() {
    if (folderTimer) { clearTimeout(folderTimer); folderTimer = null; }
  }

  function onCellPointerDown(e, app) {
    if (!isLauncher) return;               // dock compact: sem drag
    if (!editMode) return;                 // fora da edição: nada de drag — deixa
                                           // o tap abrir e o swipe trocar de página
    if (e.button != null && e.button !== 0) return;
    drag.app = app;
    drag.x = e.clientX; drag.y = e.clientY;
    drag.pointerId = e.pointerId;
    drag._startX = e.clientX; drag._startY = e.clientY;

    window.addEventListener('pointermove', onPointerMove, { passive: false });
    window.addEventListener('pointerup', onPointerUp);
    beginDrag(app, e);
  }

  function beginDrag(app, e) {
    drag.active = true;
    drag.app = app;
    drag.x = e.clientX; drag.y = e.clientY;
    ghostX = e.clientX; ghostY = e.clientY;
    dragActive = true; // false→true: dispara render, ghost aparece
  }

  function onPointerMove(e) {
    if (!drag.active) return;
    if (e.cancelable) e.preventDefault();
    drag.x = e.clientX; drag.y = e.clientY;
    ghostX = e.clientX; ghostY = e.clientY; // valores mudam → ghost re-renderiza
    const t = detectTarget(e.clientX, e.clientY);

    // alvo pasta
    dropTargetFolder = (t.kind === 'folder') ? t.id : null;

    // hover longo sobre outro cell → candidato a criar pasta
    if (t.kind === 'cell' && t.id && t.id !== drag.app.id) {
      if (hoverCellId !== t.id) {
        hoverCellId = t.id;
        if (folderTimer) clearTimeout(folderTimer);
        folderCandidate = null;
        folderTimer = setTimeout(() => { folderCandidate = t.id; }, 550);
      }
    } else {
      hoverCellId = null;
      if (folderTimer) { clearTimeout(folderTimer); folderTimer = null; }
      folderCandidate = null;
    }
  }

  function onPointerUp() {
    clearTimers();
    if (drag.active) resolveDrop();
    teardownPointer();
  }

  function teardownPointer() {
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    drag.active = false;
    dragActive = false;
    hoverCellId = null;
    dropTargetFolder = null;
    folderCandidate = null;
  }

  function detectTarget(x, y) {
    const el = typeof document !== 'undefined' ? document.elementFromPoint(x, y) : null;
    if (!el) return { kind: 'none' };
    const drop = el.closest && el.closest('[data-drop]');
    if (!drop) return { kind: 'none' };
    const kind = drop.dataset.drop;
    if (kind === 'folder') return { kind: 'folder', id: drop.dataset.folderId };
    if (kind === 'cell')   return { kind: 'cell', id: drop.dataset.appId };
    if (kind === 'loose-zone') return { kind: 'zone' };
    return { kind: 'none' };
  }

  function resolveDrop() {
    const dragId = drag.app && drag.app.id;
    if (!dragId) return;
    const t = detectTarget(drag.x, drag.y);
    if (t.kind === 'folder' && t.id) {
      assignAppToFolder(dragId, t.id);
    } else if (t.kind === 'cell' && t.id && t.id !== dragId) {
      if (folderCandidate === t.id) {
        const id = createFolderWith('', [t.id, dragId]);
        if (id) selectedFolder = id;      // abre o modal da nova pasta pra nomear
      } else {
        reorderLoose(dragId, t.id);
      }
    } else if (t.kind === 'zone') {
      reorderLoose(dragId, null);
    }
  }

  function reorderLoose(dragId, beforeId) {
    const ids = looseAppsFull.map(a => a.id).filter(id => id !== dragId);
    if (beforeId) {
      const idx = ids.indexOf(beforeId);
      if (idx >= 0) ids.splice(idx, 0, dragId); else ids.push(dragId);
    } else {
      ids.push(dragId);
    }
    setLooseOrder(ids);
    setSortMode('manual'); // reordenar manualmente desliga o auto-sort
  }

  function exitEdit() {
    editMode = false;
    clearTimers();
    teardownPointer();
  }

  // ── Pastas: criar / renomear / excluir / modal ─────────────────────────────
  let creatingFolder = false;
  let newFolderName = '';
  let renamingInModal = false;
  let modalName = '';

  function focusOnMount(node) { node.focus(); }

  function commitCreateFolder() {
    const id = createFolder(newFolderName);
    if (id) selectedFolder = id;
    newFolderName = '';
    creatingFolder = false;
  }
  function openFolder(folder) {
    if (editMode) return;
    selectedFolder = folder.id;
  }
  function commitModalRename() {
    if (selectedFolder && modalName.trim()) renameFolder(selectedFolder, modalName);
    renamingInModal = false;
  }
  function handleDeleteFolder(id) {
    if (!confirm('Delete this folder? Its apps go back to the ungrouped list.')) return;
    deleteFolder(id);
    if (selectedFolder === id) selectedFolder = null;
  }

  $: modalFolder = selectedFolder ? $folders.find(f => f.id === selectedFolder) : null;
  $: modalApps = modalFolder ? apps.filter(a => modalFolder.appIds.includes(a.id)) : [];
  $: if (modalFolder && !renamingInModal) modalName = modalFolder.name;

  function ghostBg(a) {
    return a && a.bgColor && !String(a.bgColor).startsWith('bg-') ? a.bgColor : 'var(--rail-flat)';
  }
</script>

<svelte:window on:mouseup={onMouseUp} />

<div class="flex flex-col {isLauncher ? 'gap-4' : 'gap-3'}">

  <!-- Toolbar do launcher: layout • ordenação • editar -->
  {#if isLauncher}
    <div class="flex items-center justify-between gap-2">
      <div class="flex items-center gap-1.5">
        <button on:click={cycleLayout} aria-label="Change layout"
          class="h-7 px-2 flex items-center gap-1.5 rounded-[8px] text-[11px] font-medium cursor-pointer transition-colors duration-150 [-webkit-tap-highlight-color:transparent]"
          style="background: var(--rail-flat); border: 0.5px solid var(--rail-border); color: var(--rail-txt-2);">
          {#if layout === 'list'}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"><path d="M2 4h12M2 8h12M2 12h12"/></svg> List
          {:else if layout === 'compact'}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="2.6" height="2.6" rx="0.6"/><rect x="6.7" y="2" width="2.6" height="2.6" rx="0.6"/><rect x="11.4" y="2" width="2.6" height="2.6" rx="0.6"/><rect x="2" y="6.7" width="2.6" height="2.6" rx="0.6"/><rect x="6.7" y="6.7" width="2.6" height="2.6" rx="0.6"/><rect x="11.4" y="6.7" width="2.6" height="2.6" rx="0.6"/><rect x="2" y="11.4" width="2.6" height="2.6" rx="0.6"/><rect x="6.7" y="11.4" width="2.6" height="2.6" rx="0.6"/><rect x="11.4" y="11.4" width="2.6" height="2.6" rx="0.6"/></svg> Compact
          {:else}
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg> Grid
          {/if}
        </button>
        <button on:click={() => setSortMode($appLayout.sort === 'auto' ? 'manual' : 'auto')} aria-label="Sort order"
          class="h-7 px-2 flex items-center gap-1.5 rounded-[8px] text-[11px] font-medium cursor-pointer transition-colors duration-150 [-webkit-tap-highlight-color:transparent]"
          style="background: {$appLayout.sort === 'auto' ? 'var(--rail-txt)' : 'var(--rail-flat)'}; border: 0.5px solid var(--rail-border); color: {$appLayout.sort === 'auto' ? 'var(--rail-bg, #000)' : 'var(--rail-txt-2)'};">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M4 3v10M4 13l-2-2M4 13l2-2M11 13V3M11 3l-2 2M11 3l2 2"/></svg>
          {$appLayout.sort === 'auto' ? 'Auto' : 'Manual'}
        </button>
      </div>
      <button on:click={() => editMode ? exitEdit() : (editMode = true)} aria-label="Edit apps"
        class="h-7 px-2.5 flex items-center rounded-[8px] text-[11px] font-medium cursor-pointer transition-colors duration-150 [-webkit-tap-highlight-color:transparent]"
        style="background: {editMode ? 'var(--rail-txt)' : 'transparent'}; border: 0.5px solid var(--rail-border); color: {editMode ? 'var(--rail-bg, #000)' : 'var(--rail-txt-2)'};">
        {editMode ? 'Done' : 'Edit'}
      </button>
    </div>
  {/if}

  <!-- Search -->
  <div class="flex items-center gap-2 rounded-[12px] px-3 {isLauncher ? 'h-10' : 'h-[32px]'} transition-all duration-150"
    style="background: {isLauncher ? 'transparent' : 'var(--rail-flat)'}; border: 0.5px solid {isLauncher ? 'transparent' : 'var(--rail-border)'}; border-bottom: 0.5px solid var(--rail-border);">
    <svg class="{isLauncher ? 'w-4 h-4' : 'w-3 h-3'} shrink-0" style="stroke: var(--rail-txt-3);" viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
    </svg>
    <input bind:value={query} type="text" placeholder="search apps"
      class="bg-transparent border-none outline-none {isLauncher ? 'text-[15px]' : 'text-[11px]'} w-full placeholder:opacity-30" style="color: var(--rail-txt);" />
    {#if query}
      <button on:click={() => query = ''} aria-label="clear" class="shrink-0 text-sm leading-none cursor-pointer bg-transparent border-none px-0.5 rounded" style="color: var(--rail-txt-3);">×</button>
    {/if}
    <button on:click={refresh} disabled={refreshing} aria-label="Refresh apps"
      class="w-5 h-5 shrink-0 flex items-center justify-center bg-transparent border-none cursor-pointer rounded-[5px] p-0 transition-opacity duration-200 disabled:opacity-40" style="color: var(--rail-txt-3);">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class:spinning={refreshing}>
        <path d="M21 2v6h-6"/><path d="M3 12a9 9 0 0 1 15-6.7L21 8"/><path d="M3 22v-6h6"/><path d="M21 12a9 9 0 0 1-15 6.7L3 16"/>
      </svg>
    </button>
  </div>

  <!-- Pastas (só launcher) -->
  {#if isLauncher && ($folders.length > 0 || creatingFolder)}
    <div class="grid {layout === 'compact' ? 'grid-cols-4' : 'grid-cols-3'} gap-2">
      {#each $folders as folder (folder.id)}
        {@const folderApps = apps.filter(a => folder.appIds.includes(a.id))}
        <button
          class="folder-tile relative flex flex-col items-center gap-1.5 p-2 rounded-[14px] cursor-pointer transition-all duration-150 [-webkit-tap-highlight-color:transparent]"
          class:folder-drop={dropTargetFolder === folder.id}
          style="background: var(--rail-flat); border: 0.5px solid var(--rail-border);"
          data-drop="folder" data-folder-id={folder.id}
          on:click={() => openFolder(folder)}
          title={folder.name}
        >
          <!-- Mini-preview 2x2 dos ícones -->
          <div class="grid grid-cols-2 gap-0.5 w-11 h-11 p-1 rounded-[11px]" style="background: var(--rail-border);">
            {#each folderApps.slice(0, 4) as fa (fa.id)}
              <div class="rounded-[4px] overflow-hidden flex items-center justify-center text-[8px] font-semibold" style="background: {fa.bgColor && !String(fa.bgColor).startsWith('bg-') ? fa.bgColor : 'var(--rail-flat)'}; color: var(--rail-txt);">
                {#if fa.icon}<img src={fa.icon} alt="" class="w-full h-full object-cover" draggable="false" />{:else}{fa.name[0].toUpperCase()}{/if}
              </div>
            {/each}
          </div>
          <span class="text-[10px] font-medium truncate max-w-full" style="color: var(--rail-txt);">{folder.name}</span>
          <span class="absolute top-1 right-1.5 text-[9px]" style="color: var(--rail-txt-3);">{folder.appIds.length}</span>
        </button>
      {/each}

      {#if creatingFolder}
        <div class="new-folder-tile relative flex flex-col items-center justify-center gap-2 p-2 rounded-[14px]"
          style="background: var(--rail-flat); border: 0.5px dashed var(--rail-border-hi);">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: var(--rail-txt-3);" aria-hidden="true">
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z"/>
          </svg>
          <input bind:value={newFolderName} use:focusOnMount type="text" placeholder="Folder name"
            class="w-full text-center bg-transparent border-none outline-none text-[11px] placeholder:opacity-40" style="color: var(--rail-txt);"
            on:keydown={(e) => { if (e.key === 'Enter') commitCreateFolder(); if (e.key === 'Escape') { creatingFolder = false; newFolderName = ''; } }} />
          <div class="flex items-center gap-1.5">
            <button on:click={commitCreateFolder} aria-label="Create folder"
              class="w-5 h-5 flex items-center justify-center rounded-full cursor-pointer [-webkit-tap-highlight-color:transparent]"
              style="background: var(--rail-txt); border: none; color: var(--rail-bg, #000);">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            </button>
            <button on:click={() => { creatingFolder = false; newFolderName = ''; }} aria-label="Cancel"
              class="w-5 h-5 flex items-center justify-center rounded-full cursor-pointer [-webkit-tap-highlight-color:transparent]"
              style="background: var(--rail-flat); border: 0.5px solid var(--rail-border); color: var(--rail-txt-2);">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  {#if isLauncher}
    <div class="flex items-center justify-end">
      <button on:click={() => creatingFolder = true}
        class="flex items-center gap-1 text-[11px] font-medium bg-transparent border-none cursor-pointer" style="color: var(--rail-txt-2);">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>
        New folder
      </button>
    </div>
    {#if editMode}
      <p class="text-[10px] italic m-0 -mt-1" style="color: var(--rail-txt-3);">Drag to reorder · drop onto another app to create a folder · drop onto a folder to group</p>
    {/if}
  {/if}

  <!-- Grid dos apps soltos -->
  <div class="overflow-hidden select-none {editMode ? '' : 'cursor-grab active:cursor-grabbing'}"
    data-drop="loose-zone"
    on:touchstart={onTouchStart} on:touchend={onTouchEnd} on:mousedown={onMouseDown}
    role="grid" aria-label="package list">
    <div class={gridCls}>
      {#if visible.length}
        {#each visible as app (app.id)}
          <AppCell {app} {isLauncher} {theme} {layout} {editMode}
            dragging={dragActive && drag.app && drag.app.id === app.id}
            folding={folderCandidate === app.id}
            isPinned={userPinned.includes(app.name)}
            on:pointerdown={(e) => onCellPointerDown(e, app)}
            on:open={() => openApp(app)}
            on:homeShortcut={() => requestHomeShortcut(app)}
            on:togglePin={() => togglePin(app)} />
        {/each}
        {#each phantoms as _, i (i)}
          <div class="invisible pointer-events-none" aria-hidden="true"></div>
        {/each}
      {:else}
        <p class="col-span-full flex items-center justify-center text-[11px] italic py-[18px] m-0" style="color: var(--rail-txt-3);">no apps found</p>
      {/if}
    </div>
  </div>

  <!-- Paginação (some em modo edição) -->
  {#if totalPages > 1 && !editMode}
    <div class="flex items-center justify-between gap-2">
      <button class="flex items-center justify-center w-[24px] h-[24px] rounded-[8px] transition-all duration-[120ms]"
        style="border: 0.5px solid var(--rail-border); background: transparent; color: var(--rail-txt-2);" on:click={prev} disabled={page === 0} aria-label="previous">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 18 9 12 15 6"/></svg>
      </button>
      <div class="flex items-center gap-1 flex-1 justify-center" role="tablist" aria-label="pages">
        {#each Array(totalPages) as _, i}
          <button class="h-1 p-0 border-none cursor-pointer rounded-full transition-all duration-[200ms] [-webkit-tap-highlight-color:transparent]"
            style="background: {i === page ? 'var(--rail-txt)' : 'var(--rail-border-hi)'}; width: {i === page ? '14px' : '4px'}; border-radius: {i === page ? '2px' : '50%'};"
            on:click={() => changePage(i)} role="tab" aria-selected={i === page} aria-label="page {i + 1}"></button>
        {/each}
      </div>
      <button class="flex items-center justify-center w-[24px] h-[24px] rounded-[8px] transition-all duration-[120ms]"
        style="border: 0.5px solid var(--rail-border); background: transparent; color: var(--rail-txt-2);" on:click={next} disabled={page >= totalPages - 1} aria-label="next">
        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
      </button>
    </div>
  {/if}
</div>

<!-- Ghost que segue o cursor durante o drag -->
{#if dragActive && drag.app}
  <div class="drag-ghost" style="left: {ghostX}px; top: {ghostY}px;">
    <div class="w-11 h-11 rounded-[13px] overflow-hidden flex items-center justify-center font-semibold" style="border: 0.5px solid var(--rail-border); color: var(--rail-txt); background: {ghostBg(drag.app)};">
      {#if theme === 'dark' && drag.app.iconDark}<img src={drag.app.iconDark} alt="" class="w-full h-full object-cover" />
      {:else if drag.app.icon}<img src={drag.app.icon} alt="" class="w-full h-full object-cover" />
      {:else}<span class="text-[17px]">{drag.app.name[0].toUpperCase()}</span>{/if}
    </div>
  </div>
{/if}

<!-- Modal da pasta -->
{#if modalFolder}
  <div class="folder-modal-backdrop" on:click={() => selectedFolder = null} role="presentation">
    <div class="folder-modal" on:click|stopPropagation role="dialog" aria-label="Folder {modalFolder.name}">
      <div class="flex items-center gap-2 mb-4">
        {#if renamingInModal}
          <input bind:value={modalName} use:focusOnMount class="flex-1 bg-transparent border-none outline-none text-[17px] font-semibold" style="color: var(--rail-txt); border-bottom: 1px solid var(--rail-border);"
            on:keydown={(e) => { if (e.key === 'Enter') commitModalRename(); if (e.key === 'Escape') renamingInModal = false; }} />
          <button on:click={commitModalRename} aria-label="Save" class="text-[15px] bg-transparent border-none cursor-pointer" style="color: var(--rail-txt);">✓</button>
        {:else}
          <button class="flex-1 text-left text-[17px] font-semibold bg-transparent border-none cursor-text truncate" style="color: var(--rail-txt);" on:click={() => { renamingInModal = true; modalName = modalFolder.name; }}>{modalFolder.name}</button>
          <button on:click={() => { renamingInModal = true; modalName = modalFolder.name; }} aria-label="Rename" class="w-7 h-7 flex items-center justify-center bg-transparent border-none cursor-pointer" style="color: var(--rail-txt-3);">
            <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M11 2.5l2.5 2.5M2.5 11L11 2.5 13.5 5 5 13.5H2.5V11z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
          </button>
        {/if}
        <button on:click={() => handleDeleteFolder(modalFolder.id)} aria-label="Delete folder" class="w-7 h-7 flex items-center justify-center bg-transparent border-none cursor-pointer" style="color: var(--rail-txt-3);">
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13"><path d="M2.5 4.5h11M6.2 4.5V3a1 1 0 011-1h1.6a1 1 0 011 1v1.5M6.8 7.5v4M9.2 7.5v4M3.8 4.5l.6 8.2a1 1 0 001 .8h5.2a1 1 0 001-.8l.6-8.2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button on:click={() => selectedFolder = null} aria-label="Close" class="w-7 h-7 flex items-center justify-center bg-transparent border-none cursor-pointer text-lg" style="color: var(--rail-txt-3);">×</button>
      </div>
      {#if modalApps.length}
        <div class="grid grid-cols-4 gap-3">
          {#each modalApps as app (app.id)}
            <div class="relative">
              <AppCell {app} isLauncher={true} {theme} layout="grid" pinPos="-top-1 -right-1" isPinned={userPinned.includes(app.name)}
                on:open={() => openApp(app)} on:homeShortcut={() => requestHomeShortcut(app)} on:togglePin={() => togglePin(app)} />
              <button on:click={() => unassignApp(app.id)} aria-label="Remove from folder"
                class="absolute -top-1 -left-1 w-5 h-5 flex items-center justify-center rounded-full text-[13px] leading-none cursor-pointer z-10 [-webkit-tap-highlight-color:transparent]"
                style="background: var(--rail-flat); border: 0.5px solid var(--rail-border); color: var(--rail-txt-2);">−</button>
            </div>
          {/each}
        </div>
      {:else}
        <p class="text-[12px] italic text-center py-6 m-0" style="color: var(--rail-txt-3);">empty folder — drag apps here or delete it</p>
      {/if}
    </div>
  </div>
{/if}

<style>
  @keyframes spin { to { transform: rotate(360deg); } }
  .spinning { animation: spin 1s linear infinite; }

  .drag-ghost {
    position: fixed;
    transform: translate(-50%, -50%) scale(1.08);
    pointer-events: none;
    z-index: 9999;
    opacity: 0.92;
    filter: drop-shadow(0 8px 16px rgba(0,0,0,0.35));
  }

  .folder-tile { min-height: 84px; }
  .new-folder-tile { min-height: 84px; }
  .folder-tile:hover { border-color: var(--rail-border-hi); }
  .folder-drop {
    border-color: var(--rail-txt) !important;
    transform: scale(1.05);
    box-shadow: 0 0 0 2px var(--rail-txt);
  }

  .folder-modal-backdrop {
    position: fixed; inset: 0; z-index: 9990;
    background: rgba(0,0,0,0.45);
    backdrop-filter: blur(4px);
    display: flex; align-items: center; justify-content: center;
    padding: 20px;
  }
  .folder-modal {
    width: 100%; max-width: 400px; max-height: 80vh; overflow-y: auto;
    background: var(--rail-bg, var(--rail-flat));
    border: 0.5px solid var(--rail-border);
    border-radius: 20px;
    padding: 18px;
    box-shadow: 0 20px 60px rgba(0,0,0,0.5);
  }
</style>
