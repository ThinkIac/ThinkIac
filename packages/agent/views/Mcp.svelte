<script>
  import { onMount } from 'svelte'
  let providers = []
  let error = ''
  let saving = false
  let form = { name: '', url: '', api_key: '', type: 'http', enabled: true }

  async function request(path, options = {}) {
    const response = await fetch(`/agent/${path}`, { headers: { 'content-type': 'application/json' }, ...options })
    const payload = await response.json()
    if (!response.ok) throw new Error(payload?.error || 'Não foi possível concluir a operação.')
    return payload.data
  }
  async function load() { providers = await request('mcp/providers') }
  onMount(() => { load().catch(e => error = e.message) })
  async function save() {
    saving = true; error = ''
    try { await request('mcp/providers', { method: 'POST', body: JSON.stringify(form) }); await load(); form = { name: '', url: '', api_key: '', type: 'http', enabled: true } }
    catch (e) { error = e.message } finally { saving = false }
  }
  async function refresh(name) { try { await request(`mcp/providers/${encodeURIComponent(name)}/refresh`, { method: 'POST', body: '{}' }); await load() } catch (e) { error = e.message } }
  async function remove(name) { try { await request(`mcp/providers/${encodeURIComponent(name)}`, { method: 'DELETE' }); await load() } catch (e) { error = e.message } }
</script>

<main data-theme="dark">
  <header><div><h1>Providers MCP</h1><p>Configure tools remotas para o catálogo global do Agent e dos Flows.</p></div></header>
  {#if error}<p class="error" role="alert">{error}</p>{/if}
  <form on:submit|preventDefault={save}>
    <label>Nome<input bind:value={form.name} required pattern="[a-zA-Z0-9-]+" placeholder="github" /></label>
    <label>URL MCP<input bind:value={form.url} required type="url" placeholder="https://servidor.exemplo/mcp" /></label>
    <label>Chave de API<input bind:value={form.api_key} type="password" autocomplete="new-password" placeholder="Opcional" /></label>
    <label>Transporte<select bind:value={form.type}><option value="http">MCP Streamable HTTP</option></select></label>
    <label class="check"><input bind:checked={form.enabled} type="checkbox" />Ativo</label>
    <button type="submit" disabled={saving}>{saving ? 'Salvando…' : 'Salvar provider'}</button>
  </form>
  <section aria-label="Providers configurados">
    {#if !providers.length}<p class="empty">Nenhum provider MCP configurado.</p>{/if}
    {#each providers as provider (provider.name)}
      <article><div><strong>{provider.name}</strong><small>{provider.url}</small><small>{provider.tools} tools, pacote virtual <code>{provider.virtualPackage}</code>{provider.configured ? ', chave configurada' : ''}</small></div><div><button on:click={() => refresh(provider.name)}>Sincronizar tools</button><button class="danger" on:click={() => remove(provider.name)}>Remover</button></div></article>
    {/each}
  </section>
</main>

<style>
  main { min-height: 100dvh; padding: 32px; color: var(--tk-text, #eef2ff); background: var(--tk-bg, #10131c); font: 15px/1.45 system-ui, sans-serif; } header, form, section { max-width: 760px; margin: 0 auto 24px; } h1 { margin: 0; } p { color: var(--tk-muted, #a8b0c2); } form { display:grid; gap:12px; padding:20px; border:1px solid var(--tk-border, #2b3345); border-radius:12px; } label { display:grid; gap:5px; } .check { display:flex; align-items:center; gap:8px; } input, select, button { font:inherit; padding:9px 11px; border-radius:8px; border:1px solid var(--tk-border, #39445d); background:#171d2a; color:inherit; } button { cursor:pointer; background:#405ad8; border:0; } article { display:flex; justify-content:space-between; gap:16px; padding:16px; border-top:1px solid var(--tk-border, #2b3345); } article small { display:block; color:var(--tk-muted, #a8b0c2); } article button + button { margin-left:8px; } .danger { background:#8d3043; } .error { max-width:760px; margin:0 auto 16px; color:#ff9eab; } .empty { text-align:center; padding:24px; } code { font-family:ui-monospace, monospace; }
</style>
