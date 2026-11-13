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

  // A miniatura pinta o ícone como background-image, então só serve raster
  // (o svg inline não vira URL). O rodapé usa SlateIcon e cobre os dois casos.
  function themedRaster(app, mode) {
    if (mode === 'dark' && app?.iconDark) return app.iconDark;
    return app?.icon || null;
  }

  const dispatch = createEventDispatcher();

  let allSessions = [];
  let loadingSessions = false;

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
  function closeApp(e, id) { e.stopPropagation(); dispatch('closeApp', id); }
  function closeAllApps() { dispatch('closeAllApps'); }
  function selectChat(id) { dispatch('selectChat', id); }
  function selectSession(id) { dispatch('selectChat', id); }

  async function deleteSession(sessionId) {
    await api(`/sessions/${sessionId}`, 'DELETE');
    dispatch('closeChat', sessionId);
    loadSessions();
  }

  function closeChat(e, id) { e.stopPropagation(); dispatch('closeChat', id); }

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
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m atrás`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h atrás`;
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
    <!-- Dock: apps abertos com card + thumbnail de ícone real -->
    {#if appTabs.length > 0}
      <div class="section-header">
        <div class="section-label">Dock</div>
        <button
          class="dock-clear"
          on:click={closeAllApps}
          aria-label="Fechar todos os apps do Dock"
          title="Fechar todos os apps do Dock"
        >
          <svg viewBox="0 0 16 16" fill="none" width="13" height="13" aria-hidden="true">
            <path d="M3.5 4.5h9M6 2.5h4M5 4.5l.5 9h5l.5-9M6.8 7v4M9.2 7v4" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>
        </button>
      </div>
      <div class="windows-grid">
        {#each appTabs as app (app.id)}
          {@const isActive = app.id === activeTab}
          <div
            class="window-card"
            class:active={isActive}
            on:click={() => selectApp(app.id)}
            role="button"
            tabindex="0"
          >
            <!-- Thumbnail com ícone real do app -->
            <div class="window-thumb">
              <div class="window-thumb-inner">
                <div class="thumb-browser-bar">
                  <div class="thumb-dots">
                    <span></span><span></span><span></span>
                  </div>
                  <div class="thumb-url">{app.url ?? app.name}</div>
                </div>
                <div class="thumb-body">
                  <div class="thumb-app-icon" style={themedRaster(app, theme) ? `background-image: url(${themedRaster(app, theme)}); background-size: cover; background-position: center;` : ''}>
                    {#if themedRaster(app, theme)}
                      <!-- ícone já está como background -->
                    {:else if app.name === 'Agent'}
                      <span class="thumb-sigma">Σ</span>
                    {:else}
                      <span class="thumb-letter">{(app.name || '?')[0].toUpperCase()}</span>
                    {/if}
                  </div>
                  <span class="thumb-app-name">{app.name}</span>
                </div>
              </div>
              {#if isActive}
                <div class="active-ring"></div>
              {/if}
            </div>

            <div class="window-footer">
              <span class="window-icon">
                {#if app.icon || app.iconSvg || app.iconDark || app.iconDarkSvg}
                  <!-- SlateIcon já resolve a cascata por tema (dark svg → dark
                       raster → svg → raster); aqui só entra quando há algum
                       ícone, senão o Σ/letra abaixo continua sendo o fallback. -->
                  <SlateIcon {app} {theme} size={16} radius={3} />
                {:else}
                  {#if app.name === 'Agent'}
                    <span class="footer-sigma">Σ</span>
                  {:else}
                    <span class="text-[11px] font-semibold">{(app.name || '?')[0].toUpperCase()}</span>
                  {/if}
                {/if}
              </span>
              <span class="window-name">{app.name}</span>
              <button
                class="window-close"
                on:click={(e) => closeApp(e, app.id)}
                aria-label="Fechar {app.name}"
              >
                <svg viewBox="0 0 12 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" width="9" height="9">
                  <line x1="2" y1="2" x2="10" y2="10"/><line x1="10" y1="2" x2="2" y2="10"/>
                </svg>
              </button>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
.windows-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.section-label {
  font-family: var(--font-mono);
  font-size: 9px;
  font-weight: 500;
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: var(--rail-txt-3);
  padding-left: 2px;
}

.section-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  min-height: 24px;
}

.dock-clear {
  display: flex;
  width: 24px;
  height: 24px;
  align-items: center;
  justify-content: center;
  border: 0;
  border-radius: var(--tk-radius-md);
  background: transparent;
  color: var(--rail-txt-3);
  cursor: pointer;
  opacity: .7;
  transition: transform 200ms ease-out, opacity 200ms ease-out;
}
.dock-clear:hover { opacity: 1; }
.dock-clear:active { transform: scale(.94); }

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
  grid-template-columns: repeat(2, 1fr);
  gap: 10px;
}

/* Flat card, not Slate — a wide floating shadow read wrong on these
   thumbnail cards specifically (feedback from the design pass). Elevation
   here is just border + tint shift, with a light lift shadow on hover. */
.window-card {
  display: flex; flex-direction: column;
  border-radius: 12px;
  background: var(--rail-flat);
  border: 1px solid var(--rail-border);
  overflow: hidden;
  cursor: pointer;
  transition: border-color 0.2s, background 0.2s, box-shadow 0.2s;
  -webkit-tap-highlight-color: transparent;
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
.window-card.active {
  border-color: var(--rail-border-hi);
  background: var(--rail-active);
  box-shadow: 0 0 0 1px var(--rail-active-ring);
}

.window-thumb {
  position: relative;
  aspect-ratio: 16/9;
  overflow: hidden;
  background: var(--rail-surface);
}
.window-thumb-inner {
  display: flex; flex-direction: column;
  width: 100%; height: 100%;
}
.thumb-browser-bar {
  display: flex; align-items: center;
  padding: 5px 7px; gap: 5px;
  background: var(--rail-flat);
  border-bottom: 1px solid var(--rail-border);
  flex-shrink: 0;
}
.thumb-dots {
  display: flex; gap: 3px; flex-shrink: 0;
}
.thumb-dots span {
  width: 4px; height: 4px; border-radius: 50%;
  background: var(--rail-border-hi);
}
.thumb-url {
  flex: 1; font-size: 7px; color: var(--rail-txt-3);
  font-family: var(--font-mono);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.thumb-body {
  flex: 1; display: flex; flex-direction: column;
  align-items: center; justify-content: center; gap: 6px;
}
.thumb-app-icon {
  width: 24px; height: 24px; border-radius: 7px;
  background: var(--rail-flat-hover);
  border: 1px solid var(--rail-border);
  display: flex; align-items: center; justify-content: center;
  overflow: hidden;
}
/* Agent's brand chip — fills the icon box with its own black/white,
   independent of the theme-reactive rail colors around it (see the
   .sigma-mark rule in Home.svelte for the full-size version). */
.thumb-sigma {
  width: 100%; height: 100%; display: flex; align-items: center; justify-content: center;
  background: #050505; color: #ffffff;
  font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
  font-size: 11px;
}
.thumb-letter { font-size: 12px; font-weight: 500; color: var(--rail-txt-2); }
.thumb-app-name { font-size: 8px; color: var(--rail-txt-3); font-family: var(--font-mono); }

.active-ring {
  position: absolute; inset: 0;
  border: 1.5px solid var(--rail-border-hi);
  border-radius: 0;
  pointer-events: none;
}

.window-footer {
  display: flex; align-items: center;
  gap: 7px; padding: 8px 10px;
  border-top: 1px solid var(--rail-border);
}
.window-icon {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px;
  flex-shrink: 0;
  border-radius: 5px;
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
  flex: 1; font-size: 11px; color: var(--rail-txt-2);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  font-family: var(--font-body);
}
.window-card.active .window-name { color: var(--rail-txt); }
.window-close {
  display: flex; align-items: center; justify-content: center;
  width: 18px; height: 18px; border-radius: 4px;
  border: none; background: transparent;
  color: var(--rail-txt-3); cursor: pointer; flex-shrink: 0;
  opacity: 0.5; padding: 0;
  transition: opacity 0.1s, background 0.1s;
  -webkit-tap-highlight-color: transparent;
}
.window-card:hover .window-close { opacity: 0.8; }
.window-close:active { opacity: 1; background: var(--rail-flat-hover); }
</style>
