<script>
  import { onMount, onDestroy } from 'svelte';
  import { rawUrl, fetchRaw } from './lib/api.js';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path;

  const MAX_BYTES = 2 * 1024 * 1024;

  let theme = 'dark';
  let unsubscribe;
  let content = '';
  let loading = true;
  let error = null;
  let tooLarge = false;

  $: name = path ? path.split('/').pop() : '';

  async function load() {
    loading = true;
    error = null;
    tooLarge = false;
    try {
      const res = await fetchRaw(path);
      if (!res.ok) {
        error = `HTTP ${res.status}`;
        loading = false;
        return;
      }
      const len = Number(res.headers.get('content-length') || 0);
      if (len > MAX_BYTES) {
        tooLarge = true;
        loading = false;
        return;
      }
      content = await res.text();
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((t) => (theme = t));
    load();
  });
  onDestroy(() => unsubscribe && unsubscribe());
</script>

<div class="tv-container" data-theme={theme}>
  <div class="tv-header">
    <PreviewName {path} {name} />
    <a class="tv-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </div>
  <div class="tv-body">
    {#if loading}
      <div class="tv-status">Loading…</div>
    {:else if error}
      <div class="tv-status tv-error">{error}</div>
    {:else if tooLarge}
      <div class="tv-status">
        This file is too large to preview.
        <a href={rawUrl(path)} download={name}>Download file</a>
      </div>
    {:else}
      <pre class="tv-pre">{content}</pre>
    {/if}
  </div>
</div>

<style>
  :global(html), :global(body) { margin: 0; padding: 0; height: 100%; }

  .tv-container[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818; --tk-surface-2: #1f1f1f;
    --tk-border: rgba(255,255,255,.09); --tk-border-hi: rgba(255,255,255,.16);
    --tk-text: #f5f5f5; --tk-muted: #888888; --tk-muted-2: rgba(136,136,136,.5);
    --tk-accent: #f5f5f5; --tk-on-accent: #111111;
    --tk-radius-md: 8px; --tk-radius-lg: 14px;
    --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
  }
  .tv-container[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5; --tk-surface-2: #ececec;
    --tk-border: rgba(0,0,0,.10); --tk-border-hi: rgba(0,0,0,.18);
    --tk-text: #1a1a1a; --tk-muted: #666666; --tk-muted-2: rgba(0,0,0,.4);
    --tk-accent: #111111; --tk-on-accent: #ffffff;
    --tk-radius-md: 8px; --tk-radius-lg: 14px;
    --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
  }

  .tv-container {
    display: flex;
    flex-direction: column;
    height: 100dvh;
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
  }
  .tv-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.75rem;
    padding: 0.6rem 0.9rem;
    border-bottom: 1px solid var(--tk-border);
    background: var(--tk-surface);
    flex-shrink: 0;
  }
  .tv-header :global(.preview-name) { flex:1; }
  .tv-raw-link {
    font-size: 0.75rem;
    color: var(--tk-muted);
    text-decoration: none;
    flex-shrink: 0;
  }
  .tv-raw-link:hover { color: var(--tk-text); }
  .tv-body { flex: 1; overflow: auto; }
  .tv-status {
    padding: 2rem;
    text-align: center;
    color: var(--tk-muted);
    font-size: 0.875rem;
  }
  .tv-error { color: #e05d5d; }
  .tv-pre {
    margin: 0;
    padding: 1rem;
    font-family: var(--tk-mono);
    font-size: 0.8125rem;
    line-height: 1.6;
    white-space: pre-wrap;
    word-break: break-word;
    color: var(--tk-text);
  }
</style>
