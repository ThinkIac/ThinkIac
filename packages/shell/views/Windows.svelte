<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { api } from './api';
  import SlateIcon from './components/SlateIcon.svelte';

  export let appTabs = [];
  export let activeTab = '';
  export let chatTabs = [];
  export let currentSessionId = "";
  export let refreshTrigger = 0;
  // Tema ativo — seleciona a variante `manifest.iconDark` quando dark.
  export let theme = 'dark';

  const dispatch = createEventDispatcher();
  const PAGE_SIZE = 6;

  let allSessions = [];
  let loadingSessions = false;
  let page = 0;
  let pointerStart = null;
  let longPressTimer = null;
  let draggingId = null;
  // `pointerup` is the primary activation path because a few embedded
  // WebViews cancel the following synthetic click. Keep its duplicate guard
  // short-lived: a permanent boolean makes the next real tap disappear when
  // that synthetic click is absent.
  let suppressClickUntil = 0;
  let closeAllConfirmOpen = false;

  async function loadSessions() {
    loadingSessions = true;
    const data = await api('/sessions/list', 'GET');
    const raw = Array.isArray(data) ? data : [];
    allSessions = raw.sort((a, b) => {
      const da = a.created_at || a.updated_at || '';
      const db = b.created_at || b.updated_at || '';
      return db.localeCompare(da);
    });
    loadingSessions = false;
  }

  $: if (refreshTrigger > 0) loadSessions();
  onMount(loadSessions);

  function selectApp(id) { dispatch('selectApp', id); }
  function selectCard(event, id) {
    if (event.timeStamp <= suppressClickUntil) return;
    selectApp(id);
  }
  function closeApp(e, id) { e.stopPropagation(); dispatch('closeApp', id); }
  function requestCloseAllApps() { closeAllConfirmOpen = true; }
  function cancelCloseAllApps() { closeAllConfirmOpen = false; }
  function confirmCloseAllApps() {
    closeAllConfirmOpen = false;
    dispatch('closeAllApps');
  }
  function selectChat(id) { dispatch('selectChat', id); }
  function selectSession(id) { dispatch('selectChat', id); }

  async function deleteSession(sessionId) {
    await api(`/sessions/${sessionId}`, 'DELETE');
    dispatch('closeChat', sessionId);
    loadSessions();
  }

  function closeChat(e, id) { e.stopPropagation(); dispatch('closeChat', id); }
  function changePage(direction) { page = Math.max(0, Math.min(pageCount - 1, page + direction)); }
  function clearLongPress() {
    if (longPressTimer !== null) clearTimeout(longPressTimer);
    longPressTimer = null;
  }
  function pointerDown(event, id) {
    if (event.button !== undefined && event.button !== 0) return;
    const card = event.currentTarget;
    pointerStart = { id, x: event.clientX, y: event.clientY, pointerId: event.pointerId };
    // A swipe commonly ends outside the card where it began. Capture from the
    // first contact so its pointerup is still received and page navigation can
    // reliably go both ways. The capture is released by the browser on up.
    card?.setPointerCapture?.(event.pointerId);
    clearLongPress();
    longPressTimer = setTimeout(() => {
      draggingId = id;
      suppressClickUntil = performance.now() + 550;
    }, 420);
  }
  function pointerMove(event) {
    if (!pointerStart || event.pointerId !== pointerStart.pointerId) return;
    if (!draggingId && Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 10) clearLongPress();
  }
  function pointerEnd(event) {
    if (!pointerStart || event.pointerId !== pointerStart.pointerId) return;
    clearLongPress();
    const dx = event.clientX - pointerStart.x;
    const wasDragging = draggingId;
    if (wasDragging) {
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest?.('[data-tab-id]');
      const targetId = target?.dataset?.tabId;
      if (targetId && targetId !== wasDragging) dispatch('reorderApps', { id: wasDragging, targetId });
      draggingId = null;
    } else if (Math.abs(dx) > 48) {
      changePage(dx < 0 ? 1 : -1);
      suppressClickUntil = performance.now() + 550;
    } else {
      // Do not rely exclusively on the synthetic click produced after pointer
      // capture. Some embedded/mobile browsers cancel that click after a card
      // has already been activated once, leaving the Workstation unable to
      // restore an existing package tab. A stationary pointer release is the
      // activation itself. Ignore only its immediate follow-up click, so a
      // later genuine tap is never swallowed if that synthetic click is lost.
      selectApp(pointerStart.id);
      suppressClickUntil = performance.now() + 550;
    }
    pointerStart = null;
  }
  function pointerCancel(event) {
    if (!pointerStart || event.pointerId !== pointerStart.pointerId) return;
    clearLongPress();
    draggingId = null;
    pointerStart = null;
  }

  const TAB_ICONS = {
    chat: `<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>`,
    globe: `<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10A15.3 15.3 0 0 1 8 12 15.3 15.3 0 0 1 12 2z"/>`,
    bot:  `<rect x="3" y="11" width="18" height="10" rx="2"/><circle cx="9" cy="16" r="1"/><circle cx="15" cy="16" r="1"/><path d="M12 3a2 2 0 0 1 2 2v6H10V5a2 2 0 0 1 2-2z"/>`,
  };

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const str = typeof dateStr === 'string' ? dateStr : JSON.stringify(dateStr);
    try {
      const d = new Date(str);
      const now = new Date();
      const diff = now - d;
      if (diff < 60_000) return 'agora';
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
      return d.toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' });
    } catch { return ''; }
  }

  function shortId(id) {
    if (!id) return '—';
    const str = typeof id === 'string' ? id : JSON.stringify(id);
    return str.length > 14 ? str.slice(0, 6) + '…' + str.slice(-4) : str;
  }

  function iconSvg(name) {
    const p = TAB_ICONS[name] || TAB_ICONS['globe'];
    return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">${p}</svg>`;
  }

  $: pageCount = Math.max(1, Math.ceil(appTabs.length / PAGE_SIZE));
  $: if (page > pageCount - 1) page = pageCount - 1;
  $: visibleApps = appTabs.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
  // Once the workstation has more than one visual row, every page reserves
  // the same 2 × 3 list footprint. This keeps page two from collapsing when,
  // for example, there is only a seventh app. Small collections remain compact.
  $: gridSlots = appTabs.length > 3
    ? [...visibleApps, ...Array(PAGE_SIZE - visibleApps.length).fill(null)]
    : visibleApps;
  $: hasAnything = appTabs.length > 0 || chatTabs.length > 1 || allSessions.length > 0;
</script>

<div class="windows-panel">
  {#if !hasAnything}
    <div class="empty-state">
      <div class="empty-icon">
        <svg viewBox="0 0 48 48" fill="none" width="36" height="36" opacity=".2">
          <rect x="4" y="10" width="40" height="30" rx="4" stroke="currentColor" stroke-width="1.5"/>
          <path d="M4 17h40" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
          <rect x="8" y="10" width="10" height="5" rx="1" fill="currentColor" opacity=".5"/>
        </svg>
      </div>
      <p class="empty-text">No windows open</p>
      <p class="empty-sub">Open an app to get started</p>
    </div>
  {:else}
    <!-- Apps abertos em lista 2 × 3, sem expor a URL interna. -->
    {#if appTabs.length > 0}
      <div class="windows-grid" class:fixed-rows={appTabs.length > 3}>
        {#each gridSlots as app, index (app ? app.id : `placeholder-${index}`)}
          {#if app}
          <div
            class="window-card"
            class:dragging={draggingId === app.id}
            data-tab-id={app.id}
            on:click={(event) => selectCard(event, app.id)}
            on:pointerdown={(event) => pointerDown(event, app.id)}
            on:pointermove={pointerMove}
            on:pointerup={pointerEnd}
            on:pointercancel={pointerCancel}
            role="button"
            tabindex="0"
          >
            <span class="window-icon" aria-hidden="true">
              {#if app.icon || app.iconSvg || app.iconDark || app.iconDarkSvg}
                <SlateIcon {app} {theme} size={24} radius={6} />
              {:else if app.name === 'Agent'}
                <span class="footer-sigma">Σ</span>
              {:else}
                <span class="text-[11px] font-semibold">{(app.name || '?')[0].toUpperCase()}</span>
              {/if}
            </span>
            <span class="window-name" title={app.name}>{app.name}</span>
            <button
              class="window-close"
              on:pointerdown|stopPropagation
              on:click={(e) => closeApp(e, app.id)}
              aria-label="Close {app.name}"
            >
              <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="9" height="9">
                <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
              </svg>
            </button>
          </div>
          {:else}
            <div class="window-card-placeholder" aria-hidden="true"></div>
          {/if}
        {/each}
      </div>
      <div class="windows-footer">
        {#if pageCount > 1}
          <div class="pagination" aria-label="Open apps pagination">
            <button class="page-button" on:click={() => changePage(-1)} disabled={page === 0} aria-label="Previous page">‹</button>
            <span class="page-status">{page + 1} / {pageCount}</span>
            <button class="page-button" on:click={() => changePage(1)} disabled={page === pageCount - 1} aria-label="Next page">›</button>
          </div>
        {:else}<span></span>{/if}
        {#if closeAllConfirmOpen}
          <div class="close-all-inline" role="group" aria-label="Confirm closing all apps">
            <button type="button" class="close-all-inline-confirm" on:click={confirmCloseAllApps}>Confirm</button>
            <button type="button" class="close-all-inline-cancel" on:click={cancelCloseAllApps}>Cancel</button>
          </div>
        {:else}
          <button class="dock-clear" on:click={requestCloseAllApps} aria-label="Close all apps">Close all</button>
        {/if}
      </div>
    {/if}
  {/if}
</div>

<style>
.windows-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  container-type: inline-size;
}

.windows-footer { display: flex; align-items: center; justify-content: space-between; min-height: 24px; }
.pagination { display: flex; align-items: center; gap: 7px; }
.page-button { width: 24px; height: 24px; padding: 0; border: 0; border-radius: 6px; background: transparent; color: var(--rail-txt-2); font-size: 19px; line-height: 1; cursor: pointer; }
.page-button:hover:not(:disabled) { background: var(--rail-flat-hover); }
.page-button:disabled { opacity: .35; cursor: default; }
.page-status { min-width: 34px; text-align: center; color: var(--rail-txt-3); font-size: 11px; }

.dock-clear {
  display: flex;
  min-height: 26px;
  padding: 0 9px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--rail-border-hi);
  border-radius: 6px;
  background: transparent;
  color: var(--rail-txt-2);
  font: 600 10px var(--font-body);
  cursor: pointer;
  opacity: .9;
  transition: transform 200ms ease-out, opacity 200ms ease-out, background 200ms ease-out;
}
.dock-clear:hover { opacity: 1; background: var(--rail-flat-hover); color: var(--rail-txt); }
.dock-clear:active { transform: scale(.94); }
.close-all-inline { display: flex; align-items: center; gap: 4px; min-height: 24px; color: var(--rail-txt-3); font: 500 11px var(--font-body); white-space: nowrap; }
.close-all-inline button { min-height: 23px; border-radius: 6px; padding: 0 7px; border: 1px solid transparent; background: transparent; color: var(--rail-txt-2); font: 600 10px var(--font-body); cursor: pointer; }
.close-all-inline-confirm { background: var(--rail-txt) !important; color: var(--rail-surface) !important; }
.close-all-inline button:hover, .close-all-inline button:focus-visible { background: var(--rail-flat-hover); color: var(--rail-txt); outline: none; }
.close-all-inline-confirm:hover, .close-all-inline-confirm:focus-visible { opacity: .86; background: var(--rail-txt) !important; color: var(--rail-surface) !important; }

.empty-state {
  display: flex; flex-direction: column; align-items: center;
  gap: 8px; padding: 32px 16px;
  text-align: center;
}
.empty-icon { margin-bottom: 4px; color: var(--rail-txt-3); }
.empty-text {
  font-size: 13px; font-weight: 500; color: var(--rail-txt-2);
}
.empty-sub {
  font-size: 11px; color: var(--rail-txt-3);
}

.windows-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
}
.windows-grid.fixed-rows { grid-template-rows: repeat(3, minmax(44px, auto)); }
.window-card-placeholder { min-height: 44px; visibility: hidden; }

/* Flat list cards use only a light hover elevation. */
.window-card {
  display: flex; align-items: center;
  min-height: 44px;
  gap: 9px;
  padding: 8px 9px;
  border-radius: 9px;
  background: var(--rail-flat);
  border: 1px solid var(--rail-border);
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  -webkit-tap-highlight-color: transparent;
  touch-action: pan-y;
}
.window-card:hover {
  border-color: var(--rail-border-hi);
  box-shadow: 0 2px 12px -4px rgba(0,0,0,0.18);
  background: var(--rail-flat-hover);
}
.window-card:active {
  transform: scale(0.97);
  background: var(--rail-active);
}
.window-card.dragging { opacity: .48; outline: 1px dashed var(--rail-border-hi); cursor: grabbing; }
.window-icon {
  display: flex; align-items: center; justify-content: center;
  width: 24px; height: 24px;
  flex-shrink: 0;
  border-radius: 6px;
  overflow: hidden;
}
.window-icon img {
  width: 100%; height: 100%;
  object-fit: cover;
  border-radius: 4px;
}
.footer-sigma {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  background: #050505; color: #ffffff;
  font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
  font-size: 9px;
}
.window-name {
  flex: 1; min-width: 0; font-size: 11px; line-height: 1.22; color: var(--rail-txt-2);
  /* Nomes de pacote podem ser muito longos. O cartão deve preservar uma
     única linha estável, sem aumentar a sua altura nem empurrar o botão de
     fechar. O título continua disponível integralmente no atributo title. */
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--font-body);
}
.window-close {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 4px;
  border: none; background: transparent;
  color: var(--rail-txt-3); cursor: pointer; flex-shrink: 0;
  opacity: 0.5; padding: 0;
  transition: opacity 0.1s, background 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.window-card:hover .window-close, .window-card:focus-within .window-close { opacity: 0.8; }
.window-close:active { opacity: 1; background: var(--rail-flat-hover); }
</style>
