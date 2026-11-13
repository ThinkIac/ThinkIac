<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let data = {}, form = emptyForm(), busy = false, error = '', notice = '';
  $: if (state && state !== data) { data = state; form = emptyForm(); }
  $: providers = Array.isArray(data.providers) ? data.providers : [];

  function emptyForm() { return { name: '', url: '', api_key: '', enabled: true }; }
  async function action(action, values, success) {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível concluir a operação.');
      data = result.state || data; notice = result.notice || success;
      return true;
    } catch (cause) { error = cause.message || 'Não foi possível concluir a operação.'; return false; }
    finally { busy = false; }
  }
  async function save() { if (await action('mcp.save-provider', { provider: form }, 'Servidor MCP salvo.')) form = emptyForm(); }
  async function refresh(name) { await action('mcp.refresh-provider', { name }, 'Tools MCP sincronizadas.'); }
  async function remove(name) { if (confirm(`Remover o servidor MCP ${name}?`)) await action('mcp.remove-provider', { name }, 'Servidor MCP removido.'); }
  function edit(provider) { form = { name: provider.name, url: provider.url, api_key: '', enabled: !provider.disabled }; }
</script>

<section class="surface" aria-busy={busy}>
  <header><div><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></div></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <form on:submit|preventDefault={save}>
    <label>Nome<input bind:value={form.name} required pattern="[a-zA-Z0-9-]+" placeholder="github" /></label>
    <label>URL MCP<input bind:value={form.url} required type="url" placeholder="https://servidor.exemplo/mcp" /></label>
    <label>Chave de API<input bind:value={form.api_key} type="password" autocomplete="new-password" placeholder="Opcional. Deixe em branco para manter a atual." /></label>
    <label class="toggle"><span>Ativo</span><input bind:checked={form.enabled} type="checkbox" /></label>
    <footer><button type="button" on:click={() => form = emptyForm()} disabled={busy}>Limpar</button><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar servidor'}</button></footer>
  </form>
  <section class="providers" aria-label="Servidores MCP configurados">
    <div><h3>Servidores conectados</h3><p class="muted">Após sincronizar, as tools ficam disponíveis ao Agent e aos Flows como tools nativas.</p></div>
    {#each providers as provider (provider.name)}
      <article class:off={provider.disabled}><div><strong>{provider.name}</strong><small>{provider.url}</small><small>{provider.tools} tool{provider.tools === 1 ? '' : 's'} sincronizada{provider.tools === 1 ? '' : 's'}{provider.configured ? ' · chave configurada' : ''}</small>{#if provider.toolNames?.length}<small><code>{provider.toolNames.join(', ')}</code></small>{/if}</div><div class="actions"><button on:click={() => edit(provider)} disabled={busy}>Editar</button><button on:click={() => refresh(provider.name)} disabled={busy}>Sincronizar</button><button class="danger" on:click={() => remove(provider.name)} disabled={busy}>Remover</button></div></article>
    {:else}<p class="empty">Nenhum servidor MCP configurado.</p>{/each}
  </section>
</section>

<style>
  .surface,form,.providers{display:grid;gap:1rem}.surface *{box-sizing:border-box}h2,h3,p{margin:0}h2{font-size:1.5rem;letter-spacing:-.03em}h3{font-size:1rem}.eyebrow,.muted,small{color:var(--tk-muted)}.eyebrow{font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}.muted{font-size:.85rem;line-height:1.45}form{max-width:680px;border-top:1px solid var(--tk-border);padding-top:1.15rem}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}input,button{font:inherit}input{width:100%;min-height:2.55rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);padding:.6rem .7rem}.toggle{display:flex;align-items:center;justify-content:space-between}.toggle input{width:1.15rem;min-height:1.15rem;accent-color:var(--tk-accent)}footer,.actions{display:flex;gap:.6rem;justify-content:flex-end}button{padding:.6rem .8rem;cursor:pointer;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text)}button:disabled{cursor:wait;opacity:.55}.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-bg);font-weight:700}.danger{color:var(--tk-danger,#ff9b9b)}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}.providers{border-top:1px solid var(--tk-border);padding-top:1.15rem}.providers article{display:flex;align-items:flex-start;justify-content:space-between;gap:1rem;border-top:1px solid var(--tk-border);padding:1rem 0}.providers small{display:block;margin-top:.2rem}.off{opacity:.6}.empty{padding:.8rem 0;text-align:center}code{font-family:var(--tk-mono,monospace);overflow-wrap:anywhere}@media(max-width:680px){.providers article,footer,.actions{align-items:stretch;flex-direction:column}.actions button,footer button{width:100%}}
</style>
