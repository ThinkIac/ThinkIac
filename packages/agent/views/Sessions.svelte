<script>
  import { onMount, onDestroy, createEventDispatcher } from 'svelte';
  import { api } from './api';
  import BagProgressRing from './BagProgressRing.svelte';
  import { bagProgress, bagStatus, hasBagSteps } from './lib/session_bag_progress.js';

  export let currentSessionId = 'default';
  export let refreshTrigger = 0;
  export let activeIsApp = false;
  export let onNewTopic = () => {};

  const dispatch = createEventDispatcher();

  let sessions = [];
  let loading = false;
  let initialLoaded = false;
  let fetchError = false;
  let deletingId = null;
  let selectingId = null;
  let bagsBySession = {};
  let debounceTimer = null;
  let searchTimer = null;
  let searchOpen = false;
  let searchQuery = '';
  let searchResults = [];
  let searching = false;
  let searchInput;

  const PAGE_SIZE = 4;
  const SWIPE_THRESHOLD = 48;
  let currentPage = 0;
  let touchStartX = null;

  $: isSearching = searchOpen && searchQuery.trim().length >= 2;
  $: displayedSessions = isSearching ? searchResults : sessions;
  $: pageCount = Math.max(1, Math.ceil(displayedSessions.length / PAGE_SIZE));
  $: if (currentPage >= pageCount) currentPage = pageCount - 1;
  $: pageStart = currentPage * PAGE_SIZE;
  $: visibleSessions = displayedSessions.slice(pageStart, pageStart + PAGE_SIZE);

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

  // Debounce: refreshTrigger é bumpado em rajadas pelo Home (envio, troca de
  // aba, etc.) — coalesce para uma única chamada.
  $: if (refreshTrigger > 0) scheduleLoad();

  function scheduleLoad() {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(loadSessions, 300);
  }

  function toggleSearch() {
    searchOpen = !searchOpen;
    if (!searchOpen) {
      searchQuery = '';
      searchResults = [];
      searching = false;
      currentPage = 0;
      clearTimeout(searchTimer);
      return;
    }
    setTimeout(() => searchInput?.focus(), 0);
  }

  function handleSearchInput() {
    currentPage = 0;
    clearTimeout(searchTimer);
    const query = searchQuery.trim();
    if (query.length < 2) {
      searchResults = [];
      searching = false;
      return;
    }
    searchResults = [];
    searchTimer = setTimeout(() => searchSessions(query), 180);
  }

  async function searchSessions(query) {
    searching = true;
    const data = await api(`/sessions/search?q=${encodeURIComponent(query)}`, 'GET');
    // Não deixa uma resposta lenta substituir o termo que a pessoa já alterou.
    if (query === searchQuery.trim()) searchResults = Array.isArray(data) ? data : [];
    if (query === searchQuery.trim()) searching = false;
  }

  function handleSearchKeydown(event) {
    if (event.key === 'Escape') toggleSearch();
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
    loading = true;
    const [data] = await Promise.all([
      api('/sessions/list', 'GET'),
      loadBags()
    ]);

    if (Array.isArray(data)) {
      sessions = data;
      fetchError = false;
      initialLoaded = true;
    } else {
      fetchError = true;
      initialLoaded = true;
    }
    loading = false;
  }

  async function loadBags() {
    try {
      const data = await api('/list/by-session', 'GET', null, 'bags');
      bagsBySession = (data && data.success && data.bags) ? data.bags : {};
    } catch {
      bagsBySession = {};
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
    selectingId = sessionId;
    try {
      const data = await api(`/sessions/${sessionId}/history?limit=all`, 'GET');
      const history = Array.isArray(data) ? data : (data?.messages ?? []);

      if (typeof localStorage !== 'undefined') localStorage.setItem('current_sessionId', sessionId);

      dispatch('selectSession', { sessionId, history });
    } finally {
      if (selectingId === sessionId) selectingId = null;
    }
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

  // ── Configuração do título automático ──────────────────────────────────────
  // O modelo que resume mora em sessions.title.model; as opções vêm das pools
  // que o tenant já configurou (core/session_title_settings.js). Só carrega
  // quando o painel abre — a lista de sessões não paga por isso.
  let showTitleConfig = false;
  let titleCfg = null;
  let titleCfgLoading = false;
  let titleCfgSaving = false;
  let titleCfgError = '';

  $: groupedModelOptions = titleCfg
    ? [...new Set(titleCfg.options.map(o => o.group))].map(group => ({
        group,
        options: titleCfg.options.filter(o => o.group === group)
      }))
    : [];

  async function toggleTitleConfig() {
    showTitleConfig = !showTitleConfig;
    if (showTitleConfig && !titleCfg) await loadTitleConfig();
  }

  async function loadTitleConfig() {
    titleCfgLoading = true;
    titleCfgError = '';
    const data = await api('/sessions/title-config', 'GET');
    if (data && Array.isArray(data.options)) titleCfg = data;
    else titleCfgError = 'Could not load title settings.';
    titleCfgLoading = false;
  }

  async function saveTitleConfig(patch) {
    titleCfgSaving = true;
    titleCfgError = '';
    const data = await api('/sessions/title-config', 'POST', patch);
    // O servidor devolve o estado já resolvido — adota a resposta em vez do
    // otimismo local, senão um valor recusado ficaria aparecendo como salvo.
    if (data && Array.isArray(data.options)) titleCfg = data;
    else titleCfgError = data?.error || 'Could not save title settings.';
    titleCfgSaving = false;
  }

  onMount(loadSessions);
  onDestroy(() => {
    clearTimeout(debounceTimer);
    clearTimeout(searchTimer);
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
        class:active={searchOpen}
        on:click={toggleSearch}
        title="Search conversations"
        aria-label="Search conversations"
        aria-expanded={searchOpen}
      >
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
          <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/>
          <path d="m16 16 4 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
        </svg>
      </button>
      <button
        class="icon-action"
        class:active={showTitleConfig}
        on:click={toggleTitleConfig}
        title="Automatic title settings"
        aria-label="Automatic title settings"
        aria-expanded={showTitleConfig}
      >
        <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
          <circle cx="8" cy="8" r="2.1" stroke="currentColor" stroke-width="1.4"/>
          <path d="M8 1.6v1.8M8 12.6v1.8M14.4 8h-1.8M3.4 8H1.6M12.5 3.5l-1.3 1.3M4.8 11.2l-1.3 1.3M12.5 12.5l-1.3-1.3M4.8 4.8L3.5 3.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
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

  {#if searchOpen}
    <div class="session-search" class:has-query={searchQuery.trim().length > 0}>
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <circle cx="11" cy="11" r="6.5"/><path d="m16 16 4 4"/>
      </svg>
      <input
        bind:this={searchInput}
        bind:value={searchQuery}
        on:input={handleSearchInput}
        on:keydown={handleSearchKeydown}
        type="search"
        placeholder="search conversations"
        aria-label="Search conversations"
      />
      {#if searching}
        <span class="search-loading" aria-label="Searching"></span>
      {:else if searchQuery}
        <button on:click={() => { searchQuery = ''; handleSearchInput(); }} aria-label="Clear search">×</button>
      {/if}
    </div>
  {/if}

  {#if showTitleConfig}
    <section class="title-settings" aria-label="Automatic title settings">
      {#if titleCfgLoading}
        <span class="settings-feedback">Loading settings…</span>
      {:else if titleCfg}
        <label class="settings-toggle">
          <span>Automatic titles</span>
          <input
            type="checkbox"
            checked={titleCfg.enabled}
            disabled={titleCfgSaving}
            on:change={(e) => saveTitleConfig({ enabled: e.currentTarget.checked })}
          />
        </label>

        <label class="settings-field">
          <span>Summary model</span>
          <select
            value={titleCfg.model}
            disabled={titleCfgSaving || !titleCfg.enabled}
            on:change={(e) => saveTitleConfig({ model: e.currentTarget.value })}
          >
            {#each groupedModelOptions as { group, options }}
              <optgroup label={group}>
                {#each options as o}
                  <option value={o.id}>{o.label}{o.poolEnabled ? '' : ' (pool disabled)'}</option>
                {/each}
              </optgroup>
            {/each}
          </select>
          {#if titleCfg.options.find(o => o.id === titleCfg.model)?.poolEnabled === false}
            <span class="field-note">
              This model pool is disabled. Enable it to use this route.
            </span>
          {:else}
            <span class="field-note">
              {titleCfg.options.find(o => o.id === titleCfg.model)?.description || ''}
            </span>
          {/if}
        </label>

        <label class="settings-row">
          <span>Update every N messages</span>
          <input
            type="number"
            min="1"
            value={titleCfg.every}
            disabled={titleCfgSaving || !titleCfg.enabled}
            on:change={(e) => saveTitleConfig({ every: Number(e.currentTarget.value) })}
          />
        </label>

        <div class="settings-source">
          <span>
            {titleCfg.source === 'default' ? `Default · ${titleCfg.defaultModel}` : 'Custom setting'}
          </span>
          {#if titleCfg.source === 'config'}
            <button
              class="restore-default"
              on:click={() => saveTitleConfig({ model: null })}
              disabled={titleCfgSaving}
            >Restore default</button>
          {/if}
        </div>
      {/if}

      {#if titleCfgError}
        <span class="settings-feedback error">{titleCfgError}</span>
      {/if}
    </section>
  {/if}

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
    {:else if displayedSessions.length === 0 && !fetchError}
      <div class="flex flex-col items-center gap-1.5 px-3 py-3.5 font-sans text-[11px] text-[var(--w30)]">
        <svg viewBox="0 0 24 24" fill="none" width="18" height="18" opacity=".3">
          <rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" stroke-width="1.3"/>
          <path d="M7 9h10M7 13h6" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
        </svg>
        <span>{isSearching ? 'No matching conversations' : 'No sessions'}</span>
      </div>
    {:else}
      {#each groupedSessions as { session: s, group, showGroupHeader }, i (s.id)}
        {@const active = s.id === currentSessionId}
        {@const bag = bagFor(s.id)}
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
            title={sessionLabel(s, bag)}
          >
            {#if selectingId === s.id}
              <span class="session-loading" role="status" aria-label="Loading session"></span>
            {:else if bag}
              <BagProgressRing progress={pct} status={st.key} />
            {:else}
              <span class="session-neutral" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <path d="M4 5.5h12v8H8l-3.5 2v-2H4v-8Z" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>
                  <path d="M7 8.5h6M7 11h3.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
                </svg>
              </span>
            {/if}

            <span class="session-copy">
              <span class="session-title">{sessionLabel(s, bag)}</span>
              <span class="session-meta">
                {#if isSearching && s.match}
                  <span class="search-match" title={s.match}>{s.match}</span>
                {:else}
                {#if bag}
                  {#if showSteps}
                    <span class="step-count">{bag.doneSteps}/{bag.totalSteps} steps</span>
                    <span class="meta-separator" aria-hidden="true"></span>
                  {/if}
                  <span class="status status-{st.key}">
                    <span class="status-mark" aria-hidden="true"></span>
                    {st.label}
                  </span>
                  <span class="meta-separator" aria-hidden="true"></span>
                {/if}
                <span>{formatDate(s.created_at)}</span>
                {/if}
              </span>
            </span>
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

  {#if displayedSessions.length > PAGE_SIZE}
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
    --tk-bg: var(--agent-bg);
    --tk-surface: var(--agent-surface);
    --tk-surface-2: var(--agent-surface2);
    --tk-border: var(--agent-border);
    --tk-border-hi: var(--agent-border-hi);
    --tk-text: var(--agent-text);
    --tk-muted: var(--agent-muted);
    --tk-muted-2: var(--agent-muted2);
    --tk-accent: var(--agent-text);
    --tk-on-accent: var(--agent-bg);
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

  .session-loading {
    box-sizing: border-box;
    width: 16px;
    height: 16px;
    flex: 0 0 16px;
    border: 1.5px solid var(--tk-border-hi);
    border-top-color: var(--tk-text);
    border-radius: 50%;
    animation: session-spin .7s linear infinite;
  }

  @keyframes session-spin { to { transform: rotate(360deg); } }

  @media (prefers-reduced-motion: reduce) {
    .session-loading { animation-duration: 1.4s; }
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

  /* Mesmo campo compacto usado na grade de apps do menu: ícone, campo limpo
     e botão de limpar ficam numa única faixa discreta. */
  .session-search {
    display: flex;
    height: 32px;
    align-items: center;
    gap: 8px;
    margin: 0 12px 2px;
    border: .5px solid var(--tk-border);
    border-bottom-color: var(--tk-border-hi);
    border-radius: var(--tk-radius-md);
    background: var(--tk-surface);
    padding: 0 10px;
    color: var(--tk-muted);
    transition: border-color 150ms ease-out;
  }

  .session-search:focus-within { border-color: var(--tk-border-hi); color: var(--tk-text); }
  .session-search > svg { width: 13px; height: 13px; flex: 0 0 13px; stroke: currentColor; stroke-width: 2; stroke-linecap: round; stroke-linejoin: round; }
  .session-search input {
    min-width: 0;
    flex: 1;
    border: 0;
    outline: 0;
    background: transparent;
    color: var(--tk-text);
    font-family: var(--tk-font);
    font-size: 11px;
  }
  .session-search input::placeholder { color: var(--tk-muted); opacity: .55; }
  .session-search button {
    width: 18px;
    height: 18px;
    flex: 0 0 18px;
    border: 0;
    border-radius: 5px;
    background: transparent;
    padding: 0;
    color: var(--tk-muted);
    font: 16px/1 var(--tk-font);
    cursor: pointer;
  }
  .session-search button:hover { color: var(--tk-text); background: var(--tk-surface-2); }
  .search-loading {
    width: 10px;
    height: 10px;
    flex: 0 0 10px;
    border: 1.4px solid var(--tk-border-hi);
    border-top-color: var(--tk-text);
    border-radius: 50%;
    animation: session-spin .7s linear infinite;
  }

  .title-settings {
    display: flex;
    flex-direction: column;
    gap: 11px;
    margin: 0 12px 4px;
    padding: 5px 0 9px;
    border-bottom: 1px solid var(--tk-border);
    background: transparent;
    color: var(--tk-muted);
    font-family: var(--tk-font);
    font-size: 10.5px;
  }

  .settings-toggle,
  .settings-row,
  .settings-source {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
  }

  .settings-toggle {
    color: var(--tk-text);
    font-size: 11.5px;
    font-weight: 500;
    cursor: pointer;
  }

  .settings-toggle input {
    width: 14px;
    height: 14px;
    margin: 0;
    accent-color: var(--tk-accent);
    cursor: pointer;
  }

  .settings-field {
    display: flex;
    flex-direction: column;
    gap: 6px;
  }

  .settings-field > span:first-child,
  .settings-row > span:first-child {
    color: var(--tk-muted);
    font-size: 10.5px;
    font-weight: 400;
  }

  .settings-field select,
  .settings-row input {
    box-sizing: border-box;
    height: 29px;
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    background: var(--tk-surface);
    color: var(--tk-text);
    font-family: var(--tk-font);
    font-size: 10.5px;
    outline: none;
  }

  .settings-field select {
    width: 100%;
    padding: 0 8px;
  }

  .settings-row input {
    width: 48px;
    padding: 0 7px;
    font-family: var(--tk-mono);
    text-align: right;
  }

  .settings-field select:focus,
  .settings-row input:focus { border-color: var(--tk-border-hi); }
  .settings-field select:disabled,
  .settings-row input:disabled,
  .settings-toggle input:disabled { opacity: .4; cursor: not-allowed; }

  .field-note,
  .settings-feedback {
    color: var(--tk-muted);
    font-size: 9.5px;
    line-height: 1.35;
  }

  .settings-feedback.error { color: var(--tk-text); }

  .settings-source {
    color: var(--tk-muted-2);
    font-size: 9.5px;
  }

  .restore-default {
    border: 0;
    background: transparent;
    padding: 2px 0;
    color: var(--tk-muted);
    font-family: var(--tk-font);
    font-size: 9.5px;
    text-decoration: underline;
    text-decoration-color: var(--tk-border-hi);
    text-underline-offset: 3px;
    cursor: pointer;
  }

  .restore-default:hover { color: var(--tk-text); }
  .restore-default:disabled { opacity: .4; cursor: wait; }

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

  .search-match {
    overflow: hidden;
    color: var(--tk-muted);
    text-overflow: ellipsis;
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
  .shimmer {
    position: relative;
    overflow: hidden;
    animation: pulse-soft 1.2s ease-out infinite;
  }
</style>
