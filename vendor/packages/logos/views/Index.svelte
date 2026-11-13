<script>
  import { onMount } from 'svelte';

  let theme = 'dark';

  function readTheme() {
    try {
      theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark';
    } catch (_) {
      theme = 'dark';
    }
  }

  function syncTheme(event) {
    if (event.key === 'agent:theme') readTheme();
  }

  onMount(() => {
    readTheme();
    window.addEventListener('storage', syncTheme);
    return () => window.removeEventListener('storage', syncTheme);
  });
</script>

<svelte:head>
  <title>Lógos</title>
</svelte:head>

<main data-theme={theme}>
  <section aria-labelledby="logos-title">
    <p class="eyebrow">ThinkIac runtime</p>
    <h1 id="logos-title">Lógos</h1>
    <p class="description">Runtime de pacotes, ciclos de vida e superfícies do ThinkIac.</p>
  </section>
</main>

<style>
  main {
    --tk-bg:#111111;
    --tk-surface:#181818;
    --tk-surface-2:#1f1f1f;
    --tk-border:rgba(255,255,255,.09);
    --tk-border-hi:rgba(255,255,255,.16);
    --tk-text:#f5f5f5;
    --tk-muted:#888888;
    --tk-accent:#f5f5f5;
    --tk-on-accent:#111111;
    --tk-radius-md:8px;
    --tk-radius-lg:14px;
    --tk-font:'Ubuntu',system-ui,sans-serif;
    align-items:center;
    background:var(--tk-bg);
    box-sizing:border-box;
    color:var(--tk-text);
    display:flex;
    font-family:var(--tk-font);
    justify-content:center;
    min-height:100dvh;
    padding:24px;
  }

  main[data-theme='light'] {
    --tk-bg:#ffffff;
    --tk-surface:#f5f5f5;
    --tk-surface-2:#ececec;
    --tk-border:rgba(0,0,0,.10);
    --tk-border-hi:rgba(0,0,0,.18);
    --tk-text:#1a1a1a;
    --tk-muted:#666666;
    --tk-accent:#111111;
    --tk-on-accent:#ffffff;
  }

  section {
    background:var(--tk-surface);
    border:1px solid var(--tk-border);
    border-radius:var(--tk-radius-lg);
    box-sizing:border-box;
    max-width:560px;
    padding:32px;
    width:100%;
  }

  p, h1 { margin:0; }
  .eyebrow { color:var(--tk-muted); font-size:12px; letter-spacing:.08em; text-transform:uppercase; }
  h1 { font-size:32px; font-weight:500; margin-top:8px; }
  .description { color:var(--tk-muted); line-height:1.5; margin-top:12px; }
</style>
