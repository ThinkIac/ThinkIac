<script>
  import { onMount } from 'svelte';
  // O Desktop é uma extensão do Shell: reutilizar seu composer evita que esta
  // superfície fique defasada quando a InputBar ganhar novos controles.
  import InputBar from '../InputBar.svelte';
  import { DEFAULT_AGENT_ID } from '../agents/catalog.js';
  import { requestForAgent } from '../agents/runtime.js';

  export let desktop = { theme: 'dark', mode: 'desktop', active: true };

  let value = '';
  let recentSessions = [];
  let loadingSessions = true;
  let composerSessionId = '';
  let activeAgentId = DEFAULT_AGENT_ID;

  function makeSessionId() {
    return `desktop-${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }

  async function loadRecentSessions() {
    try {
      const response = await requestForAgent(activeAgentId, '/sessions/list');
      const result = await response.json();
      const sessions = result?.data ?? result;
      recentSessions = Array.isArray(sessions) ? sessions.slice(0, 16) : [];
    } catch {
      recentSessions = [];
    } finally {
      loadingSessions = false;
    }
  }

  function sessionLabel(session) {
    return session.title || session.summary || 'Untitled conversation';
  }

  function sessionGroup(dateStr) {
    if (!dateStr) return 'Earlier';
    const date = new Date(dateStr);
    if (Number.isNaN(date.getTime())) return 'Earlier';
    const day = (value) => new Date(value.getFullYear(), value.getMonth(), value.getDate());
    const days = Math.round((day(new Date()) - day(date)) / 86_400_000);
    if (days <= 0) return 'Today';
    if (days === 1) return 'Yesterday';
    if (days <= 7) return 'Previous 7 days';
    return 'Earlier';
  }

  function sessionMeta(session) {
    const count = Number(session?.message_count || 0);
    if (!session?.created_at) return count ? `${count} messages` : 'Conversation';
    const date = new Date(session.created_at);
    if (Number.isNaN(date.getTime())) return count ? `${count} messages` : 'Conversation';
    const elapsed = Date.now() - date.getTime();
    const age = elapsed < 60_000 ? 'just now'
      : elapsed < 3_600_000 ? `${Math.floor(elapsed / 60_000)}m ago`
      : elapsed < 86_400_000 ? `${Math.floor(elapsed / 3_600_000)}h ago`
      : date.toLocaleDateString(undefined, { day: '2-digit', month: 'short' });
    return count ? `${age} · ${count} messages` : age;
  }

  $: groupedSessions = recentSessions.map((session, index) => {
    const group = sessionGroup(session.created_at);
    const previous = index > 0 ? sessionGroup(recentSessions[index - 1].created_at) : null;
    return { session, group, showGroupHeader: group !== previous };
  });

  function send(event) {
    const detail = event.detail;
    if (!detail?.text?.trim()) return;
    window.dispatchEvent(new CustomEvent('thinkiac:desktop-chat:send', {
      detail: { ...detail, sessionId: composerSessionId, agentId: activeAgentId },
    }));
    composerSessionId = makeSessionId();
  }

  function stop(event) {
    const sessionId = String(event?.detail || composerSessionId).trim();
    if (!sessionId) return;
    window.dispatchEvent(new CustomEvent('thinkiac:desktop-chat:stop', {
      detail: { sessionId, agentId: activeAgentId },
    }));
  }

  function openSession(sessionId) {
    window.dispatchEvent(new CustomEvent('thinkiac:desktop-chat:open-session', {
      detail: { sessionId },
    }));
  }

  onMount(() => {
    composerSessionId = makeSessionId();
    loadRecentSessions();
  });
</script>

<section class="desktop-chat" data-theme={desktop?.theme || 'dark'} aria-label="Chat">
  <div class="recent" aria-label="Recent conversations">
    <header class="sessions-header">
      <span>Recent conversations</span>
      {#if !loadingSessions}<small>{recentSessions.length}</small>{/if}
    </header>
    {#if loadingSessions}
      <p class="empty">Loading conversations…</p>
    {:else if recentSessions.length}
      <div class="session-list">
        {#each groupedSessions as { session, group, showGroupHeader } (session.id)}
          {#if showGroupHeader}
            <span class="session-group-label">{group}</span>
          {/if}
          <article class="session-card">
            <button type="button" class="session-open" on:click={() => openSession(session.id)} title={sessionLabel(session)}>
              <span class="session-neutral" aria-hidden="true">
                <svg viewBox="0 0 16 16" fill="none">
                  <path d="M3 3.75A1.75 1.75 0 014.75 2h6.5A1.75 1.75 0 0113 3.75v5.5A1.75 1.75 0 0111.25 11H8l-2.75 2v-2H4.75A1.75 1.75 0 013 9.25v-5.5z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/>
                </svg>
              </span>
              <span class="session-copy">
                <span class="session-title">{sessionLabel(session)}</span>
                <span class="session-meta">{sessionMeta(session)}</span>
              </span>
            </button>
          </article>
        {/each}
      </div>
    {:else}
      <p class="empty">Your recent conversations will appear here.</p>
    {/if}
  </div>

  {#if composerSessionId}
    <div class="composer">
      <InputBar
        bind:value
        sessionId={composerSessionId}
        on:send={send}
        on:stop={stop}
      />
    </div>
  {/if}
</section>

<style>
  [data-theme='dark'] { --tk-bg:#111111; --tk-surface:#181818; --tk-surface-2:#1f1f1f; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888888; --tk-muted-2:rgba(136,136,136,.5); --tk-accent:#f5f5f5; --tk-on-accent:#111111; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; }
  [data-theme='light'] { --tk-bg:#ffffff; --tk-surface:#f5f5f5; --tk-surface-2:#ececec; --tk-border:rgba(0,0,0,.10); --tk-border-hi:rgba(0,0,0,.18); --tk-text:#1a1a1a; --tk-muted:#666666; --tk-muted-2:rgba(0,0,0,.4); --tk-accent:#111111; --tk-on-accent:#ffffff; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; }
  .desktop-chat { display:flex; flex-direction:column; width:100%; max-width:768px; height:100%; min-height:0; margin:auto; color:var(--tk-text); font-family:var(--tk-font); }
  .recent { flex:1; min-height:0; padding:12px 16px 0; overflow:auto; }
  .sessions-header { display:flex; align-items:center; justify-content:space-between; min-height:30px; margin:0 0 5px; padding:0 10px 0 12px; color:var(--tk-muted); font-size:12px; font-weight:500; }
  .sessions-header small { font:400 11px var(--tk-mono); color:var(--tk-muted-2); }
  .session-list { display:flex; flex-direction:column; gap:2px; padding-bottom:12px; }
  .session-list::-webkit-scrollbar { width:2px; }
  .session-list::-webkit-scrollbar-thumb { background:var(--tk-border); border-radius:var(--tk-radius-md); }
  .session-group-label { padding:7px 12px 1px; color:var(--tk-muted); font:400 8px var(--tk-mono); letter-spacing:.12em; line-height:1.2; opacity:.58; text-transform:uppercase; }
  .session-card { min-height:56px; overflow:hidden; border:1px solid transparent; border-radius:var(--tk-radius-lg); background:transparent; color:var(--tk-muted); transition:transform 200ms ease-out,opacity 200ms ease-out; }
  .session-card:hover, .session-card:focus-within { border-color:var(--tk-border); background:var(--tk-surface); }
  .session-open { display:flex; width:100%; min-width:0; align-items:center; gap:10px; border:0; background:transparent; padding:7px 10px; color:inherit; font:inherit; text-align:left; cursor:pointer; }
  .session-open:focus-visible { outline:1px solid var(--tk-text); outline-offset:-3px; }
  .session-neutral { display:grid; width:40px; height:40px; flex:0 0 40px; place-items:center; border:1px solid var(--tk-border); border-radius:50%; background:var(--tk-surface); color:var(--tk-muted-2); }
  .session-neutral svg { width:17px; height:17px; }
  .session-copy { display:flex; min-width:0; flex:1; flex-direction:column; gap:3px; }
  .session-title { overflow:hidden; color:var(--tk-text); font-size:12px; font-weight:500; line-height:1.25; text-overflow:ellipsis; white-space:nowrap; }
  .session-meta { overflow:hidden; color:var(--tk-muted); font:400 9.5px var(--tk-mono); text-overflow:ellipsis; white-space:nowrap; }
  .empty { margin:0; padding:20px 12px; color:var(--tk-muted); font-size:13px; }
  .composer { flex:0 0 auto; width:100%; box-sizing:border-box; }
  .composer :global(.input-bar) { width:100%; }
  @media (max-width: 820px) { .recent { padding:10px 10px 0; } }
</style>
