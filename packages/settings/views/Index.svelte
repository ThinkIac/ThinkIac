<script>
  import { onMount } from 'svelte';
  import SystemSurface from '../../ui-schema/views/SystemSurface.svelte';

  let theme = 'dark';
  let tabs = [];
  let keyTabs = [];
  let active = '';
  let openKeyTab = '';
  let loading = true;
  let error = '';
  let surface = null;
  let surfaceState = {};
  let surfaceLoading = false;
  let surfaceError = '';
  let keySurface = null;
  let keySurfaceState = {};
  let keySurfaceLoading = false;
  let keySurfaceError = '';

  function readTheme() {
    try { theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark'; } catch (_) {}
  }

  function syncTheme(event) { if (event.key === 'agent:theme') readTheme(); }

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await fetch('/settings/tabs');
      const data = await response.json();
      if (!response.ok || data.status >= 400) throw new Error(data.error || data.message || 'Could not load settings.');
      tabs = data.tabs || [];
      keyTabs = data.keyTabs || [];
      const nextActive = tabs.some((tab) => tab.id === active) ? active : tabs[0]?.id || '';
      if (nextActive !== active) await openTab(nextActive);
    } catch (cause) {
      error = cause.message || 'Could not load settings.';
    } finally { loading = false; }
  }

  $: current = tabs.find((tab) => tab.id === active);

  async function openTab(id) {
    active = id;
    surface = null;
    surfaceState = {};
    surfaceError = '';
    const tab = tabs.find((entry) => entry.id === id);
    if (!tab || tab.renderer !== 'schema') return;

    surfaceLoading = true;
    try {
      const response = await fetch(`/${tab.packageName}/system/view?tab=${encodeURIComponent(tab.id)}`);
      const data = await response.json();
      if (!response.ok || data.status >= 400) throw new Error(data.error || data.message || 'Could not load settings section.');
      surface = data.surface;
      surfaceState = data.state || {};
    } catch (cause) {
      surfaceError = cause.message || 'Could not load settings section.';
    } finally {
      surfaceLoading = false;
    }
  }

  async function toggleKeyTab(id) {
    openKeyTab = openKeyTab === id ? '' : id;
    keySurface = null; keySurfaceState = {}; keySurfaceError = '';
    const tab = keyTabs.find((entry) => entry.id === id);
    if (openKeyTab !== id || tab?.renderer !== 'schema') return;
    keySurfaceLoading = true;
    try {
      const response = await fetch(`/${tab.packageName}/system/view?tab=${encodeURIComponent(tab.id)}`);
      const data = await response.json();
      if (!response.ok || data.status >= 400) throw new Error(data.error || data.mensagem || 'Could not load integration settings.');
      keySurface = data.surface; keySurfaceState = data.state || {};
    } catch (cause) { keySurfaceError = cause.message || 'Could not load integration settings.'; }
    finally { keySurfaceLoading = false; }
  }

  onMount(() => {
    readTheme();
    window.addEventListener('storage', syncTheme);
    load();
    return () => window.removeEventListener('storage', syncTheme);
  });
</script>

<main class="settings" data-theme={theme} aria-busy={loading}>
  {#if loading}
    <div class="loading-state" role="status" aria-label="Carregando configurações"><span class="spinner"></span></div>
  {:else if error}
    <section class="state"><p>{error}</p><button on:click={load}>Try again</button></section>
  {:else if tabs.length === 0 && keyTabs.length === 0}
    <p class="state">No settings are available.</p>
  {:else}
    <nav aria-label="Settings sections">
      {#each tabs as tab}
        <button class:active={active === tab.id} on:click={() => openTab(tab.id)}>{tab.label}</button>
      {/each}
    </nav>
    {#if current}
      <section class="panel">
        {#if surfaceLoading}
          <div class="loading-state" role="status" aria-label="Carregando seção"><span class="spinner"></span></div>
        {:else if surfaceError}
          <p class="state error" role="alert">{surfaceError}</p>
        {:else if current.renderer === 'schema' && surface}
          <SystemSurface {surface} state={surfaceState} actionUrl={`/${current.packageName}/system/action?tab=${encodeURIComponent(current.id)}`} />
        {:else}
          <iframe title={current.label} src={`/view/${current.packageName}/${current.view}`}></iframe>
        {/if}
      </section>
    {/if}
    {#if keyTabs.length}
      <section class="keys" aria-labelledby="integration-keys-title">
        <h2 id="integration-keys-title">Integrações</h2>
        <p>Configure provedores e use os recursos disponíveis em cada integração.</p>
        <div class="key-accordions">
          {#each keyTabs as tab (tab.id)}
            <article class:open={openKeyTab === tab.id}>
              <button
                class="key-trigger"
                class:active={openKeyTab === tab.id}
                aria-expanded={openKeyTab === tab.id}
                aria-controls={`key-panel-${tab.id}`}
                on:click={() => toggleKeyTab(tab.id)}
              >
                <span>{tab.label}</span><span aria-hidden="true">{openKeyTab === tab.id ? '−' : '+'}</span>
              </button>
              {#if openKeyTab === tab.id}
                <div class="key-panel" id={`key-panel-${tab.id}`}>
                  {#if tab.renderer === 'schema'}
                    {#if keySurfaceLoading}<div class="loading-state" role="status" aria-label="Carregando integração"><span class="spinner"></span></div>
                    {:else if keySurfaceError}<p class="state error" role="alert">{keySurfaceError}</p>
                    {:else if keySurface}<SystemSurface surface={keySurface} state={keySurfaceState} actionUrl={`/${tab.packageName}/system/action?tab=${encodeURIComponent(tab.id)}`} />{/if}
                  {:else}<iframe title={tab.label} src={`/view/${tab.packageName}/${tab.view}`}></iframe>{/if}
                </div>
              {/if}
            </article>
          {/each}
        </div>
      </section>
    {/if}
  {/if}
</main>

<style>
  .settings { --tk-bg:#111111;--tk-surface:#181818;--tk-surface-2:#1f1f1f;--tk-border:rgba(255,255,255,.09);--tk-border-hi:rgba(255,255,255,.16);--tk-text:#f5f5f5;--tk-muted:#888888;--tk-accent:#f5f5f5;--tk-on-accent:#111111;--tk-radius-md:8px; min-height:100dvh;background:var(--tk-bg);color:var(--tk-text);font-family:'Ubuntu',system-ui,sans-serif;padding:32px; }
  .settings[data-theme='light'] { --tk-bg:#ffffff;--tk-surface:#f5f5f5;--tk-surface-2:#ececec;--tk-border:rgba(0,0,0,.10);--tk-border-hi:rgba(0,0,0,.18);--tk-text:#1a1a1a;--tk-muted:#666666;--tk-accent:#111111;--tk-on-accent:#ffffff; }
  p { margin:0; }
  nav { display:flex;gap:6px;max-width:1100px;margin:0 auto;border-bottom:1px solid var(--tk-border);overflow:auto; } button { background:var(--tk-surface-2);border:1px solid var(--tk-border);border-bottom:0;border-radius:8px 8px 0 0;color:var(--tk-text);cursor:pointer;font:inherit;padding:9px 12px;white-space:nowrap; } button.active { background:var(--tk-text);color:var(--tk-bg); } .state { max-width:1100px;margin:24px auto; } .state button { border-bottom:1px solid var(--tk-border);border-radius:8px;margin-top:10px; } .panel { background:var(--tk-surface);border:1px solid var(--tk-border);border-top:0;max-width:1100px;margin:auto;min-height:76dvh;padding:24px; } .panel .state { margin:0; } .keys { border-top:1px solid var(--tk-border);max-width:1100px;margin:32px auto 0;padding-top:24px; } .keys h2 { font-size:16px;margin:0; } .keys p { color:var(--tk-muted);font-size:13px;margin:6px 0 14px; } .key-accordions { display:grid;gap:8px; } .key-accordions article { background:var(--tk-surface);border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);overflow:hidden; } .key-trigger { align-items:center;background:transparent;border:0;border-radius:0;display:flex;justify-content:space-between;padding:13px 14px;text-align:left;width:100%; } .key-trigger.active { background:var(--tk-surface-2);color:var(--tk-text); } .key-panel { border-top:1px solid var(--tk-border);padding:16px; } .key-panel iframe { height:420px; } .loading-state { display:grid;place-items:center;min-height:160px; } .spinner { width:32px;height:32px;border:3px solid var(--tk-border-hi);border-top-color:var(--tk-accent);border-radius:50%;animation:spin .7s linear infinite; } .error { color:var(--tk-danger,#ff9b9b); } iframe { background:var(--tk-surface);border:0;display:block;height:calc(76dvh - 48px);width:100%; } @keyframes spin { to { transform:rotate(360deg); } } @media (max-width:680px) { .settings { padding:20px 14px; } .panel { padding:16px; } iframe { height:calc(76dvh - 32px); } .key-panel iframe { height:420px; } }
</style>
