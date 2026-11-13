<script>
  import { onMount } from 'svelte';
  import ProvidersSurface from './ProvidersSurface.svelte';
  import SessionsSurface from './SessionsSurface.svelte';
  import McpSurface from './McpSurface.svelte';
  import GovernanceSurface from './GovernanceSurface.svelte';
  import AuthSurface from './AuthSurface.svelte';
  import SpecialistsSurface from './SpecialistsSurface.svelte';
  import GithubCredentialsSurface from './GithubCredentialsSurface.svelte';
  import PixabaySurface from './PixabaySurface.svelte';
  import InfiniGateCredentialsSurface from './InfiniGateCredentialsSurface.svelte';
  import ElevenLabsIntegrationSurface from './ElevenLabsIntegrationSurface.svelte';

  export let surface;
  export let state = {};
  export let actionUrl = '';

  let catalog = [], roles = [], declaredRoles = [], loading = false, error = '', notice = '', loadedConfig = '';
  let homepage = {};
  let roleRules = [], nonRoleRules = [];

  $: if (state.config && JSON.stringify(state.config) !== loadedConfig) {
    loadedConfig = JSON.stringify(state.config);
    homepage = {
      homepageMode: 'direct', homepageType: state.config.homepageType || 'app',
      homepagePackageName: state.config.homepagePackageName || '', homepagePage: state.config.homepagePage || 'Index',
      homepageUrl: state.config.homepageUrl || '', homepageAccessMode: state.config.homepageAccessMode || 'admin',
      homepagePublicPaths: storedPaths(state.config.homepagePublicPaths),
    };
    const rules = storedRules(state.config.homepageRoleRules);
    roleRules = rules.filter((rule) => (rule.role || rule.group || rule.groupId) && rule.destination);
    nonRoleRules = rules.filter((rule) => !rule.role && !rule.group && !rule.groupId);
  }

  function allRoles() {
    const entries = [...(state.roleGroups || []), ...roles];
    return [...new Map(entries.filter((item) => item?.id).map((item) => [item.id, item])).values()];
  }
  function allDeclaredRoles() {
    const entries = [...(state.declaredRoles || []), ...declaredRoles];
    return [...new Map(entries.filter((item) => item?.packageName && item?.id).map((item) => [`${item.packageName}:${item.id}`, item])).values()];
  }

  function paths(value) { return String(value || '').split(/\r?\n/).map((item) => item.trim()).filter(Boolean); }
  function storedPaths(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed.join('\n') : ''; } catch { return ''; } }
  function storedRules(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
  function normalizeCatalog(payload) {
    const apps = Array.isArray(payload) ? payload : payload.apps || payload.data || [];
    return apps.flatMap((app) => {
      const packageName = app.packageName || app.package || app.id || app.name;
      const name = app.alias || app.displayName || app.name || packageName;
      const pages = Array.isArray(app.pages) && app.pages.length ? app.pages : [{ name: app.defaultPage || 'Index', label: 'Home page' }];
      return pages.map((page) => ({ packageName, page: page.page || page.name || page.id || 'Index', label: `${name} · ${page.label || page.title || page.name || 'Home page'}` }));
    }).filter((item) => item.packageName);
  }
  function catalogValue() { return homepage.homepagePackageName ? `${homepage.homepagePackageName}:${homepage.homepagePage || 'Index'}` : ''; }
  function selectCatalog(value) {
    const item = catalog.find((entry) => `${entry.packageName}:${entry.page}` === value);
    homepage = item ? { ...homepage, homepagePackageName: item.packageName, homepagePage: item.page } : { ...homepage, homepagePackageName: '', homepagePage: '' };
  }
  function roleDestinationValue(role) {
    const destination = roleRules.find((rule) => ruleMatchesRole(rule, role))?.destination;
    return destination?.type === 'app' ? `${destination.packageName}:${destination.page || 'Index'}` : '';
  }
  function roleRuleKey(rule) { return rule.groupId ? `group:${rule.groupId}` : rule.group ? `declared:${rule.group}` : rule.role ? `role:${rule.role}` : ''; }
  function ruleMatchesRole(rule, role) {
    if (roleRuleKey(rule) === role) return true;
    if (!role.startsWith('declared:') || !rule.groupId) return false;
    const [packageName, groupName] = role.slice('declared:'.length).split(':');
    const group = allRoles().find((item) => item.id === rule.groupId);
    return group?.declaredPackage === packageName && group?.declaredGroup === groupName;
  }
  function roleLabel(role) {
    if (role === 'role:admin') return 'Administrator';
    if (role === 'role:user') return 'Standard user';
    if (role.startsWith('declared:')) {
      const [packageName, groupName] = role.slice('declared:'.length).split(':');
      const definition = allDeclaredRoles().find((item) => item.packageName === packageName && item.id === groupName);
      return definition ? `${definition.packageLabel || definition.packageName} · ${definition.label}` : groupName || 'Role';
    }
    const id = role.replace(/^group:/, '');
    return allRoles().find((item) => item.id === id)?.name || 'Role';
  }
  function roleKeys() {
    const builtIn = ['role:admin', 'role:user'];
    // Declared product roles must keep their stable package:id selector even
    // once Auth has materialized a backing permissionGroup. Otherwise a role
    // disappears from this screen or is saved as a volatile database id.
    const groups = allRoles().filter((item) => !item.declaredPackage || !item.declaredGroup).map((item) => `group:${item.id}`);
    const declared = allDeclaredRoles().map((item) => `declared:${item.packageName}:${item.id}`);
    return [...new Set([...builtIn, ...groups, ...declared])];
  }
  function selectRoleDestination(role, value) {
    const item = catalog.find((entry) => `${entry.packageName}:${entry.page}` === value);
    roleRules = roleRules.filter((rule) => !ruleMatchesRole(rule, role));
    if (!item) return;
    const selector = role.startsWith('group:') ? { groupId: role.slice('group:'.length) }
      : role.startsWith('declared:') ? { group: role.slice('declared:'.length) }
      : { role: role.slice('role:'.length) };
    roleRules = [...roleRules, { ...selector, destination: { type: 'app', packageName: item.packageName, page: item.page } }];
  }
  async function saveHomepage() {
    loading = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'redirect.save-homepage', values: { ...homepage, homepageMode: 'direct', homepagePublicPaths: paths(homepage.homepagePublicPaths), homepageRoleRules: [...roleRules, ...nonRoleRules] } }) });
      const result = await response.json();
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Could not save changes.');
      state = result.state || state; notice = result.notice || 'Home page updated.';
    } catch (cause) { error = cause.message || 'Could not save changes.'; }
    finally { loading = false; }
  }
  function openHome() {
    window.top.location.assign('/redirect/home');
  }
  onMount(async () => {
    try { catalog = normalizeCatalog(await (await fetch('/shell/apps/list')).json()); } catch { catalog = []; }
    try {
      const permissions = await (await fetch('/auth/permissions')).json();
      roles = permissions.groups || [];
      declaredRoles = permissions.declaredGroups || [];
    } catch { roles = []; declaredRoles = []; }
  });
</script>

{#if surface?.kind === 'redirect-routing'}
  <section class="surface" aria-busy={loading}>
    <header><button class="secondary" on:click={openHome}>Open Home</button></header>
    {#if error}<p class="notice error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
    <section class="form-section">
      <div class="section-heading"><h3>Default destination</h3><p>This is used when no role-specific destination is set.</p></div>
      <label><span>Destination type</span><select bind:value={homepage.homepageType}><option value="app">Package or page</option><option value="external_url">External URL</option></select></label>
      {#if homepage.homepageType === 'external_url'}<label>URL<input type="url" bind:value={homepage.homepageUrl} placeholder="https://example.com" /></label>
      {:else}<label>Package and page<select value={catalogValue()} on:change={(event) => selectCatalog(event.currentTarget.value)}><option value="">Select from catalog</option>{#each catalog as item}<option value={`${item.packageName}:${item.page}`}>{item.label}</option>{/each}</select></label>
        <label>Access policy<select bind:value={homepage.homepageAccessMode}><option value="admin">Administrators</option><option value="authenticated">Authenticated users</option><option value="public">Public access</option></select></label>
        {#if homepage.homepageAccessMode === 'public'}<label>Public supporting paths<textarea bind:value={homepage.homepagePublicPaths} placeholder="/package/data&#10;/package/signup"></textarea></label>{/if}
      {/if}
      <section class="role-section" aria-labelledby="role-destinations"><div class="section-heading"><h3 id="role-destinations">Role destinations</h3><p>Choose an optional home page for each role. Empty roles use the default destination.</p></div>
        {#each roleKeys() as role}<label>{roleLabel(role)}<select value={roleDestinationValue(role)} on:change={(event) => selectRoleDestination(role, event.currentTarget.value)}><option value="">Use default destination</option>{#each catalog as item}<option value={`${item.packageName}:${item.page}`}>{item.label}</option>{/each}</select></label>{/each}
      </section>
      <footer><button class="primary" disabled={loading} aria-label={loading ? 'Salvando' : 'Salvar página inicial'} on:click={saveHomepage}>{#if loading}<span class="button-spinner"></span>{:else}Save home page{/if}</button></footer>
    </section>
  </section>
  {:else if surface?.kind === 'providers-catalog'}
  <ProvidersSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'session-preferences'}
  <SessionsSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'mcp-providers'}
  <McpSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'governance-defaults'}
  <GovernanceSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'auth-administration'}
  <AuthSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'specialists-catalog'}
  <SpecialistsSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'github-credentials'}
  <GithubCredentialsSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'pixabay-credentials'}
  <PixabaySurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'infinigate-credentials'}
  <InfiniGateCredentialsSurface {surface} {state} {actionUrl} />
{:else if surface?.kind === 'elevenlabs-integration'}
  <ElevenLabsIntegrationSurface {surface} {state} {actionUrl} />
{:else}<p class="notice error">Surface não suportada pelo renderer.</p>{/if}

<style>
  .surface,.form-section,.role-section{display:grid;gap:1rem}.surface *{box-sizing:border-box}header{display:flex;justify-content:flex-end}h3,p{margin:0}.muted,.section-heading p{color:var(--tk-muted)}.form-section{max-width:680px;border-top:1px solid var(--tk-border);padding-top:1.15rem}.role-section{padding:1rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md)}.section-heading{display:grid;gap:.25rem}.section-heading p{font-size:.85rem;line-height:1.45}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}label>span{font-weight:500}input,select,textarea{width:100%;min-height:2.55rem;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;padding:.6rem .7rem;transition:border-color .2s ease-out,background-color .2s ease-out}textarea{min-height:6.25rem;resize:vertical}input::placeholder,textarea::placeholder{color:var(--tk-muted)}input:focus,select:focus,textarea:focus{background:var(--tk-surface);border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}button{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);cursor:pointer;padding:.65rem .9rem;font:inherit;background:transparent;transition:opacity .2s ease-out,transform .2s ease-out}button:hover:not(:disabled){opacity:.78}button:focus-visible{outline:2px solid var(--tk-text);outline-offset:2px}button.primary{align-items:center;background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent,var(--tk-bg));display:inline-flex;font-weight:700;justify-content:center;min-width:9.5rem}button:disabled{opacity:.7;cursor:wait}.button-spinner{width:16px;height:16px;border:2px solid color-mix(in srgb,var(--tk-on-accent,#111) 30%,transparent);border-top-color:var(--tk-on-accent,var(--tk-bg));border-radius:50%;animation:button-spin .7s linear infinite}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}footer{display:flex;justify-content:flex-end;padding-top:.25rem}@keyframes button-spin{to{transform:rotate(360deg)}}@media(max-width:680px){footer button{width:100%}}
</style>
