<script>
  import { onMount } from 'svelte'
  let command = ''
  let isolated = false
  let state = 'idle'
  let result = null
  let theme = 'dark'

  function decodeSource() {
    try {
      const value = new URLSearchParams(location.hash.slice(1)).get('data')
      const payload = JSON.parse(decodeURIComponent(escape(atob(value))))
      command = String(payload.source || '')
    } catch { command = '' }
  }
  function resize() {
    parent.postMessage({ source: 'aurora', type: 'widget:height', detail: document.documentElement.scrollHeight }, '*')
  }
  async function execute(confirmed = false) {
    state = 'running'; result = null
    try {
      const response = await fetch('/terminal/inline-exec', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ command, isolated, confirmed }) })
      result = await response.json()
      state = result.code === 'CONFIRMATION_REQUIRED' ? 'confirm' : result.error ? 'error' : 'done'
    } catch (error) { result = { error: error.message }; state = 'error' }
    setTimeout(resize)
  }
  onMount(() => {
    decodeSource(); theme = localStorage.getItem('think:theme') === 'light' ? 'light' : 'dark'; resize()
    const sync = event => { if (event.key === 'think:theme') theme = event.newValue === 'light' ? 'light' : 'dark' }
    window.addEventListener('storage', sync)
    return () => window.removeEventListener('storage', sync)
  })
</script>

<section class="terminal-card" data-theme={theme}>
  <header><span>Terminal</span><label><input type="checkbox" bind:checked={isolated}> Isolated environment</label><button disabled={!command || state === 'running'} on:click={() => execute(state === 'confirm')}>{state === 'confirm' ? 'Confirm' : state === 'running' ? 'Running' : 'Run'}</button></header>
  <pre><code>{command}</code></pre>
  {#if result}<div class:error={state === 'error' || result.exitCode > 0}><small>{state === 'confirm' ? 'Explicit confirmation required' : result.error || `exit ${result.exitCode}`}</small>{#if result.stdout}<pre>{result.stdout}</pre>{/if}{#if result.stderr}<pre>{result.stderr}</pre>{/if}</div>{/if}
</section>

<style>
  :global(body){margin:0;background:transparent;font-family:var(--tk-font,'Ubuntu',system-ui,sans-serif)}
  [data-theme="dark"]{--tk-bg:#111111;--tk-surface:#181818;--tk-border:rgba(255,255,255,.09);--tk-border-hi:rgba(255,255,255,.16);--tk-text:#f5f5f5;--tk-muted:#888888;--tk-accent:#f5f5f5;--tk-on-accent:#111111;--tk-radius-md:8px;--tk-font:'Ubuntu',system-ui,sans-serif;--tk-mono:'Ubuntu Mono',monospace}[data-theme="light"]{--tk-bg:#ffffff;--tk-surface:#f5f5f5;--tk-border:rgba(0,0,0,.10);--tk-border-hi:rgba(0,0,0,.18);--tk-text:#1a1a1a;--tk-muted:#666666;--tk-accent:#111111;--tk-on-accent:#ffffff;--tk-radius-md:8px;--tk-font:'Ubuntu',system-ui,sans-serif;--tk-mono:'Ubuntu Mono',monospace}
  .terminal-card{border:1px solid var(--tk-border);border-radius:var(--tk-radius-md);overflow:hidden;background:var(--tk-surface);color:var(--tk-text)}
  header{display:flex;align-items:center;gap:12px;padding:8px 10px;font-size:12px} header span{font-weight:700;margin-right:auto} label{color:var(--tk-muted)} button{border:1px solid var(--tk-border-hi);border-radius:var(--tk-radius-md);padding:5px 10px;background:var(--tk-accent);color:var(--tk-on-accent);cursor:pointer} button:disabled{opacity:.5} pre{margin:0;padding:10px;white-space:pre-wrap;font:12px/1.5 var(--tk-mono);background:var(--tk-bg)} div>pre{border-top:1px solid var(--tk-border)} small{display:block;padding:7px 10px;color:var(--tk-muted)} .error small{opacity:.8}
</style>
