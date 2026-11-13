<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let name = '';
  let email = '';
  let token = '';
  let busy = false;
  let error = '';
  let notice = '';
  $: name = state.name || '';
  $: email = state.email || '';

  async function save() {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: surface.extra.actions.save, values: { name, email, token } }) });
      const result = await response.json();
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível salvar.');
      state = result.state || state; token = ''; notice = result.notice || 'Configurações salvas.';
    } catch (cause) { error = cause.message || 'Não foi possível salvar.'; }
    finally { busy = false; }
  }

  async function copyKey() {
    error = ''; notice = '';
    try { await navigator.clipboard.writeText(state.publicKey || ''); notice = 'Chave pública SSH copiada.'; }
    catch { error = 'Não foi possível copiar. Selecione e copie a chave manualmente.'; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header><p class="eyebrow">{surface.eyebrow}</p><h2>{surface.title}</h2><p>{surface.description}</p></header>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  <section>
    <h3>Chave SSH</h3><p>Cadastre a chave pública no GitHub em Settings → SSH and GPG keys.</p>
    <label for="github-public-key">Chave pública SSH</label>
    <textarea id="github-public-key" readonly rows="3" value={state.publicKey || ''}></textarea>
    <button type="button" on:click={copyKey}>Copiar chave pública</button>
  </section>
  <form on:submit|preventDefault={save}>
    <section>
      <h3>Token do GitHub</h3><p>O token é armazenado no pacote e nunca é devolvido ao navegador depois de salvo.</p>
      <label for="github-token">Token de acesso</label><input id="github-token" type="password" autocomplete="new-password" bind:value={token} placeholder={state.tokenConfigured ? 'Token configurado. Informe outro para substituir.' : 'Cole o token do GitHub'} />
      <label for="github-name">Nome dos commits</label><input id="github-name" autocomplete="name" bind:value={name} />
      <label for="github-email">E-mail dos commits</label><input id="github-email" type="email" autocomplete="email" bind:value={email} />
    </section>
    <footer><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar configurações'}</button></footer>
  </form>
</section>

<style>
  .surface,form,section{display:grid;gap:1rem}.surface *{box-sizing:border-box}header,section,form{max-width:680px}h2,h3,p{margin:0}header p:last-child,section p{color:var(--tk-muted);font-size:.85rem;line-height:1.45}.eyebrow{font-size:.72rem;letter-spacing:.1em;text-transform:uppercase}label{display:grid;gap:.4rem;color:var(--tk-muted);font-size:.85rem}input,textarea{width:100%;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);font:inherit;padding:.65rem}.surface textarea{font-family:var(--tk-mono,monospace);overflow-wrap:anywhere;resize:vertical}button{justify-self:start;border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);background:transparent;color:var(--tk-text);font:inherit;padding:.65rem .9rem;cursor:pointer}footer{display:flex;justify-content:flex-end}.primary{background:var(--tk-accent);color:var(--tk-on-accent,var(--tk-bg));font-weight:700}.primary:disabled{opacity:.6}.notice{border-left:2px solid var(--tk-border-hi);padding:.7rem}.error{color:var(--tk-danger,#d66)}
</style>
