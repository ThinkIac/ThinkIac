<script>
  import { onMount } from 'svelte';
  const ACCOUNTS = '/agent/codex-accounts';
  let mode = 'api', state = { accounts: [], pool_enabled: false, execution_mode: 'runtime-controlled' }, loadingAccounts = true, error = '';
  let usageAccounts = {}, loadingUsage = false;
  let resettingAccount = '';
  let apiStatus = null, apiKey = '', editingKey = false, apiModels = [], selectedModels = [], loadingModels = false, saving = false;

  async function accountRequest(method, path = '', body) {
    try {
      const response = await fetch(ACCOUNTS + path, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
      const data = await response.json(); if (!data.success) throw new Error(data.error || 'Could not load Codex accounts.'); return data;
    } catch (err) { error = err.message; }
  }
  async function apiRequest(method, path, body) {
    const response = await fetch(`/openai-bridge${path}`, { method, headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined, body: body !== undefined ? JSON.stringify(body) : undefined });
    const text = await response.text(); let data = null; try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON provider error */ }
    if (!response.ok) throw new Error(data?.error || `Request failed (${response.status}).`); if (data?.success === false) throw new Error(data.error || 'Request failed.'); return data;
  }
  function profileName(name) { return String(name || '').replace(/^terminal:/, ''); }
  function snapshots(account) { const byId = account?.rateLimitsByLimitId; return byId && Object.keys(byId).length ? Object.entries(byId).map(([id, value]) => ({ id, ...value })) : account?.rateLimits ? [{ id: account.rateLimits.limitId || 'codex', ...account.rateLimits }] : []; }
  function previewWindows(account) { const all = snapshots(account).flatMap(snapshot => [snapshot.primary, snapshot.secondary].filter(Boolean)); const week = all.find(window => window.windowDurationMins === 10080); const short = all.find(window => window !== week); return [short, week].filter(Boolean); }
  function percent(value) { return Math.max(0, Math.min(100, Number(value) || 0)); }
  function windowLabel(window) { const minutes = window?.windowDurationMins; if (minutes === 300) return '5h'; if (minutes === 10080) return 'Week'; if (minutes === 43200 || minutes === 43800 || minutes === 44640) return 'Month'; if (!minutes) return 'Limit'; return minutes % 60 === 0 ? `${Math.round(minutes / 60)}h` : `${minutes} min`; }
  function formatReset(timestamp) { if (!timestamp) return ''; const minutes = Math.ceil((timestamp * 1000 - Date.now()) / 60000); if (minutes > 0 && minutes < 1440) return minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m`; return new Date(timestamp * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); }
  function plan(usage) { const snapshot = snapshots(usage)[0]; return String(snapshot?.planType || usage?.account?.planType || '').replaceAll('_', ' '); }
  function usageFor(account) { return usageAccounts[profileName(account.name)]; }
  function resetCredits(usage) { return Math.max(0, Number(usage?.rateLimitResetCredits?.availableCount) || 0); }
  async function refreshUsage(force = false) { loadingUsage = true; try { const response = await fetch(`/agent/codex-usage${force ? '?refresh=1' : ''}`); const data = await response.json(); if (!data.success) throw new Error(data.error || 'Could not load account usage.'); usageAccounts = Object.fromEntries((data.accounts || []).map(account => [profileName(account.name), account])); } catch (err) { error = err.message; } finally { loadingUsage = false; } }
  async function refreshAccounts() { loadingAccounts = true; const data = await accountRequest('GET'); if (data) state = data; loadingAccounts = false; }
  async function loadApiStatus() {
    try { apiStatus = await apiRequest('GET', '/status'); selectedModels = apiStatus?.models?.map(model => model.id) || []; if (apiStatus?.configured) await loadModels(); }
    catch (err) { error = err.message; }
  }
  async function loadModels() {
    if (!apiStatus?.configured) return; loadingModels = true;
    try { const result = await apiRequest('GET', '/models'); apiModels = result.models || []; } catch (err) { error = err.message; } finally { loadingModels = false; }
  }
  function modelChecked(id) { return selectedModels.includes(id); }
  function toggleModel(id) { selectedModels = modelChecked(id) ? selectedModels.filter(model => model !== id) : [...selectedModels, id]; }
  async function saveKey() {
    const key = apiKey.trim(); if (!key) return; if (!/^sk-/.test(key)) { error = 'Enter a valid OpenAI API key.'; return; }
    saving = true; error = '';
    try { const result = await apiRequest('POST', '/save', { api_key: key }); apiStatus = result.status; selectedModels = apiStatus.models?.map(model => model.id) || []; apiKey = ''; editingKey = false; await loadModels(); }
    catch (err) { error = err.message; } finally { saving = false; }
  }
  async function saveEnabledModels() {
    if (!selectedModels.length) { error = 'Select at least one model.'; return; } saving = true; error = '';
    try { const current = selectedModels.includes(apiStatus?.model) ? apiStatus.model : selectedModels[0]; const result = await apiRequest('POST', '/models', { models: selectedModels, model: current }); apiStatus = result.status; }
    catch (err) { error = err.message; } finally { saving = false; }
  }
  async function toggleApi() { try { const result = await apiRequest('POST', '/toggle', { enabled: !apiStatus?.enabled }); apiStatus = result.status; } catch (err) { error = err.message; } }
  async function toggleAccount(account) { const result = await accountRequest('PATCH', `/${encodeURIComponent(account.name)}/status`, { enabled: !account.enabled }); if (result) state = result; }
  async function setExecutionMode(execution_mode) {
    if (execution_mode === state.execution_mode) return;
    const result = await accountRequest('PATCH', '/execution-mode', { execution_mode });
    if (result) state = result;
  }
  async function resetUsage(account, usage) {
    const credits = resetCredits(usage); if (!credits || resettingAccount) return;
    const label = usage?.account?.email || profileName(account.name);
    if (!confirm(`Use 1 reset credit for ${label}? ${credits - 1} will remain.`)) return;
    resettingAccount = account.name; error = '';
    try {
      const response = await fetch(`/agent/codex-usage/${encodeURIComponent(profileName(account.name))}/reset`, { method: 'POST' });
      const data = await response.json(); if (!response.ok || !data.success) throw new Error(data.error || 'Could not reset usage.');
      await refreshUsage(true);
    } catch (err) { error = err.message; } finally { resettingAccount = ''; }
  }
  function refresh() { refreshAccounts(); refreshUsage(true); loadApiStatus(); }
  onMount(() => { refreshAccounts(); refreshUsage(); loadApiStatus(); });
</script>

<main data-theme="dark">
  <header><div><span class="eyebrow">OPENAI</span><h1>OpenAI</h1><p>Connect OpenAI with an API key or your Codex accounts from Terminal.</p></div><button class="refresh" on:click={refresh} aria-label="Refresh"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg></button></header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <div class="seg" aria-label="Connection type"><button class:sel={mode === 'api'} on:click={() => (mode = 'api')}>API Key</button><button class:sel={mode === 'codex'} on:click={() => (mode = 'codex')}>Codex</button></div>

  {#if mode === 'api'}
    <section class="hero"><div><h2>OpenAI API Key</h2><p>Use your own API billing and choose exactly which models are enabled.</p></div>{#if apiStatus?.configured}<button class:on={apiStatus.enabled} on:click={toggleApi}>{apiStatus.enabled ? 'Enabled' : 'Enable'}</button>{/if}</section>
    {#if !apiStatus?.configured || editingKey}
      <section><h2>{apiStatus?.configured ? 'Replace API key' : 'Add an API key'}</h2><p class="muted">Create and manage keys in <a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI Platform</a>.</p><div class="key-form"><input type="password" bind:value={apiKey} autocomplete="off" spellcheck="false" placeholder="sk-..." aria-label="OpenAI API key" /><button class="primary" disabled={saving || !apiKey.trim()} on:click={saveKey}>{saving ? 'Saving…' : 'Save key'}</button>{#if apiStatus?.configured}<button disabled={saving} on:click={() => { editingKey = false; apiKey = ''; }}>Cancel</button>{/if}</div></section>
    {:else}
      <section class="key-summary"><div><span class="label">API KEY</span><strong class="mono">{apiStatus.keyPreview}</strong></div><button on:click={() => (editingKey = true)}>Replace</button></section>
      <section><div class="section-head"><div><h2>Enabled models</h2><p>Models are loaded directly from your OpenAI account.</p></div><button class="icon" on:click={loadModels} disabled={loadingModels} aria-label="Refresh models"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 11a8 8 0 1 0-2.34 5.66M20 4v7h-7" /></svg></button></div>{#if loadingModels}<p class="muted">Loading models…</p>{:else if !apiModels.length}<p class="muted">No models loaded yet. Refresh to try again.</p>{:else}<div class="models">{#each apiModels as model (model.id)}<label class="model"><input type="checkbox" checked={modelChecked(model.id)} on:change={() => toggleModel(model.id)} /><span>{model.name}</span></label>{/each}</div><button class="primary save-models" disabled={saving || !selectedModels.length} on:click={saveEnabledModels}>{saving ? 'Saving…' : `Save ${selectedModels.length} enabled`}</button>{/if}</section>
    {/if}
  {:else}
    <section class="intro"><h2>Codex accounts</h2><p>Accounts are recognized automatically after signing in to Codex through Terminal. You can create multiple profiles and sign in with more than one account.</p></section>
    <section class="advanced" aria-labelledby="execution-mode-title">
      <div><h2 id="execution-mode-title">Advanced execution mode</h2><p>Runtime controlled is the default: Codex uses the same Runtime tools, governance and audit trail as other providers.</p></div>
      <label class="mode-choice"><input type="radio" name="execution-mode" value="runtime-controlled" checked={state.execution_mode !== 'codex-native'} on:change={() => setExecutionMode('runtime-controlled')} /><span><strong>Runtime controlled</strong><small>Recommended. Native shell and file tools stay off.</small></span></label>
      <label class="mode-choice"><input type="radio" name="execution-mode" value="codex-native" checked={state.execution_mode === 'codex-native'} on:change={() => setExecutionMode('codex-native')} /><span><strong>Codex native</strong><small>Uses Codex sandbox and approvals. Actions are observed separately.</small></span></label>
    </section>
    <section>
      <div class="section-head"><div><h2>Profiles</h2><p>Only signed-in Terminal profiles appear here.</p></div>{#if loadingUsage}<span class="loading-dot">Updating</span>{/if}</div>
      {#if loadingAccounts}<p class="muted">Looking for profiles…</p>
      {:else if !state.accounts.length}<p class="muted">Open Terminal, create a profile, then run <code>codex login</code>.</p>
      {:else}{#each state.accounts as account (account.name)}
        {@const usage = usageFor(account)}
        <div class:unavailable={!usage?.ok && account.status === 'logged_in'} class="account">
          <div class="account-main">
            <div class="account-title"><strong>{usage?.account?.email || profileName(account.name)}</strong><button class="switch" class:on={account.enabled} role="switch" aria-checked={account.enabled} aria-label={`Enable ${account.name}`} on:click={() => toggleAccount(account)}><span></span></button></div>
            <span>{usage?.account?.name || (account.status === 'logged_in' ? 'Signed in through Terminal' : 'Waiting for sign-in')}{#if plan(usage)} · {plan(usage)}{/if}</span>
            {#if usage?.ok}<div class="usage-bars"><div class="usage-heading"><span>USAGE</span><span>consumed</span></div>{#each previewWindows(usage) as window (window.windowDurationMins)}<div class="usage-row"><div class="usage-row-head"><span>{windowLabel(window)}</span><b>{Math.round(percent(window.usedPercent))}% used</b></div><div class="usage-track" role="progressbar" aria-label={`${windowLabel(window)} used`} aria-valuenow={percent(window.usedPercent)} aria-valuemin="0" aria-valuemax="100"><i class:warning={percent(window.usedPercent) >= 70} class:critical={percent(window.usedPercent) >= 90} style={`width:${percent(window.usedPercent)}%`}></i></div>{#if window.resetsAt}<small>Resets in {formatReset(window.resetsAt)}</small>{/if}</div>{/each}</div>
              <div class="reset-credit"><div><span class="label">RESET CREDITS</span><strong>{resetCredits(usage)} available</strong></div><button class="reset-button" disabled={!resetCredits(usage) || !!resettingAccount} on:click={() => resetUsage(account, usage)}>{resettingAccount === account.name ? 'Resetting…' : 'Reset usage'}</button></div>
            {:else if usage && !usage.ok}<span class="usage-error">{usage.error || 'Usage unavailable'}</span>{/if}
          </div>
        </div>
      {/each}{/if}
    </section>
  {/if}
</main>

<style>
  [data-theme="dark"] { --tk-bg:#111; --tk-surface:#181818; --tk-surface-2:#1f1f1f; --tk-border:rgba(255,255,255,.09); --tk-border-hi:rgba(255,255,255,.16); --tk-text:#f5f5f5; --tk-muted:#888; --tk-accent:#f5f5f5; --tk-on-accent:#111; --tk-radius-md:8px; --tk-radius-lg:14px; --tk-font:'Ubuntu',system-ui,sans-serif; --tk-mono:'Ubuntu Mono',monospace; }
  main { min-height:100dvh; box-sizing:border-box; max-width:880px; padding:40px clamp(18px,5vw,56px) 56px; background:var(--tk-bg); color:var(--tk-text); font-family:var(--tk-font); } header,.hero,.section-head,.account,.key-summary,.key-form { display:flex; align-items:center; justify-content:space-between; gap:16px; } header { margin-bottom:26px; } h1,h2,p { margin:0; } h1 { font-size:30px; letter-spacing:-.04em; } h2 { font-size:16px; } p,span { color:var(--tk-muted); } header p,.hero p,.section-head p,.intro p { margin-top:6px; line-height:1.45; }.eyebrow,.label { color:var(--tk-muted); font-size:11px; letter-spacing:.12em; font-weight:700; }.seg { display:inline-flex; gap:3px; padding:3px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); }.seg button { border:0; background:transparent; color:var(--tk-muted); }.seg button.sel { background:var(--tk-surface-2); color:var(--tk-text); } section { margin-top:16px; padding:18px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-lg); background:var(--tk-surface); }.hero { margin-top:16px; }.intro { border-color:var(--tk-border-hi); } button { border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); padding:8px 12px; color:var(--tk-text); background:var(--tk-surface-2); font:inherit; cursor:pointer; } button.primary,button.on { background:var(--tk-accent); color:var(--tk-on-accent); } button:disabled { opacity:.45; cursor:not-allowed; }.refresh,.icon { display:grid; place-items:center; width:34px; height:34px; padding:7px; border-color:transparent; background:transparent; } svg { width:19px; height:19px; fill:none; stroke:currentColor; stroke-width:1.8; stroke-linecap:round; stroke-linejoin:round; }.error { margin:0 0 14px; color:#e05d5d; }.muted { line-height:1.45; } a { color:var(--tk-text); } code,.mono { font-family:var(--tk-mono); color:var(--tk-text); }.key-form { margin-top:16px; justify-content:flex-start; } input[type="password"] { min-width:240px; flex:1; color:var(--tk-text); background:var(--tk-bg); border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); padding:10px; font:inherit; font-family:var(--tk-mono); }.key-summary { padding-block:3px; }.key-summary div { display:grid; gap:5px; }.models { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:8px; margin-top:16px; max-height:360px; overflow:auto; }.model { display:flex; gap:9px; align-items:center; padding:9px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); cursor:pointer; }.model span { overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--tk-text); }.model input { accent-color:var(--tk-accent); }.save-models { margin-top:16px; }.account { padding:14px 0; border-top:1px solid var(--tk-border); }.account:first-of-type { margin-top:12px; }.account div { display:grid; gap:4px; }.account strong { font-weight:500; }.account span { font-size:13px; }.switch { width:42px; height:24px; padding:2px; display:flex; justify-content:flex-start; border-radius:999px; }.switch span { width:18px; height:18px; border-radius:50%; background:var(--tk-muted); transition:transform 200ms ease-out,background 200ms ease-out; }.switch.on span { transform:translateX(16px); background:var(--tk-on-accent); } @media (max-width:620px) { main { padding-top:28px; }.hero,.section-head,.key-summary,.key-form { align-items:stretch; flex-direction:column; }.key-form button { width:100%; }.models { grid-template-columns:1fr; } }
  .account { margin-top:10px; padding:15px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); background:var(--tk-surface-2); }
  .account:first-of-type { margin-top:14px; }
  .account.unavailable { opacity:.72; }
  .account-main { display:grid; gap:5px; width:100%; }
  .account-title { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .usage-bars { display:grid; gap:11px; margin-top:10px; padding:12px; border:1px solid var(--tk-border-hi); border-radius:var(--tk-radius-md); background:var(--tk-bg); }
  .usage-heading,.usage-row-head { display:flex; align-items:center; justify-content:space-between; gap:12px; }
  .usage-heading { color:var(--tk-muted); font-size:10px; font-weight:700; letter-spacing:.12em; }
  .usage-heading span:last-child { font-weight:500; letter-spacing:.04em; }
  .usage-row { display:grid; gap:6px; color:var(--tk-muted); font:12px var(--tk-mono); }
  .usage-row-head b { color:var(--tk-text); font-size:13px; font-weight:700; }
  .usage-row small { color:var(--tk-muted); font:11px var(--tk-font); }
  .usage-track { height:8px; overflow:hidden; border:1px solid rgba(255,255,255,.12); border-radius:999px; background:#303030; box-shadow:inset 0 1px 2px rgba(0,0,0,.35); }
  .usage-track i { display:block; height:100%; min-width:2px; border-radius:inherit; background:var(--tk-accent); box-shadow:0 0 10px rgba(255,255,255,.28); transition:width 240ms ease-out; }
  .usage-track i.warning { background:#f2b84b; box-shadow:0 0 10px rgba(242,184,75,.35); }
  .usage-track i.critical { background:#f06a6a; box-shadow:0 0 10px rgba(240,106,106,.35); }
  .reset-credit { display:flex !important; align-items:center; justify-content:space-between; gap:12px; margin-top:12px; padding-top:12px; border-top:1px solid var(--tk-border); }
  .reset-credit div { display:grid; gap:3px; }
  .reset-credit strong { color:var(--tk-text); font-size:13px; font-weight:500; }
  .reset-button { flex:0 0 auto; }
  .usage-error,.loading-dot { color:var(--tk-muted); font-size:12px; }
  .loading-dot { font-size:11px; }
  .advanced { display:grid; gap:12px; }
  .mode-choice { display:flex; align-items:flex-start; gap:10px; padding:11px; border:1px solid var(--tk-border); border-radius:var(--tk-radius-md); cursor:pointer; }
  .mode-choice:has(input:checked) { border-color:var(--tk-border-hi); background:var(--tk-surface-2); }
  .mode-choice input { margin-top:3px; accent-color:var(--tk-accent); }
  .mode-choice span { display:grid; gap:3px; }
  .mode-choice strong { color:var(--tk-text); font-size:14px; font-weight:500; }
  .mode-choice small { color:var(--tk-muted); line-height:1.35; }
  @media (max-width:620px) { .usage-bars { padding:11px; } }
</style>
