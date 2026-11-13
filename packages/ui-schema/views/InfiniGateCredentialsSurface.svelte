<script>
  export let surface;
  export let state = {};
  export let actionUrl = '';

  let depositKey = '', withdrawKey = '', webhookKey = '', webhookUrl = '';
  let loaded = '', busy = false, error = '', notice = '';

  $: {
    const next = JSON.stringify(state || {});
    if (next !== loaded) {
      loaded = next;
      depositKey = ''; withdrawKey = ''; webhookKey = '';
      webhookUrl = state?.webhookUrl || '';
    }
  }

  async function save() {
    busy = true; error = ''; notice = '';
    try {
      const response = await fetch(actionUrl, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'infinigate.save-credentials', values: { depositKey, withdrawKey, webhookKey, webhookUrl } }),
      });
      const result = await response.json();
      if (!response.ok || result.status >= 400) throw new Error(result.mensagem || result.error || 'Não foi possível salvar as credenciais.');
      state = result.state || state;
      depositKey = ''; withdrawKey = ''; webhookKey = '';
      notice = result.notice || 'Credenciais salvas.';
    } catch (cause) { error = cause.message || 'Não foi possível salvar as credenciais.'; }
    finally { busy = false; }
  }
</script>

<section class="surface" aria-busy={busy}>
  <header>
    <small>{surface?.eyebrow || 'CHAVES DE INTEGRAÇÃO'}</small>
    <h3>{surface?.title || 'InfiniGate'}</h3>
    <p>{surface?.description}</p>
  </header>

  <form on:submit|preventDefault={save}>
    <label>Chave de depósito
      <input type="password" bind:value={depositKey} placeholder={state.depositKeyConfigured ? `Salva: ${state.depositKeyMasked}` : 'Cole a chave de depósito'} autocomplete="off" />
    </label>
    <label>Chave de saque
      <input type="password" bind:value={withdrawKey} placeholder={state.withdrawKeyConfigured ? `Salva: ${state.withdrawKeyMasked}` : 'Cole a chave de saque'} autocomplete="off" />
    </label>
    <label>Chave de webhook
      <input type="password" bind:value={webhookKey} placeholder={state.webhookKeyConfigured ? `Salva: ${state.webhookKeyMasked}` : 'Cole a chave de webhook'} autocomplete="off" />
    </label>
    <label>URL do webhook padrão <span>Opcional se ela já estiver configurada no painel da InfiniGate.</span>
      <input type="url" bind:value={webhookUrl} placeholder="https://seu-dominio.com/webhooks/infinigate" />
    </label>
    <p class="hint">Campos de chave em branco preservam as credenciais já salvas. As chaves nunca são devolvidas ao navegador.</p>
    <footer><button class="primary" disabled={busy}>{busy ? 'Salvando…' : 'Salvar credenciais'}</button></footer>
  </form>
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
</section>

<style>
  .surface,form{display:grid;gap:1rem}.surface{max-width:680px}.surface *{box-sizing:border-box}header{display:grid;gap:.3rem}h3,p{margin:0}header small{color:var(--tk-muted);font-size:.68rem;font-weight:700;letter-spacing:.09em}header p,.hint,label>span{color:var(--tk-muted);font-size:.85rem;line-height:1.45}form{border-top:1px solid var(--tk-border);padding-top:1.15rem}label{color:var(--tk-muted);display:grid;font-size:.85rem;gap:.4rem}input{background:transparent;border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;min-height:2.55rem;padding:.6rem .7rem;width:100%}input:focus{background:var(--tk-surface);border-color:var(--tk-border-hi);outline:2px solid var(--tk-border);outline-offset:1px}input::placeholder{color:var(--tk-muted)}footer{display:flex;justify-content:flex-end;padding-top:.25rem}button{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);cursor:pointer;font:inherit;padding:.65rem .9rem}button.primary{background:var(--tk-accent);border-color:var(--tk-accent);color:var(--tk-on-accent);font-weight:700}button:disabled{cursor:wait;opacity:.7}.notice{border-left:2px solid var(--tk-border-hi);padding:.75rem}.error{color:var(--tk-danger,#ff9b9b)}@media(max-width:680px){footer button{width:100%}}
</style>
