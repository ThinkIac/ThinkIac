<script>
  import { onMount } from 'svelte';

  let catalog = [], loading = true, saving = false, error = '', notice = '', theme = 'dark';
  let homepage = { homepageMode: 'direct', homepageType: 'app', homepagePackageName: '', homepagePage: 'Index', homepageUrl: '', homepageAccessMode: 'admin', homepagePublicPaths: '' };

  function paths(value) { return String(value || '').split(/\r?\n/).map((path) => path.trim()).filter(Boolean); }
  function storedPaths(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.join('\n') : ''; } catch { return ''; } }
  function normalizeCatalog(payload) {
    const apps = Array.isArray(payload) ? payload : payload.apps || payload.data || [];
    return apps.flatMap((app) => {
      const packageName = app.packageName || app.package || app.id || app.name;
      const pages = Array.isArray(app.pages) && app.pages.length ? app.pages : [{ name: app.defaultPage || 'Index', label: 'Home page' }];
      return pages.map((page) => ({ packageName, page: page.page || page.name || page.id || 'Index', label: `${app.name || packageName} · ${page.label || page.name || 'Home page'}` }));
    }).filter((item) => item.packageName);
  }
  function selectCatalog(value) { const item = catalog.find((entry) => `${entry.packageName}:${entry.page}` === value); homepage = item ? { ...homepage, homepagePackageName: item.packageName, homepagePage: item.page } : { ...homepage, homepagePackageName: '', homepagePage: '' }; }
  async function load() {
    loading = true;
    try {
      const [state, apps] = await Promise.all([fetch('/redirect/api/estado').then((response) => response.json()), fetch('/shell/apps/list').then((response) => response.json())]);
      if (state.status !== 200) throw new Error(state.mensagem || 'Could not load settings.');
      catalog = normalizeCatalog(apps);
      homepage = { homepageMode: 'direct', homepageType: state.config.homepageType || 'app', homepagePackageName: state.config.homepagePackageName || '', homepagePage: state.config.homepagePage || 'Index', homepageUrl: state.config.homepageUrl || '', homepageAccessMode: state.config.homepageAccessMode || 'admin', homepagePublicPaths: storedPaths(state.config.homepagePublicPaths) };
    } catch (cause) { error = cause.message; } finally { loading = false; }
  }
  async function save() {
    saving = true; error = ''; notice = '';
    try {
      const response = await fetch('/redirect/api/homepage', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...homepage, homepageMode: 'direct', homepagePublicPaths: paths(homepage.homepagePublicPaths) }) });
      const data = await response.json();
      if (data.status !== 200) throw new Error(data.mensagem || 'Could not save changes.');
      notice = 'Home page updated.'; await load();
    } catch (cause) { error = cause.message; } finally { saving = false; }
  }
  onMount(() => {
    theme = localStorage.getItem('agent:theme') || 'dark';
    const syncTheme = (event) => { if (event.key === 'agent:theme') theme = event.newValue || 'dark'; };
    window.addEventListener('storage', syncTheme);
    load();
    return () => window.removeEventListener('storage', syncTheme);
  });
</script>

<main class="surface" data-theme={theme}>
  <header><div><p class="eyebrow">Instance entry point</p><h1>Home page</h1><span>Redirect takes over the root after a valid configuration is saved.</span></div><a href="/redirect/home">Open Home</a></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if loading}<p class="muted">Loading…</p>{:else}<section class="form-section"><div><h2>Default destination</h2><p class="muted">Choose an internal package or external URL for the entry point.</p></div><label><span>Destination type</span><select bind:value={homepage.homepageType}><option value="app">Package or page</option><option value="external_url">External URL</option></select></label>{#if homepage.homepageType === 'external_url'}<label><span>URL</span><input type="url" bind:value={homepage.homepageUrl} placeholder="https://example.com" /></label>{:else}<label><span>Package and page</span><select value={`${homepage.homepagePackageName}:${homepage.homepagePage}`} on:change={(event) => selectCatalog(event.currentTarget.value)}><option value=":">Select from catalog</option>{#each catalog as item}<option value={`${item.packageName}:${item.page}`}>{item.label}</option>{/each}</select></label><label><span>Access policy</span><select bind:value={homepage.homepageAccessMode}><option value="admin">Administrators</option><option value="authenticated">Authenticated users</option><option value="public">Public access</option></select></label>{#if homepage.homepageAccessMode === 'public'}<label><span>Public supporting paths</span><textarea bind:value={homepage.homepagePublicPaths} placeholder="One path per line"></textarea></label>{/if}{/if}<footer><button class="primary" on:click={save} disabled={saving}>{saving ? 'Saving…' : 'Save home page'}</button></footer></section>{/if}
</main>

<style>
  .surface[data-theme="dark"]{--tk-bg:#111111;--tk-surface:#181818;--tk-border:rgba(255,255,255,.09);--tk-border-hi:rgba(255,255,255,.16);--tk-text:#f5f5f5;--tk-muted:#888;--tk-accent:#f5f5f5;--tk-on-accent:#111}.surface[data-theme="light"]{--tk-bg:#fff;--tk-surface:#f5f5f5;--tk-border:rgba(0,0,0,.1);--tk-border-hi:rgba(0,0,0,.18);--tk-text:#1a1a1a;--tk-muted:#666;--tk-accent:#111;--tk-on-accent:#fff}.surface,.form-section{display:grid;gap:1rem}.surface{min-height:100dvh;box-sizing:border-box;max-width:760px;margin:0 auto;padding:2rem 1rem;font:15px 'Ubuntu',system-ui,sans-serif;background:var(--tk-bg);color:var(--tk-text)}.surface header{display:flex;justify-content:space-between;gap:1rem;align-items:flex-start}.surface p,h1,h2{margin:0}.surface h1{font-size:1.75rem;letter-spacing:-.03em}.surface h2{font-size:1rem}.eyebrow{color:var(--tk-muted);font-size:.72rem;text-transform:uppercase;letter-spacing:.12em;margin-bottom:.4rem!important}.surface header span,.muted{color:var(--tk-muted);font-size:.9rem;line-height:1.5}.form-section{border-top:1px solid var(--tk-border);padding-top:1.25rem;max-width:640px}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}label span{font-weight:500}input,select,textarea,button,a{font:inherit}input,select,textarea{min-height:2.55rem;box-sizing:border-box;padding:.6rem .7rem;background:transparent;color:var(--tk-text);border:1px solid var(--tk-border);border-radius:8px}textarea{min-height:6.25rem;resize:vertical}input:focus,select:focus,textarea:focus{background:var(--tk-surface);border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}button,a{width:max-content;padding:.65rem .9rem;border-radius:8px;border:1px solid var(--tk-border);background:transparent;color:var(--tk-text);text-decoration:none;cursor:pointer}button.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent);font-weight:700}button:disabled{opacity:.55;cursor:wait}button:focus-visible,a:focus-visible{outline:2px solid var(--tk-text);outline-offset:2px}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}footer{display:flex;justify-content:flex-end;padding-top:.25rem}@media(max-width:600px){.surface{padding-top:1.25rem}.surface header{flex-direction:column}footer button,.surface header a{width:100%;text-align:center}}
</style>
