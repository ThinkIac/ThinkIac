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

<div class="vv-container" data-theme={theme}>
  <div class="vv-header">
    <PreviewName {path} {name} />
    <a class="vv-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </div>
  <div class="vv-body">
    <!-- svelte-ignore a11y-media-has-caption -->
    <video class="vv-video" src={rawUrl(path)} controls preload="metadata" />
  </div>
</div>

<style>
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; }

  .vv-container[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818;
    --tk-border: rgba(255,255,255,.09);
    --tk-text: #f5f5f5; --tk-muted: #888888;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }
  .vv-container[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5;
    --tk-border: rgba(0,0,0,.10);
    --tk-text: #1a1a1a; --tk-muted: #666666;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }

  .vv-container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
  }
  .vv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--tk-border);
    background: var(--tk-surface);
    flex-shrink: 0;
  }
  .vv-header :global(.preview-name) { flex:1; }
  .vv-raw-link {
    font-size: 0.75rem;
    color: var(--tk-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .vv-raw-link:hover { color: var(--tk-text); }
  .vv-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 1rem;
    overflow: hidden;
  }
  .vv-video {
    max-width: 100%;
    max-height: 100%;
  }
</style>
