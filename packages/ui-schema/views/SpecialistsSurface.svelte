<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  const blank = () => ({ id: '', name: '', description: '', prompt: '', agents: [], toolsMode: 'unrestricted', tools: [], provider: '', model: '', fallbackModel: '' });
  let selectedId = '';
  let editing = false;
  let form = blank();
  let busy = false;
  let error = '';
  let notice = '';
  let preview = '';
  let query = '';

  $: specialists = Array.isArray(state.specialists) ? state.specialists : [];
  $: agents = Array.isArray(state.agents) ? state.agents : [];
  $: selected = specialists.find((item) => item.id === selectedId) || null;
  $: shown = specialists.filter((item) => `${item.name} ${item.description || ''}`.toLowerCase().includes(query.trim().toLowerCase()));

  function beginCreate() { selectedId = ''; form = blank(); preview = ''; error = ''; editing = true; }
  async function select(item) {
    selectedId = item.id; editing = false; error = ''; preview = '';
    if (item.kind !== 'custom') return;
    try {
      const response = await fetch(`/specialists/catalog/${encodeURIComponent(item.id)}`);
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || 'Não foi possível carregar o especialista.');
      const detail = payload?.data ?? payload;
      form = { id: detail.id, name: detail.name || '', description: detail.description || '', prompt: detail.prompt || '', agents: detail.agents || [], toolsMode: detail.tools ? 'allowlist' : 'unrestricted', tools: detail.tools || [], provider: detail.provider || '', model: detail.model || '', fallbackModel: detail.fallbackModel || '' };
      preview = detail.composedPrompt || '';
    } catch (cause) { error = cause.message; }
  }
  function edit() { if (selected?.kind === 'custom') { editing = true; error = ''; } }
  function toggleAgent(pkg) { form = { ...form, agents: form.agents.includes(pkg) ? form.agents.filter((id) => id !== pkg) : [...form.agents, pkg] }; }
  function readTools(value) { form = { ...form, tools: value.split(/[\n,]/).map((item) => item.trim()).filter(Boolean) }; }
  async function action(action, values) {
    const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, values }) });
    const result = await response.json();
    if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Ação não concluída.');
    if (result.state) state = result.state;
    if (result.notice) notice = result.notice;
    return result;
  }
  async function save() {
    if (!form.name.trim()) { error = 'Informe um nome.'; return; }
    busy = true; error = ''; notice = '';
    const values = { id: form.id, name: form.name.trim(), description: form.description.trim() || null, prompt: form.prompt.trim() || null, agents: form.agents, tools: form.toolsMode === 'allowlist' ? form.tools : null, provider: form.provider.trim() || null, model: form.model.trim() || null, fallbackModel: form.fallbackModel.trim() || null };
    try { await action(form.id ? 'specialists.update' : 'specialists.create', values); editing = false; selectedId = form.id || ''; }
    catch (cause) { error = cause.message; } finally { busy = false; }
  }
  async function refreshPreview() {
    busy = true; error = '';
    try { preview = (await action('specialists.preview', { prompt: form.prompt, agents: form.agents })).preview || ''; }
    catch (cause) { error = cause.message; } finally { busy = false; }
  }
  async function remove() {
    if (!selected || !confirm(`Remover ${selected.name}?`)) return;
    busy = true; error = ''; notice = '';
    try { await action('specialists.remove', { id: selected.id }); selectedId = ''; editing = false; form = blank(); preview = ''; }
    catch (cause) { error = cause.message; } finally { busy = false; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header class="heading"><div><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></div><button class="primary" on:click={beginCreate}>Novo especialista</button></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}{#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <div class="layout">
    <aside><input aria-label="Buscar especialistas" placeholder="Buscar..." bind:value={query} />{#each shown as item (item.id)}<button class:selected={item.id === selectedId} class="item" on:click={() => select(item)}><strong>{item.name}</strong><small>{item.kind === 'custom' ? 'Personalizado' : 'Do pacote'}{item.description ? ` · ${item.description}` : ''}</small></button>{:else}<p class="muted">Nenhum especialista encontrado.</p>{/each}</aside>
    <main>
      {#if editing}
        <div class="actions"><h3>{form.id ? 'Editar especialista' : 'Novo especialista'}</h3><span><button on:click={() => { editing = false; error = ''; }}>Cancelar</button><button class="primary" disabled={busy} on:click={save}>Salvar</button></span></div>
        <label>Nome<input bind:value={form.name} placeholder="Ex.: Triagem de suporte" /></label>
        <label>Descrição<input bind:value={form.description} placeholder="Uma linha para o catálogo" /></label>
        <label>Instruções<textarea rows="7" bind:value={form.prompt} placeholder="Papel, contexto e instruções deste especialista..."></textarea></label>
        <fieldset><legend>Compor com AGENT.md</legend>{#each agents as agent (agent.pkg)}<label class="check"><input type="checkbox" checked={form.agents.includes(agent.pkg)} on:change={() => toggleAgent(agent.pkg)} /><span><strong>{agent.name}</strong><small>{agent.description || agent.pkg}</small></span></label>{/each}</fieldset>
        <div class="actions"><h3>Prévia do prompt</h3><button disabled={busy} on:click={refreshPreview}>Atualizar prévia</button></div><pre>{preview || '(adicione instruções ou um AGENT.md)'}</pre>
        <fieldset><legend>Ferramentas</legend><label class="check"><input type="radio" bind:group={form.toolsMode} value="unrestricted" /> Sem restrição</label><label class="check"><input type="radio" bind:group={form.toolsMode} value="allowlist" /> Lista permitida</label>{#if form.toolsMode === 'allowlist'}<label>Nomes das ferramentas, um por linha ou separados por vírgula<textarea rows="4" value={form.tools.join('\n')} on:input={(event) => readTools(event.currentTarget.value)} /></label>{/if}</fieldset>
        <div class="columns"><label>Provider<input bind:value={form.provider} placeholder="auto" /></label><label>Modelo<input bind:value={form.model} placeholder="auto" /></label><label>Fallback<input bind:value={form.fallbackModel} placeholder="nenhum" /></label></div>
      {:else if selected}
        <div class="actions"><div><h3>{selected.name}</h3><p class="muted">{selected.description || 'Sem descrição.'}</p></div>{#if selected.kind === 'custom'}<span><button on:click={edit}>Editar</button><button class="danger" disabled={busy} on:click={remove}>Remover</button></span>{:else}<small>Gerado pelo AGENT.md do pacote.</small>{/if}</div>
        <p><strong>Ferramentas:</strong> {selected.tools ? `${selected.tools.length} permitidas` : 'sem restrição'}</p>
      {:else}<p class="muted">Selecione um especialista ou crie um perfil novo.</p>{/if}
    </main>
  </div>
</section>

<style>
  .surface{display:grid;gap:1rem;color:var(--tk-text)}.heading,.actions{display:flex;gap:1rem;justify-content:space-between;align-items:start}.heading h2,.heading p,.actions h3,.actions p{margin:0}.eyebrow{color:var(--tk-muted);font-size:.75rem;text-transform:uppercase}.muted,small{color:var(--tk-muted)}.notice{border-left:2px solid var(--tk-border-hi);padding:.7rem}.error{color:var(--tk-danger,#ff9b9b)}.layout{display:grid;grid-template-columns:230px minmax(0,1fr);border:1px solid var(--tk-border);min-height:560px}.layout aside{border-right:1px solid var(--tk-border);padding:.75rem;display:grid;align-content:start;gap:.45rem}.layout main{padding:1rem;display:grid;align-content:start;gap:1rem}.item{display:grid;text-align:left;gap:.2rem}.item.selected{background:var(--tk-surface-2);border-color:var(--tk-border-hi)}label,fieldset{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.88rem}fieldset{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);padding:1rem}.check{grid-template-columns:auto 1fr;align-items:start}.check small{display:block}input,textarea,button{font:inherit}input,textarea{width:100%;box-sizing:border-box;min-height:2.5rem;background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);padding:.55rem .65rem}textarea{resize:vertical}button{background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);cursor:pointer;padding:.6rem .8rem}button.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent)}button.danger{color:var(--tk-danger,#ff9b9b)}.actions>span{display:flex;gap:.5rem}pre{margin:0;max-height:260px;overflow:auto;white-space:pre-wrap;background:var(--tk-surface-2);border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);padding:.8rem}.columns{display:grid;grid-template-columns:repeat(3,1fr);gap:.75rem}@media(max-width:700px){.layout{grid-template-columns:1fr}.layout aside{border-right:0;border-bottom:1px solid var(--tk-border)}.columns{grid-template-columns:1fr}.heading,.actions{flex-wrap:wrap}}
</style>
