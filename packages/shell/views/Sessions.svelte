<script>
  import { onMount, createEventDispatcher } from 'svelte';
  import { api } from './api';
  import BagProgressRing from './BagProgressRing.svelte';
  import { bagProgress, bagStatus, hasBagSteps } from './lib/session_bag_progress.js';
  import { readFavoriteSessions, toggleFavoriteSession, writeFavoriteSessions } from './lib/favorite_sessions.js';
  import { hasSessionActivity, hasSessionUpdate, isSessionWorking } from './lib/session_activity.js';

  export let currentSessionId = 'default';
  export let refreshTrigger = 0;
  export let activeIsApp = false;
  // Fonte canônica também usada pelo widget Conversations. Estes mapas chegam
  // com cada evento de stream, antes mesmo da persistência da lista histórica.
  export let loadingMap = {};
  export let unreadMap = {};
  export let onNewTopic = () => {};

  const dispatch = createEventDispatcher();

  let sessions = [];
  let loading = false;
  let initialLoaded = false;
  let fetchError = false;
  let deletingId = null;
  let openingSessionId = null;
  let favoriteSessionIds = [];
  let favoritesOnly = false;
  let activityOnly = false;
  let bagsBySession = {};
  let debounceTimer = null;
  let loadGeneration = 0;
  const SESSIONS_CACHE_KEY = 'shell:sessions-cache:v1';
  const MAX_CACHED_SESSIONS = 200;

  function restoreSessionsCache() {
    if (typeof localStorage === 'undefined') return false;
    try {
      const cached = JSON.parse(localStorage.getItem(SESSIONS_CACHE_KEY) || 'null');
      if (!Array.isArray(cached)) return false;
      sessions = cached;
      initialLoaded = true;
      return true;
    } catch {
      return false;
    }
  }

  function saveSessionsCache(nextSessions) {
    if (typeof localStorage === 'undefined') return;
    // É somente um fallback para abrir a lista enquanto a API responde.
    // Histórico completo pertence ao Runtime, não ao armazenamento do browser.
    try { localStorage.setItem(SESSIONS_CACHE_KEY, JSON.stringify(nextSessions.slice(0, MAX_CACHED_SESSIONS))); } catch {}
  }

  const PAGE_SIZE = 4;
  const SWIPE_THRESHOLD = 48;
  let currentPage = 0;
  let touchStartX = null;

  $: filteredSessions = sessions.filter((session) => (
    (!favoritesOnly || favoriteSessionIds.includes(session.id))
    && (!activityOnly || hasSessionActivity(session.id, loadingMap, unreadMap))
  ));
  $: pageCount = Math.max(1, Math.ceil(filteredSessions.length / PAGE_SIZE));
  $: if (currentPage >= pageCount) currentPage = pageCount - 1;
  $: pageStart = currentPage * PAGE_SIZE;
  $: visibleSessions = filteredSessions.slice(pageStart, pageStart + PAGE_SIZE);

  // Date grouping gives the session list a lightweight visual structure.
  function sessionGroup(dateStr) {
    if (!dateStr) return 'Earlier';
    const str = typeof dateStr === 'string' ? dateStr : JSON.stringify(dateStr);
    const d = new Date(str);
    if (isNaN(d)) return 'Earlier';
    const startOfDay = (dt) => new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    const diffDays = Math.round((startOfDay(new Date()) - startOfDay(d)) / 86_400_000);
    if (diffDays <= 0) return 'Today';
    if (diffDays === 1) return 'Yesterday';
    if (diffDays <= 7) return 'Previous 7 days';
    return 'Earlier';
  }
  $: groupedSessions = visibleSessions.map((s, i) => {
    const group = sessionGroup(s.created_at);
    const prevGroup = i > 0 ? sessionGroup(visibleSessions[i - 1].created_at) : null;
    return { session: s, group, showGroupHeader: group !== prevGroup };
  });

  // refreshTrigger chega em rajadas (stream + persistência). Coalescemos sem
  // adicionar uma latência perceptível ao evento já confirmado pelo Runtime.
  $: if (refreshTrigger > 0) scheduleLoad();

  function scheduleLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadSessions, 150);
  }

  function goToPage(nextPage) {
    currentPage = Math.max(0, Math.min(nextPage, pageCount - 1));
  }

  function handleTouchStart(event) {
    touchStartX = event.touches[0]?.clientX ?? null;
  }

  function handleTouchEnd(event) {
    if (touchStartX === null) return;
    const deltaX = event.changedTouches[0]?.clientX - touchStartX;
    touchStartX = null;
    if (Math.abs(deltaX) < SWIPE_THRESHOLD) return;

    event.preventDefault();
    goToPage(currentPage + (deltaX < 0 ? 1 : -1));
  }

  async function loadSessions() {
    const generation = ++loadGeneration;
    loading = true;
    try {
      const [data, bags] = await Promise.all([
        api('/sessions/list', 'GET', null, null, { timeoutMs: 12000 }),
        loadBags()
      ]);

      // Uma resposta velha não pode desfazer a lista recém-carregada após uma
      // segunda notificação do WebSocket ou um refresh manual.
      if (generation !== loadGeneration) return;
      bagsBySession = bags;
      if (Array.isArray(data)) {
        sessions = data;
        saveSessionsCache(data);
        fetchError = false;
      } else {
        fetchError = true;
      }
      initialLoaded = true;
    } catch (error) {
      if (generation !== loadGeneration) return;
      fetchError = true;
      initialLoaded = true;
      console.error('Failed to load sessions:', error);
    } finally {
      if (generation === loadGeneration) loading = false;
    }
  }

  async function loadBags() {
    try {
      const data = await api('/list/by-session', 'GET', null, 'bags', { timeoutMs: 12000 });
      return (data && data.success && data.bags) ? data.bags : {};
    } catch {
      return {};
    }
  }

  function bagFor(sessionId) {
    return bagsBySession[sessionId] || null;
  }

  async function selectSession(sessionId) {
    // Clicar numa sessão sempre deve trazer o chat pra frente — mesmo que
    // seja a mesma currentSessionId de antes, se o foco atual está num app
    // (activeIsApp), o clique precisa disparar o evento pra voltar pro chat.
    if (sessionId === currentSessionId && !activeIsApp) return;
    if (openingSessionId) return;
    openingSessionId = sessionId;
    try {
      const data = await api(`/sessions/${sessionId}/history`, 'GET');
      const history = Array.isArray(data) ? data : (data?.messages ?? []);

      if (typeof localStorage !== 'undefined') localStorage.setItem('current_sessionId', sessionId);
      dispatch('selectSession', { sessionId, history });
    } finally {
      openingSessionId = null;
    }
  }

  function toggleFavorite(sessionId) {
    favoriteSessionIds = toggleFavoriteSession(favoriteSessionIds, sessionId);
    writeFavoriteSessions(favoriteSessionIds);
  }

  async function deleteSession(sessionId) {
    deletingId = sessionId;
    await api(`/sessions/${sessionId}`, 'DELETE');
    deletingId = null;
    dispatch('deleteSession', { sessionId });
    loadSessions();
  }

  function formatDate(dateStr) {
    if (!dateStr) return '';
    const str = typeof dateStr === 'string' ? dateStr : JSON.stringify(dateStr);
    try {
      const d = new Date(str);
      const now = new Date();
      const diff = now - d;
      if (diff < 60_000) return 'just now';
      if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
      if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
      return d.toLocaleDateString('en-US', { day: '2-digit', month: 'short' });
    } catch { return ''; }
  }

  function shortId(id) {
    if (!id) return '—';
    const str = typeof id === 'string' ? id : JSON.stringify(id);
    return str.length > 14 ? str.slice(0, 6) + '…' + str.slice(-4) : str;
  }

  // Objetivo do bag ganha do título gerado (é o que o usuário mandou fazer);
  // o título automático só preenche o vazio onde antes só havia o id.
  function sessionLabel(s, bag) {
    if (bag?.objective) return bag.objective;
    return s?.title || shortId(s?.id);
  }

  onMount(() => {
    restoreSessionsCache();
    favoriteSessionIds = readFavoriteSessions();
    loadSessions();
  });
</script>

<div class="sessions-widget">
  <header class="sessions-header">
    <div class="sessions-actions">
      {#if fetchError}
        <span class="fetch-error" title="Refresh failed — showing the latest available list"></span>
      {/if}
      <button
        class="sessions-new-topic icon-action"
        on:click={onNewTopic}
        title="New topic"
        aria-label="New topic"
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="icon-action"
        class:active={favoritesOnly}
        on:click={() => { favoritesOnly = !favoritesOnly; currentPage = 0; }}
        title={favoritesOnly ? 'Show all sessions' : 'Show favorite sessions'}
        aria-label={favoritesOnly ? 'Show all sessions' : 'Show favorite sessions'}
        aria-pressed={favoritesOnly}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="M4 2.5h8v11L8 11.1 4 13.5v-11Z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        class="icon-action"
        class:active={activityOnly}
        on:click={() => { activityOnly = !activityOnly; currentPage = 0; }}
        title={activityOnly ? 'Show all sessions' : 'Show sessions working or with new responses'}
        aria-label={activityOnly ? 'Show all sessions' : 'Show sessions working or with new responses'}
        aria-pressed={activityOnly}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <rect x="3" y="5" width="10" height="7.5" rx="1" stroke="currentColor" stroke-width="1.3"/>
          <path d="M6 5V3.7c0-.66.54-1.2 1.2-1.2h1.6c.66 0 1.2.54 1.2 1.2V5M3 8h10M6.5 8v1.2h3V8" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <button
        class="icon-action"
        on:click={loadSessions}
        title="Refresh sessions"
        aria-label="Refresh sessions"
        disabled={loading}
      >
        <svg viewBox="0 0 16 16" fill="none" class:loading aria-hidden="true">
          <path d="M13 8A5 5 0 1 1 8 3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          <path d="M8 1l2.5 2L8 5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </div>
  </header>

  <!-- List -->
  <div
    class="session-list flex max-h-[300px] flex-col gap-1 overflow-y-auto"
    on:touchstart={handleTouchStart}
    on:touchend={handleTouchEnd}
  >
    {#if loading && !initialLoaded}
      {#each Array(3) as _, i}
        <div class="flex items-start gap-2.5 rounded-[10px] px-3 py-2.5" style="opacity: {1 - i * 0.28}">
          <div class="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--w10)]"></div>
          <div class="flex min-w-0 flex-1 flex-col gap-1.5">
            <div class="h-[10px] w-[62%] overflow-hidden rounded bg-[var(--w06)] shimmer"></div>
            <div class="h-[6px] w-[40%] overflow-hidden rounded bg-[var(--w06)] shimmer"></div>
          </div>
        </div>
      {/each}
    {:else if filteredSessions.length === 0 && !fetchError}
      <div class="flex flex-col items-center gap-1.5 px-3 py-3.5 font-sans text-[11px] text-[var(--w30)]">
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18" opacity=".3">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M7 9h10M7 13h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{activityOnly ? 'No active or updated sessions' : favoritesOnly ? 'No favorite sessions' : 'No sessions'}</span>
      </div>
    {:else}
      {#each groupedSessions as { session: s, group, showGroupHeader }, i (s.id)}
        {@const active = s.id === currentSessionId}
        {@const opening = s.id === openingSessionId}
        {@const favorite = favoriteSessionIds.includes(s.id)}
        {@const bag = bagFor(s.id)}
        {@const working = isSessionWorking(s.id, loadingMap)}
        {@const unread = hasSessionUpdate(s.id, unreadMap)}
        {@const pct = bagProgress(bag)}
        {@const showSteps = hasBagSteps(bag)}
        {@const st = bagStatus(bag?.status)}
        {#if showGroupHeader}
          <span class="session-group-label">{group}</span>
        {/if}
        <div
          class:active
          class="session-card group relative flex w-full will-change-[transform,opacity] animate-[item-in_.42s_ease-out_both]"
          style="animation-delay: {Math.min(i, 6) * 80}ms"
        >
          <button
            class="session-open"
            on:click={() => selectSession(s.id)}
            aria-current={active ? 'page' : undefined}
            aria-busy={opening}
            disabled={openingSessionId !== null}
            title={sessionLabel(s, bag)}
          >
            {#if bag}
              <BagProgressRing progress={pct} status={st.key} />
            {:else}
              <span
                class="session-neutral"
                class:session-neutral-opening={opening}
                class:session-neutral-working={!opening && working}
                class:session-neutral-unread={!opening && !working && unread}
                aria-label={opening ? 'Opening session' : working ? 'Response in progress' : unread ? 'New response' : undefined}
              >
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M4 5.5h12v8H8l-3.5 2v-2H4v-8Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
                  <path d="M7 8.5h6M7 11h3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
              </span>
            {/if}

            <span class="session-copy">
              <span class="session-title">{sessionLabel(s, bag)}</span>
              <span class="session-meta">
                {#if bag}
                  {#if showSteps}
                    <span class="step-count">{bag.doneSteps}/{bag.totalSteps} steps</span>
                  {/if}
                  <span class="status status-{st.key}">
                    <span class="status-mark" aria-hidden="true"></span>
                    {st.label}
                  </span>
                  <span class="meta-separator" aria-hidden="true"></span>
                {/if}
                <span>{formatDate(s.created_at)}</span>
              </span>
            </span>
          </button>

          <button
            class="session-favorite"
            class:active={favorite}
            on:click={() => toggleFavorite(s.id)}
            aria-label={favorite ? `Remove ${sessionLabel(s, bag)} from favorites` : `Add ${sessionLabel(s, bag)} to favorites`}
            aria-pressed={favorite}
            title={favorite ? 'Remove from favorites' : 'Add to favorites'}
          >
            <svg viewBox="0 0 16 16" aria-hidden="true">
              <path d="m8 1.9 1.8 3.65 4.03.58-2.92 2.85.69 4.03L8 11.16 4.4 13l.69-4.03L2.17 6.13l4.03-.58L8 1.9Z"/>
            </svg>
          </button>

          <button
            class="session-delete"
            on:click={() => deleteSession(s.id)}
            title="Delete session"
            aria-label={`Delete ${sessionLabel(s, bag)}`}
            disabled={deletingId === s.id}
          >
            {#if deletingId === s.id}
              <span class="h-[9px] w-[9px] rounded-full bg-current opacity-40 animate-[pulse-soft_1.1s_ease-in-out_infinite]"></span>
            {:else}
              <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
              </svg>
            {/if}
          </button>
        </div>
      {/each}
    {/if}
  </div>

  {#if filteredSessions.length > PAGE_SIZE}
    <nav class="session-pagination" aria-label="Sessions pagination">
      <button
        class="pagination-button"
        on:click={() => goToPage(currentPage - 1)}
        aria-label="Previous sessions page"
        title="Previous page"
        disabled={currentPage === 0}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m9.5 3.5-4 4.5 4 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
      <span class="pagination-status" aria-live="polite">{currentPage + 1} / {pageCount}</span>
      <button
        class="pagination-button"
        on:click={() => goToPage(currentPage + 1)}
        aria-label="Next sessions page"
        title="Next page"
        disabled={currentPage === pageCount - 1}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <path d="m6.5 3.5 4 4.5-4 4.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </button>
    </nav>
  {/if}
</div>

<style>
  .sessions-widget {
    --tk-bg: var(--aurora-bg);
    --tk-surface: var(--aurora-surface);
    --tk-surface-2: var(--aurora-surface2);
    --tk-border: var(--aurora-border);
    --tk-border-hi: var(--aurora-border-hi);
    --tk-text: var(--aurora-text);
    --tk-muted: var(--aurora-muted);
    --tk-muted-2: var(--aurora-muted2);
    --tk-accent: var(--aurora-text);
    --tk-on-accent: var(--aurora-bg);
    --tk-font: 'Ubuntu', system-ui, sans-serif;
    --tk-mono: 'Ubuntu Mono', monospace;
    display: flex;
    flex-direction: column;
    gap: 6px;
    font-family: var(--tk-font);
  }

  .sessions-header {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: flex-end;
    gap: 10px;
    padding: 0 10px 0 12px;
  }

  .fetch-error {
    width: 5px;
    height: 5px;
    border-radius: 50%;
    background: var(--tk-muted);
    opacity: .7;
  }

  .sessions-actions {
    display: flex;
    align-items: center;
    gap: 2px;
  }

  .icon-action {
    display: grid;
    width: 26px;
    height: 26px;
    place-items: center;
    border: 0;
    border-radius: var(--tk-radius-md);
    background: transparent;
    padding: 0;
    color: var(--tk-muted);
    cursor: pointer;
    transition: transform 200ms ease-out, opacity 200ms ease-out;
  }

  .icon-action:hover,
  .icon-action.active {
    background: var(--tk-surface);
    color: var(--tk-text);
  }

  .icon-action:focus-visible {
    outline: 1px solid var(--tk-text);
    outline-offset: -2px;
  }

  .icon-action:active { transform: scale(.94); }
  .icon-action:disabled { cursor: wait; opacity: .4; }
  .icon-action svg { width: 13px; height: 13px; }
  .icon-action svg.loading { animation: pulse-soft 1.1s ease-out infinite; }

  @media (pointer: coarse) {
    .icon-action {
      width: 30px;
      height: 30px;
    }
  }

  .session-list {
    scrollbar-width: thin;
    scrollbar-color: var(--tk-border) transparent;
    touch-action: pan-y;
  }

  .session-list::-webkit-scrollbar { width: 2px; }
  .session-list::-webkit-scrollbar-track { background: transparent; }
  .session-list::-webkit-scrollbar-thumb {
    border-radius: var(--tk-radius-md);
    background: var(--tk-border);
  }

  .session-group-label {
    display: block;
    padding: 7px 12px 1px;
    color: var(--tk-muted);
    font-family: var(--tk-mono);
    font-size: 8px;
    font-weight: 400;
    letter-spacing: .12em;
    line-height: 1.2;
    opacity: .58;
    text-transform: uppercase;
  }

  .session-pagination {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 8px;
    min-height: 25px;
    padding: 1px 10px 0;
  }

  .pagination-button {
    display: grid;
    width: 24px;
    height: 24px;
    place-items: center;
    border: 0;
    border-radius: var(--tk-radius-md);
    background: transparent;
    color: var(--tk-muted);
    cursor: pointer;
    transition: transform 200ms ease-out, opacity 200ms ease-out;
  }

  .pagination-button:hover { color: var(--tk-text); background: var(--tk-surface); }
  .pagination-button:active { transform: scale(.94); }
  .pagination-button:focus-visible { outline: 1px solid var(--tk-text); outline-offset: -2px; }
  .pagination-button:disabled { cursor: default; opacity: .3; }
  .pagination-button svg { width: 12px; height: 12px; }

  .pagination-status {
    min-width: 28px;
    color: var(--tk-muted);
    font-family: var(--tk-mono);
    font-size: 9px;
    font-variant-numeric: tabular-nums;
    opacity: .72;
    text-align: center;
  }

  .session-card {
    min-height: 56px;
    overflow: hidden;
    border: 1px solid transparent;
    border-radius: var(--tk-radius-lg);
    background: transparent;
    color: var(--tk-muted);
    transition: transform 200ms ease-out, opacity 200ms ease-out;
  }

  .session-card:hover,
  .session-card:focus-within {
    border-color: var(--tk-border);
    background: var(--tk-surface);
  }

  .session-card.active {
    border-color: var(--tk-border-hi);
    background: var(--tk-surface-2);
    color: var(--tk-text);
  }

  .session-open {
    display: flex;
    min-width: 0;
    flex: 1;
    align-items: center;
    gap: 10px;
    border: 0;
    background: transparent;
    padding: 7px 6px 7px 10px;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }

  .session-open:focus-visible,
  .session-favorite:focus-visible,
  .session-delete:focus-visible {
    outline: 1px solid var(--tk-text);
    outline-offset: -3px;
  }

  .session-neutral {
    display: grid;
    width: 40px;
    height: 40px;
    flex: 0 0 40px;
    place-items: center;
    border: 1px solid var(--tk-border);
    border-radius: 50%;
    background: var(--tk-surface);
    color: var(--tk-muted-2);
  }

  .active .session-neutral {
    border-color: var(--tk-border-hi);
    color: var(--tk-text);
  }

  .session-neutral svg {
    width: 19px;
    height: 19px;
  }

  /* O ícone é a referência visual permanente da sessão. Uma resposta pronta
     o deixa branco; durante a resposta, ele pulsa entre cinza e branco. */
  .session-neutral-unread {
    color: var(--tk-text);
  }

  /* Abrir uma conversa é uma ação diferente de o agente estar respondendo:
     o aro gira exatamente sobre a borda já existente, sem crescer para fora
     do círculo e sem substituir o ícone. */
  .session-neutral-opening {
    position: relative;
  }

  .session-neutral-opening::after {
    box-sizing: border-box;
    position: absolute;
    inset: 0;
    border: 1.5px solid var(--tk-border-hi);
    border-top-color: var(--tk-text);
    border-radius: inherit;
    content: '';
    animation: session-presence-spin .82s linear infinite;
    pointer-events: none;
  }

  .session-neutral-working {
    animation: session-response-pulse 1.05s ease-in-out infinite;
  }

  .session-copy {
    display: flex;
    min-width: 0;
    flex: 1;
    flex-direction: column;
    gap: 5px;
  }

  .session-title {
    overflow: hidden;
    color: var(--tk-text);
    font-family: var(--tk-font);
    font-size: 11.5px;
    font-weight: 500;
    line-height: 1.25;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .session-meta {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    overflow: hidden;
    color: var(--tk-muted);
    font-family: var(--tk-font);
    font-size: 9.5px;
    line-height: 1;
    white-space: nowrap;
  }

  .step-count {
    font-family: var(--tk-mono);
    font-variant-numeric: tabular-nums;
  }

  .meta-separator {
    width: 2px;
    height: 2px;
    flex: 0 0 2px;
    border-radius: 50%;
    background: var(--tk-muted-2);
  }

  .status {
    display: inline-flex;
    align-items: center;
    gap: 4px;
  }

  .status-mark {
    width: 5px;
    height: 5px;
    border: 1px solid currentColor;
    border-radius: 50%;
  }

  .status-active .status-mark,
  .status-complete .status-mark {
    background: currentColor;
  }

  .status-complete .status-mark { border-radius: 1px; }
  .status-paused .status-mark { border-radius: 0; }
  .status-failed .status-mark { transform: rotate(45deg); border-radius: 0; }

  .session-delete {
    display: grid;
    width: 26px;
    align-self: stretch;
    flex: 0 0 26px;
    place-items: center;
    border: 0;
    border-left: 1px solid transparent;
    background: transparent;
    padding: 0;
    color: var(--tk-muted-2);
    opacity: 0;
    cursor: pointer;
    transition: opacity 200ms ease-out, transform 200ms ease-out;
  }

  .session-favorite {
    display: grid;
    width: 26px;
    align-self: stretch;
    flex: 0 0 26px;
    place-items: center;
    border: 0;
    background: transparent;
    padding: 0;
    color: var(--tk-muted-2);
    cursor: pointer;
  }

  .session-favorite svg { width: 14px; height: 14px; fill: transparent; stroke: currentColor; stroke-width: 1.25; stroke-linejoin: round; }
  .session-favorite:hover, .session-favorite.active { color: var(--tk-text); }
  .session-favorite.active svg { fill: currentColor; }
  .session-favorite:active { transform: scale(.9); }

  .session-card:hover .session-delete,
  .session-card:focus-within .session-delete,
  .session-delete:disabled {
    border-left-color: var(--tk-border);
    opacity: 1;
  }

  .session-delete:hover { color: var(--tk-text); }
  .session-delete:active { transform: scale(.94); }
  .session-delete:disabled { cursor: wait; }

  @media (pointer: coarse) {
    .session-delete {
      width: 30px;
      flex-basis: 30px;
      opacity: .64;
    }
  }

  @keyframes item-in {
    from { opacity: 0; transform: translateY(6px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  @keyframes pulse-soft {
    0%, 100% { opacity: 0.25; }
    50%      { opacity: 0.7; }
  }
  @keyframes session-presence-spin { to { transform: rotate(360deg); } }
  @keyframes session-response-pulse {
    0%, 100% { color: var(--tk-muted-2); }
    50% { color: var(--tk-text); }
  }
  .shimmer {
    position: relative;
    overflow: hidden;
    animation: pulse-soft 1.2s ease-out infinite;
  }
</style>
