<script>
  import { onMount, onDestroy } from 'svelte';
  import { rawUrl } from './lib/api.js';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path;

  let theme = 'dark';
  let unsubscribe;
  let loading = true;
  let error = false;
  let dimensions = '';

  $: name = path ? path.split('/').pop() : '';

  function handleLoad(event) {
    const { naturalWidth, naturalHeight } = event.currentTarget;
    dimensions = naturalWidth && naturalHeight ? `${naturalWidth} × ${naturalHeight} px` : '';
    loading = false;
  }

  function handleError() {
    loading = false;
    error = true;
  }

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((t) => (theme = t));
  });
  onDestroy(() => unsubscribe && unsubscribe());
</script>

<div class="iv-container" data-theme={theme}>
  <div class="iv-header">
    <PreviewName {path} {name} />
    <a class="iv-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </div>
  <div class="iv-body">
    {#if error}
      <div class="iv-status iv-error">Couldn't load this image.</div>
    {:else}
      {#if loading}
        <div class="iv-status" aria-live="polite">Loading image…</div>
      {/if}
      <figure class:iv-hidden={loading}>
        <img class="iv-img" src={rawUrl(path)} alt={`Image: ${name}`} on:load={handleLoad} on:error={handleError} />
        <figcaption>{name}{dimensions ? ` · ${dimensions}` : ''}</figcaption>
      </figure>
    {/if}
  </div>
</div>

<style>
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; }

  .iv-container[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818;
    --tk-border: rgba(255,255,255,.09);
    --tk-text: #f5f5f5; --tk-muted: #888888;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }
  .iv-container[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5;
    --tk-border: rgba(0,0,0,.10);
    --tk-text: #1a1a1a; --tk-muted: #666666;
    --tk-font: 'Ubuntu', system-ui, sans-serif;
  }

  .iv-container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
  }
  .iv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--tk-border);
    background: var(--tk-surface);
    flex-shrink: 0;
  }
  .iv-header :global(.preview-name) { flex:1; }
  .iv-raw-link {
    font-size: 0.75rem;
    color: var(--tk-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .iv-raw-link:hover { color: var(--tk-text); }
  .iv-body {
    flex: 1;
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: auto;
    padding: 1rem;
  }
  figure {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.65rem;
    min-width: 0;
    max-width: 100%;
    max-height: 100%;
    margin: 0;
  }
  .iv-hidden { display: none; }
  .iv-img {
    max-width: 100%;
    max-height: 100%;
    object-fit: contain;
  }
  figcaption {
    max-width: 100%;
    overflow: hidden;
    color: var(--tk-muted);
    font-size: 0.75rem;
    text-align: center;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .iv-status {
    padding: 2rem;
    text-align: center;
    color: var(--tk-muted);
    font-size: 0.875rem;
  }
  .iv-error { color: #e05d5d; }
</style>
