<script>
  import { onMount, onDestroy } from 'svelte';
  import { rawUrl, fetchRaw } from './lib/api.js';
  import { renderMarkdown } from './lib/markdown.js';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path;

  const MAX_BYTES = 2 * 1024 * 1024;
  let theme = 'dark';
  let unsubscribe;
  let html = '';
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
        return;
      }
      const length = Number(res.headers.get('content-length') || 0);
      if (length > MAX_BYTES) {
        tooLarge = true;
        return;
      }
      html = renderMarkdown(await res.text());
    } catch (cause) {
      error = cause.message || 'Could not load this Markdown file.';
    } finally {
      loading = false;
    }
  }

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((next) => (theme = next));
    load();
  });
  onDestroy(() => unsubscribe?.());
</script>

<div class="mv-container" data-theme={theme}>
  <header class="mv-header">
    <PreviewName {path} {name} />
    <a class="mv-raw-link" href={rawUrl(path)} download={name}>Download</a>
  </header>
  <main class="mv-body">
    {#if loading}
      <div class="mv-status" aria-live="polite">Rendering Markdown…</div>
    {:else if error}
      <div class="mv-status mv-error">{error}</div>
    {:else if tooLarge}
      <div class="mv-status">
        This Markdown file is too large to preview.
        <a href={rawUrl(path)} download={name}>Download file</a>
      </div>
    {:else}
      <article class="markdown-body">{@html html}</article>
    {/if}
  </main>
</div>

<style>
  :global(html), :global(body) { height:100%; margin:0; padding:0; }
  .mv-container[data-theme="dark"] { --bg:#111; --surface:#181818; --border:rgba(255,255,255,.1); --text:#f5f5f5; --muted:#929292; --code:#202020; --link:#9bc4ff; --quote:#999; --font:'Ubuntu',system-ui,sans-serif; --mono:'Ubuntu Mono',ui-monospace,monospace; }
  .mv-container[data-theme="light"] { --bg:#fff; --surface:#f5f5f5; --border:rgba(0,0,0,.12); --text:#1a1a1a; --muted:#666; --code:#f1f1f1; --link:#075bc5; --quote:#686868; --font:'Ubuntu',system-ui,sans-serif; --mono:'Ubuntu Mono',ui-monospace,monospace; }
  .mv-container { display:flex; flex-direction:column; height:100dvh; background:var(--bg); color:var(--text); font-family:var(--font); }
  .mv-header { display:flex; align-items:center; gap:.75rem; padding:.6rem .9rem; border-bottom:1px solid var(--border); background:var(--surface); flex-shrink:0; }
  .mv-header :global(.preview-name) { flex:1; }
  .mv-raw-link { color:var(--muted); font-size:.75rem; text-decoration:none; flex-shrink:0; }
  .mv-raw-link:hover { color:var(--text); }
  .mv-body { flex:1; overflow:auto; }
  .mv-status { padding:2rem; color:var(--muted); font-size:.875rem; text-align:center; }
  .mv-error { color:#e05d5d; }
  .markdown-body { box-sizing:border-box; max-width:920px; margin:0 auto; padding:2rem clamp(1rem, 5vw, 3.5rem) 4rem; font-size:.98rem; line-height:1.7; overflow-wrap:anywhere; }
  .markdown-body :global(h1), .markdown-body :global(h2), .markdown-body :global(h3), .markdown-body :global(h4) { line-height:1.25; margin:1.8em 0 .65em; }
  .markdown-body :global(h1) { margin-top:0; padding-bottom:.45em; font-size:2em; border-bottom:1px solid var(--border); }
  .markdown-body :global(h2) { padding-bottom:.35em; font-size:1.5em; border-bottom:1px solid var(--border); }
  .markdown-body :global(h3) { font-size:1.22em; }
  .markdown-body :global(p), .markdown-body :global(ul), .markdown-body :global(ol) { margin:.9em 0; }
  .markdown-body :global(li + li) { margin-top:.25em; }
  .markdown-body :global(a) { color:var(--link); text-decoration:underline; text-underline-offset:2px; }
  .markdown-body :global(blockquote) { margin:1em 0; padding:.15em 1em; border-left:3px solid var(--border); color:var(--quote); }
  .markdown-body :global(code) { padding:.15em .35em; border-radius:4px; background:var(--code); font-family:var(--mono); font-size:.88em; }
  .markdown-body :global(pre) { overflow:auto; margin:1em 0; padding:1rem; border:1px solid var(--border); border-radius:8px; background:var(--code); }
  .markdown-body :global(pre code) { padding:0; background:transparent; font-size:.82rem; }
  .markdown-body :global(table) { display:block; width:max-content; max-width:100%; overflow:auto; margin:1em 0; border-collapse:collapse; }
  .markdown-body :global(th), .markdown-body :global(td) { padding:.55em .75em; border:1px solid var(--border); text-align:left; }
  .markdown-body :global(th) { background:var(--surface); }
  .markdown-body :global(img) { display:block; max-width:100%; height:auto; margin:1em 0; border-radius:6px; }
  .markdown-body :global(hr) { height:1px; margin:2em 0; border:0; background:var(--border); }
</style>
