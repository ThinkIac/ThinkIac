<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let apiKey = '', busy = false, error = '', notice = '';

  async function save() {
    if (!apiKey.trim()) { error = 'Informe a chave da API Pixabay.'; return; }
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'pixabay.save-credentials', values: { apiKey } }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível salvar a chave.');
      state = result.state || state; apiKey = ''; notice = result.notice || 'Chave salva.';
    } catch (cause) { error = cause.message || 'Não foi possível salvar a chave.'; }
    finally { busy = false; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header><div><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p class="muted">{surface.description}</p></div><span>{state.configured ? 'Configurada' : 'Sem chave'}</span></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <form on:submit|preventDefault={save}>
    <label>API key<input type="password" bind:value={apiKey} placeholder={state.configured ? `Salva: ${state.apiKeyMasked}` : 'Cole sua chave da Pixabay'} autocomplete="off" /></label>
    <p class="muted">A chave é guardada localmente e não é enviada ao editor.</p>
    <footer><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar chave'}</button></footer>
  </form>
</section>

<style>
  .surface,form{display:grid;gap:1rem}.surface *{box-sizing:border-box}header{display:flex;justify-content:space-between;gap:1rem}h2,p{margin:0}h2{font-size:1.35rem;letter-spacing:-.03em}.eyebrow{color:var(--tk-muted);font-size:.72rem;font-weight:700;letter-spacing:.12em;text-transform:uppercase;margin-bottom:.4rem}.muted,header>span{color:var(--tk-muted);font-size:.85rem;line-height:1.45}form{max-width:680px;border-top:1px solid var(--tk-border);padding-top:1rem}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}input{width:100%;min-height:2.55rem;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);font:inherit;padding:.6rem .7rem}input:focus{border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}footer{display:flex;justify-content:flex-end}.primary{border:1px solid var(--tk-accent);border-radius:var(--tk-radius-md);background:var(--tk-accent);color:var(--tk-on-accent,var(--tk-bg));cursor:pointer;padding:.65rem .9rem;font:inherit;font-weight:700}.primary:disabled{cursor:wait;opacity:.55}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}
</style>
