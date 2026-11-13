<script>
  import { onMount, onDestroy } from 'svelte';
  import { rawUrl } from './lib/api.js';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path;

  let theme = 'dark';
  let unsubscribe;

  $: name = path ? path.split('/').pop() : '';

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((t) => (theme = t));
  });
  onDestroy(() => unsubscribe && unsubscribe());
</script>

<div class="pv-container" data-theme={theme}>
  <div class="pv-header">
    <PreviewName {path} {name} />
    <a class="pv-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </div>
  <div class="pv-body">
    <iframe class="pv-iframe" src={rawUrl(path)} title={name}></iframe>
  </div>
</div>

<style>
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; }

  .pv-container[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818;
    --tk-border: rgba(255,255,255,.09);
    --tk-text: #f5f5f5; --tk-muted: #888888;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }
  .pv-container[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5;
    --tk-border: rgba(0,0,0,.10);
    --tk-text: #1a1a1a; --tk-muted: #666666;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }

  .pv-container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
  }
  .pv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--tk-border);
    background: var(--tk-surface);
    flex-shrink: 0;
  }
  .pv-header :global(.preview-name) { flex:1; }
  .pv-raw-link {
    font-size: 0.75rem;
    color: var(--tk-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .pv-raw-link:hover { color: var(--tk-text); }
  .pv-body { flex: 1; }
  .pv-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
</style>
