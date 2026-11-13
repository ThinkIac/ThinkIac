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

<div class="av-container" data-theme={theme}>
  <div class="av-header">
    <PreviewName {path} {name} />
    <a class="av-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </div>
  <div class="av-body">
    <div class="av-icon">
      <svg viewBox="0 0 24 24" width="56" height="56" fill="none" stroke="currentColor" stroke-width="1.5">
        <path d="M9 18V5l12-2v13" />
        <circle cx="6" cy="18" r="3" />
        <circle cx="18" cy="16" r="3" />
      </svg>
    </div>
    <!-- svelte-ignore a11y-media-has-caption -->
    <audio class="av-audio" src={rawUrl(path)} controls preload="metadata" />
  </div>
</div>

<style>
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; }

  .av-container[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818;
    --tk-border: rgba(255,255,255,.09);
    --tk-text: #f5f5f5; --tk-muted: #888888;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }
  .av-container[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5;
    --tk-border: rgba(0,0,0,.10);
    --tk-text: #1a1a1a; --tk-muted: #666666;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }

  .av-container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
  }
  .av-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--tk-border);
    background: var(--tk-surface);
    flex-shrink: 0;
  }
  .av-header :global(.preview-name) { flex:1; }
  .av-raw-link {
    font-size: 0.75rem;
    color: var(--tk-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .av-raw-link:hover { color: var(--tk-text); }
  .av-body {
    flex: 1;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 1.5rem;
    padding: 1rem;
  }
  .av-icon { color: var(--tk-muted); }
  .av-audio { width: 100%; max-width: 420px; }
</style>
