<script>
  import { onMount } from 'svelte'

  let theme = 'dark'
  let state = { name: '', email: '', publicKey: '', configured: false }
  let token = ''
  let clearToken = false
  let loading = true
  let saving = false
  let error = ''
  let notice = ''

  function readTheme() { try { theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark' } catch (_) {} }
  function syncTheme(event) { if (event.key === 'agent:theme') readTheme() }

  async function load() {
    loading = true; error = ''
    try {
      const response = await fetch('/github/settings', { cache: 'no-store' })
      const data = await response.json()
      if (!response.ok || data.status >= 400) throw new Error(data.error || 'Não foi possível carregar as configurações.')
      state = data
    } catch (cause) { error = cause.message || 'Não foi possível carregar as configurações.' }
    finally { loading = false }
  }

  async function save() {
    saving = true; error = ''; notice = ''
    try {
      const response = await fetch('/github/settings', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: state.name, email: state.email, token: token || undefined, clearToken }),
      })
      const data = await response.json()
      if (!response.ok || data.status >= 400) throw new Error(data.error || 'Não foi possível salvar.')
      state = data; token = ''; clearToken = false; notice = 'Configurações salvas.'
    } catch (cause) { error = cause.message || 'Não foi possível salvar.' }
    finally { saving = false }
  }

  async function copyKey() {
    error = ''; notice = ''
    try { await navigator.clipboard.writeText(state.publicKey); notice = 'Chave pública SSH copiada.' }
    catch (_) { error = 'O navegador não permitiu copiar. Selecione e copie a chave manualmente.' }
  }

  onMount(() => {
    readTheme(); window.addEventListener('storage', syncTheme); load()
    return () => window.removeEventListener('storage', syncTheme)
  })
</script>

<main class="settings" data-theme={theme} aria-busy={loading || saving}>
  <header><p class="eyebrow">Credenciais de integração</p><h1>GitHub</h1><p class="intro">Configure a chave SSH para operações Git e um token para repositórios, Issues e Pull Requests.</p></header>
  {#if loading}<p class="status" role="status">Carregando…</p>{/if}
  {#if error}<p class="notice error" role="alert">{error}</p>{/if}
  {#if notice}<p class="notice" role="status">{notice}</p>{/if}
  {#if !loading}
    <section aria-labelledby="ssh-heading">
      <h2 id="ssh-heading">Chave SSH</h2>
      <p>Cadastre esta chave pública no GitHub em Settings → SSH and GPG keys. A chave privada fica armazenada no diretório privado do pacote.</p>
      <label for="public-key">Chave pública SSH</label>
      <textarea id="public-key" readonly rows="3" bind:value={state.publicKey} aria-label="Chave pública SSH gerada"></textarea>
      <button type="button" on:click={copyKey}>Copiar chave pública</button>
    </section>
    <section aria-labelledby="token-heading">
      <h2 id="token-heading">Token do GitHub</h2>
      <p>Use um Personal Access Token com permissões necessárias para os repositórios, branches, Issues e Pull Requests desejados.</p>
      <label for="github-token">Token de acesso</label>
      <input id="github-token" type="password" autocomplete="new-password" bind:value={token} placeholder={state.configured ? 'Token configurado. Informe um novo para substituir.' : 'Cole o token do GitHub'} />
      {#if state.configured}<label class="check"><input type="checkbox" bind:checked={clearToken} /> Remover o token salvo</label>{/if}
    </section>
    <section aria-labelledby="identity-heading">
      <h2 id="identity-heading">Identidade dos commits</h2>
      <label for="git-name">Nome</label><input id="git-name" autocomplete="name" bind:value={state.name} />
      <label for="git-email">E-mail</label><input id="git-email" type="email" autocomplete="email" bind:value={state.email} />
    </section>
    <footer><button class="primary" type="button" disabled={saving} on:click={save}>{saving ? 'Salvando…' : 'Salvar configurações'}</button></footer>
  {/if}
</main>

<style>
  .settings{--tk-bg:#111111;--tk-surface:#181818;--tk-surface-2:#1f1f1f;--tk-border:rgba(255,255,255,.09);--tk-border-hi:rgba(255,255,255,.16);--tk-text:#f5f5f5;--tk-muted:#888888;--tk-accent:#f5f5f5;--tk-on-accent:#111111;--tk-radius-md:8px;min-height:100dvh;background:var(--tk-bg);color:var(--tk-text);font:14px 'Ubuntu',system-ui,sans-serif;padding:24px;box-sizing:border-box}
  .settings[data-theme='light']{--tk-bg:#ffffff;--tk-surface:#f5f5f5;--tk-surface-2:#ececec;--tk-border:rgba(0,0,0,.10);--tk-border-hi:rgba(0,0,0,.18);--tk-text:#1a1a1a;--tk-muted:#666666;--tk-accent:#111111;--tk-on-accent:#ffffff}
  header,section,footer{max-width:760px;margin:0 auto}header{margin-bottom:24px}.eyebrow{color:var(--tk-muted);font-size:12px;text-transform:uppercase;letter-spacing:.08em}h1{font-size:24px;margin:5px 0}h2{font-size:16px;margin:0 0 8px}p{line-height:1.5}.intro{color:var(--tk-muted);margin:8px 0 0}section{display:grid;gap:10px;border-top:1px solid var(--tk-border);padding:20px 0}section p{color:var(--tk-muted);font-size:13px;margin:0 0 4px}label{font-size:13px;color:var(--tk-muted)}input,textarea{box-sizing:border-box;width:100%;background:var(--tk-surface);border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;padding:10px}textarea{font-family:monospace;resize:vertical;overflow-wrap:anywhere}button{justify-self:start;background:transparent;border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);color:var(--tk-text);font:inherit;padding:9px 12px;cursor:pointer}button:focus-visible,input:focus-visible,textarea:focus-visible{outline:2px solid var(--tk-border-hi);outline-offset:2px}.check{display:flex;align-items:center;gap:8px}.check input{width:auto}.primary{background:var(--tk-accent);color:var(--tk-on-accent);font-weight:600}footer{display:flex;justify-content:flex-end}.notice,.status{max-width:760px;margin:12px auto;padding:10px 12px;border-left:2px solid var(--tk-border-hi)}.error{color:#d66}button:disabled{opacity:.6;cursor:wait}
</style>
