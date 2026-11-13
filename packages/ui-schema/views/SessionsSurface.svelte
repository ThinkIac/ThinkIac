<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let data = {}, form = {}, busy = false, error = '', notice = '';
  $: if (state && state !== data) {
    data = state;
    form = {
      idPrefix: state.idPrefix || '',
      defaultModel: state.defaultModel || '',
      enabled: Boolean(state.title?.enabled),
      model: state.title?.model || '',
      every: state.title?.every || 1,
    };
  }
  $: options = Array.isArray(data.options) ? data.options : [];
  $: groups = [...new Set(options.map((option) => option.group))].map((group) => ({ group, options: options.filter((option) => option.group === group) }));

  async function save() {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sessions.save-preferences', values: { ...form, defaultModel: form.defaultModel || null, model: form.model || null, every: Number(form.every) } }),
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível salvar.');
      data = result.state || data;
      notice = result.notice || 'Preferências atualizadas.';
    } catch (cause) { error = cause.message || 'Não foi possível salvar.'; }
    finally { busy = false; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header><div><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></div></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <form on:submit|preventDefault={save}>
    <section>
      <div><h3>Novas conversas</h3><p class="muted">Sem alias, o identificador é somente aleatório. Um alias cria, por exemplo, <code>think-abc123</code>.</p></div>
      <label>Alias da sessão<input bind:value={form.idPrefix} maxlength="25" placeholder="Somente ID aleatório" autocapitalize="none" /></label>
      <label>Modelo padrão<select bind:value={form.defaultModel}><option value="">Automático</option>{#each groups as { group, options }}<optgroup label={group}>{#each options as option}<option value={option.id} disabled={!option.poolEnabled}>{option.label}{option.poolEnabled ? '' : ' (pool desativada)'}</option>{/each}</optgroup>{/each}</select></label>
    </section>
    <section>
      <div><h3>Títulos automáticos</h3><p class="muted">Resume a conversa periodicamente para substituir o identificador por um título.</p></div>
      <label class="toggle"><span>Ativar títulos automáticos</span><input type="checkbox" bind:checked={form.enabled} /></label>
      <label>Modelo do resumo<select bind:value={form.model} disabled={!form.enabled}><option value="">Padrão do runtime</option>{#each groups as { group, options }}<optgroup label={group}>{#each options as option}<option value={option.id} disabled={!option.poolEnabled}>{option.label}{option.poolEnabled ? '' : ' (pool desativada)'}</option>{/each}</optgroup>{/each}</select></label>
      <label>Atualizar a cada N mensagens<input type="number" min="1" bind:value={form.every} disabled={!form.enabled} /></label>
    </section>
    <footer><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar preferências'}</button></footer>
  </form>
</section>

<style>
  .surface,form,section{display:grid;gap:1rem}.surface *{box-sizing:border-box}h2,h3,p{margin:0}h2{font-size:1.5rem;letter-spacing:-.03em}h3{font-size:1rem}.eyebrow{color:var(--tk-muted);font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}.muted{color:var(--tk-muted);font-size:.85rem;line-height:1.45}form{max-width:680px}section{border-top:1px solid var(--tk-border);padding-top:1.15rem}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}input,select{width:100%;min-height:2.55rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);font:inherit;padding:.6rem .7rem}input:focus,select:focus{border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}.toggle{display:flex;align-items:center;justify-content:space-between}.toggle input{width:1.15rem;min-height:1.15rem;accent-color:var(--tk-accent)}footer{display:flex;justify-content:flex-end}.primary{border:1px solid var(--tk-accent);border-radius:var(--tk-radius-md);background:var(--tk-accent);color:var(--tk-bg);cursor:pointer;padding:.65rem .9rem;font:inherit;font-weight:700}.primary:disabled{cursor:wait;opacity:.55}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}code{font-family:var(--tk-mono,monospace)}
</style>
