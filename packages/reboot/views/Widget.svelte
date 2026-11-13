<script>
  import { onMount } from "svelte";

  let theme = "dark";
  let health = null;
  let phase = "idle";
  let message = "";
  let impact = null;
  let basePid = null;
  let pollTimer = null;
  let restartWentOffline = false;
  let hasTasksPackage = false;
  let pendingAction = null;

  const RESTART_TIMEOUT_MS = 90000;

  function applyTheme(next) {
    theme = next === "light" ? "light" : "dark";
    // O fundo que sobra enquanto o iframe encolhe pertence ao documento dele,
    // não ao <main>. Espelhar o tema no root mantém essa superfície coerente.
    if (typeof document !== "undefined") {
      document.documentElement.dataset.theme = theme;
    }
  }

  function readTheme() {
    applyTheme(localStorage.getItem("think:theme"));
  }

  function emitShellLoading(active) {
    parent.postMessage({
      source: "thinkiac-shell",
      type: "shell:loading",
      detail: {
        active,
        id: "runtime-restart",
      },
    }, "*");
  }

  function reloadShell(id) {
    parent.postMessage({
      source: "thinkiac-shell",
      type: "shell:reload",
      detail: { id },
    }, "*");
  }

  function reportHeight() {
    parent.postMessage({
      source: "thinkiac-shell",
      type: "widget:height",
      detail: document.documentElement.scrollHeight,
    }, "*");
  }

  function scheduleHeight() {
    setTimeout(reportHeight, 0);
  }

  async function fetchHealth() {
    try {
      const response = await fetch("/reboot/health");
      return response.ok ? response.json() : null;
    } catch {
      return null;
    }
  }

  async function refresh() {
    health = await fetchHealth();
    if (health && basePid == null) basePid = health.pid;
    scheduleHeight();
  }

  async function refreshTaskAvailability() {
    try {
      const response = await fetch("/apps/list");
      const apps = response.ok ? await response.json() : [];
      hasTasksPackage = Array.isArray(apps) && apps.some((app) =>
        app?.id === "tasks" || app?.package === "tasks" || app?.url?.includes("/view/tasks/"),
      );
    } catch {
      hasTasksPackage = false;
    }
    scheduleHeight();
  }

  function stopPoll() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = null;
  }

  function pollForRestart() {
    stopPoll();
    restartWentOffline = false;
    const deadline = Date.now() + RESTART_TIMEOUT_MS;
    pollTimer = setInterval(async () => {
      const next = await fetchHealth();
      if (!next) restartWentOffline = true;
      // A queda do processo ou um novo PID confirmam que o ciclo terminou.
      // Sem PID inicial (clique durante a primeira leitura de status), uma
      // resposta saudável depois do pedido também libera o widget.
      if (next && (basePid == null || next.pid !== basePid || restartWentOffline)) {
        health = next;
        basePid = next.pid;
        phase = "done";
        message = "Runtime ready.";
        emitShellLoading(false);
        reloadShell("runtime-restart");
        stopPoll();
      } else if (Date.now() >= deadline) {
        phase = "error";
        message = "Restart could not be confirmed.";
        emitShellLoading(false);
        stopPoll();
      }
      scheduleHeight();
    }, 1000);
  }

  function isBusy() {
    return phase === "recovering" || phase === "restarting" || phase === "clearing-cache";
  }

  async function restart(force = false) {
    phase = "restarting";
    message = "";
    impact = null;
    try {
      const response = await fetch("/reboot/reboot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // This function follows an explicit maintenance confirmation.
        body: JSON.stringify({ reason: "Restart from runtime menu", force, confirm: true }),
      });
      const result = await response.json();
      if (result.blocked) {
        phase = "blocked";
        impact = result.impact || null;
        message = result.message || "Restart is blocked by an active critical session.";
      } else if (result.success) {
        message = "Restarting Runtime…";
        emitShellLoading(true);
        pollForRestart();
      } else {
        phase = "error";
        message = result.message || "Restart request failed.";
      }
    } catch {
      message = "Restarting Runtime…";
      emitShellLoading(true);
      pollForRestart();
    }
    scheduleHeight();
  }

  async function clearViewCache() {
    phase = "clearing-cache";
    message = "";
    try {
      const response = await fetch("/reboot/clear-cache", { method: "POST" });
      const result = await response.json();
      if (!response.ok || result.success === false) throw new Error(result.message || "Cache cleanup failed.");
      localStorage.clear();
      phase = "done";
      message = result.message || "Cache cleared. Reloading…";
      reloadShell("runtime-cache-reset");
    } catch (error) {
      phase = "error";
      message = error.message || "Cache cleanup failed.";
    }
    scheduleHeight();
  }

  function cancelRestart() {
    emitShellLoading(false);
    phase = "idle";
    message = "";
    impact = null;
    pendingAction = null;
    scheduleHeight();
  }

  function requestAction(action) {
    if (isBusy()) return;
    message = "";
    impact = null;
    pendingAction = action;
    phase = "confirming";
    scheduleHeight();
  }

  function confirmAction() {
    const action = pendingAction;
    pendingAction = null;
    if (action === "cache") return clearViewCache();
    if (action === "restart") return restart(false);
  }

  function liveSessions() {
    return impact?.liveSessions?.length || 0;
  }

  function openTaskManager() {
    parent.postMessage({
      source: "thinkiac-shell",
      type: "open:app",
      detail: "tasks",
    }, "*");
  }

  onMount(() => {
    readTheme();
    const onStorage = (event) => { if (event.key === "think:theme") readTheme(); };
    const onShellContext = (event) => {
      if (event.data?.source === "thinkiac-shell" && event.data?.type === "shell:context") {
        applyTheme(event.data.detail?.theme);
      }
    };
    const observer = new ResizeObserver(reportHeight);
    window.addEventListener("storage", onStorage);
    window.addEventListener("message", onShellContext);
    observer.observe(document.body);
    refresh();
    refreshTaskAvailability();
    return () => {
      window.removeEventListener("storage", onStorage);
      window.removeEventListener("message", onShellContext);
      observer.disconnect();
      stopPoll();
    };
  });
</script>

<main data-theme={theme}>
  <header>
    <span class="state" class:busy={isBusy()} class:offline={!health} aria-hidden="true"></span>
    <div class="heading">
      <strong>Runtime</strong>
      <span>{health ? `PID ${health.pid} · ${Math.floor(health.uptime / 60)}m up` : "Checking status…"}</span>
    </div>
    <div class="header-actions">
      <button class="icon-button" on:click={refresh} disabled={isBusy()} aria-label="Refresh runtime status">
      <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.3-5.7M20 4v6h-6" /></svg>
      </button>
      {#if hasTasksPackage}
        <button class="icon-button" on:click={openTaskManager} disabled={isBusy()} aria-label="Open Tasks">
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" /></svg>
        </button>
      {/if}
    </div>
  </header>

  {#if phase === "blocked"}
    <section class="confirmation" aria-live="polite">
      <p class="notice error">{message}</p>
      <p class="detail">{liveSessions()} live session{liveSessions() === 1 ? "" : "s"} may disconnect.</p>
      <div class="actions split">
        <button class="secondary" on:click={cancelRestart}>Cancel</button>
        <button class="danger" on:click={() => restart(true)}>Restart anyway</button>
      </div>
    </section>
  {:else if phase === "confirming"}
    <section class="confirmation" aria-live="polite">
      <p class="notice">{pendingAction === "cache" ? "Clear the compiled view cache and reload this page?" : "Restart the Runtime? Active sessions may disconnect."}</p>
      <div class="actions split">
        <button class="secondary" on:click={cancelRestart}>Cancel</button>
        <button class:danger={pendingAction === "restart"} class="primary" on:click={confirmAction}>
          {pendingAction === "cache" ? "Clear cache" : "Restart"}
        </button>
      </div>
    </section>
  {:else}
    {#if message}
      <p class="notice" class:error={phase === "error"}>{message}</p>
    {/if}

    <section class="runtime-actions" aria-label="Runtime actions">
      <button class="secondary" on:click={() => requestAction("cache")} disabled={isBusy()}>Clear cache</button>
      <button class="primary" on:click={() => requestAction("restart")} disabled={isBusy()}>Restart</button>
    </section>
  {/if}
</main>

<style>
  @import url('https://fonts.googleapis.com/css2?family=Ubuntu:wght@300;400;500;700&family=Ubuntu+Mono:wght@400;700&display=swap');
  /* O Widget roda em um documento próprio dentro de um iframe. Transparência
     aqui não herda o rail do Shell: ela deixa visível o canvas padrão daquele
     documento, que em alguns navegadores aparece azul-marinho. A superfície
     precisa ser definida no próprio iframe, desde html até o nó de montagem. */
  :global(:root) { --widget-frame-bg: #111111; }
  :global(html[data-theme="light"]) { --widget-frame-bg: #ffffff; }
  :global(html), :global(body), :global(#app) {
    margin: 0;
    padding: 0;
    background: var(--widget-frame-bg) !important;
  }
  :global(*) { box-sizing: border-box; }
  [data-theme="dark"] { --widget-frame-bg:#111111; --tk-bg:#111111; --tk-surface:#181818; --tk-surface-2:#1f1f1f; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888888; --tk-muted-2:rgba(136,136,136,.5); --tk-accent:#f5f5f5; --tk-on-accent:#111111; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; }
  [data-theme="light"] { --widget-frame-bg:#ffffff; --tk-bg:#ffffff; --tk-surface:#f5f5f5; --tk-surface-2:#ececec; --tk-border:rgba(0,0,0,.10); --tk-border-hi:rgba(0,0,0,.18); --tk-text:#1a1a1a; --tk-muted:#666666; --tk-muted-2:rgba(0,0,0,.4); --tk-accent:#111111; --tk-on-accent:#ffffff; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; }
  main { display: grid; gap: 12px; padding: 12px; color: var(--tk-text); background: var(--widget-frame-bg); font-family: var(--tk-font); }
  header { display: flex; align-items: center; gap: 8px; min-width: 0; }
  .state { width: 7px; height: 7px; flex: 0 0 auto; border: 1px solid var(--tk-text); border-radius: 50%; background: var(--tk-text); }
  .state.offline { opacity: .25; }
  .state.busy { animation: pulse 1.2s ease-out infinite; }
  @keyframes pulse { 50% { opacity: .3; transform: scale(.75); } }
  .heading { display: grid; min-width: 0; gap: 1px; flex: 1; }
  .heading strong { font-size: 13px; font-weight: 500; letter-spacing: -.01em; }
  .heading span, .detail { color: var(--tk-muted); font: 11px var(--tk-mono); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  button { border: 1px solid var(--tk-border-hi); border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font: 500 11px var(--tk-font); cursor: pointer; transition: transform 200ms ease-out, opacity 200ms ease-out; }
  button:hover:not(:disabled) { transform: translateY(-1px); }
  button:disabled { opacity: .45; cursor: default; }
  .header-actions { display: flex; align-items: center; gap: 2px; }
  .icon-button { display: grid; place-items: center; width: 27px; height: 27px; padding: 6px; border-color: transparent; }
  svg { width: 100%; fill: none; stroke: currentColor; stroke-width: 1.8; stroke-linecap: round; stroke-linejoin: round; }
  .notice, .detail { margin: 0; line-height: 1.4; }
  .notice { padding: 8px 9px; border-left: 2px solid var(--tk-border-hi); background: var(--tk-surface-2); color: var(--tk-muted); font-size: 11px; }
  .notice.error { color: var(--tk-text); }
  .confirmation { display: grid; gap: 8px; }
  .actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .actions button { min-height: 31px; padding: 6px 8px; }
  .primary { border-color: var(--tk-text); background: var(--tk-text); color: var(--tk-on-accent); }
  .danger { border-color: var(--tk-text); background: var(--tk-text); color: var(--tk-on-accent); }
  .runtime-actions { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
  .runtime-actions button { min-height: 34px; padding: 7px 9px; }
</style>
