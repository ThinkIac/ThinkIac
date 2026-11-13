<script>
  import { onMount, onDestroy } from 'svelte';
  import { getTheme, onThemeChange } from './lib/theme.js';
  import PreviewName from './PreviewName.svelte';

  export let path = '';
  let theme = 'dark';
  let unsubscribe;
  let loading = true;
  let error = '';
  let sheet = { name: '', rows: [] };
  let truncated = false;

  $: name = path.split('/').pop() || 'Spreadsheet';
  $: columnCount = Math.max(0, ...sheet.rows.map((row) => row.length));

  async function load() {
    loading = true;
    error = '';
    try {
      const response = await fetch(`/file-manager/spreadsheet?path=${encodeURIComponent(path)}`);
      const data = await response.json();
      if (!response.ok || !data.success) throw new Error(data.error || `HTTP ${response.status}`);
      sheet = data.sheets?.[0] || { name: '', rows: [] };
      truncated = Boolean(data.truncated);
    } catch (cause) {
      error = cause.message || "Couldn't open this spreadsheet";
    } finally {
      loading = false;
    }
  }

  function columnLabel(index) {
    let label = '';
    for (let value = index + 1; value > 0; value = Math.floor((value - 1) / 26)) {
      label = String.fromCharCode(65 + ((value - 1) % 26)) + label;
    }
    return label;
  }

  onMount(() => {
    theme = getTheme();
    unsubscribe = onThemeChange((next) => (theme = next));
    load();
  });
  onDestroy(() => unsubscribe?.());
</script>

<div class="sheet" data-theme={theme}>
  <header><PreviewName {path} {name} />{#if sheet.name}<span>{sheet.name}</span>{/if}</header>
  {#if loading}<div class="state">Loading spreadsheet...</div>
  {:else if error}<div class="state error">{error}</div>
  {:else if !sheet.rows.length}<div class="state">This spreadsheet is empty.</div>
  {:else}
    <div class="table-wrap">
      <table>
        <thead><tr><th class="corner"></th>{#each Array(columnCount) as _, index}<th>{columnLabel(index)}</th>{/each}</tr></thead>
        <tbody>{#each sheet.rows as row, rowIndex}<tr><th>{rowIndex + 1}</th>{#each Array(columnCount) as _, columnIndex}<td>{row[columnIndex] ?? ''}</td>{/each}</tr>{/each}</tbody>
      </table>
    </div>
    {#if truncated}<footer>Preview limited to the first 500 rows and 100 columns.</footer>{/if}
  {/if}
</div>

<style>
  :global(html), :global(body) { margin: 0; height: 100%; }
  .sheet[data-theme="dark"] { --tk-bg:#111111;--tk-surface:#181818;--tk-surface-2:#1f1f1f;--tk-border:rgba(255,255,255,.09);--tk-text:#f5f5f5;--tk-muted:#888888; }
  .sheet[data-theme="light"] { --tk-bg:#ffffff;--tk-surface:#f5f5f5;--tk-surface-2:#ececec;--tk-border:rgba(0,0,0,.10);--tk-text:#1a1a1a;--tk-muted:#666666; }
  .sheet { height:100dvh;display:flex;flex-direction:column;background:var(--tk-bg);color:var(--tk-text);font:13px 'Ubuntu',system-ui,sans-serif; }
  header, footer { flex:0 0 auto;padding:.65rem .9rem;background:var(--tk-surface);border-bottom:1px solid var(--tk-border);display:flex;gap:.75rem;align-items:center; }
  header span, footer { color:var(--tk-muted);font-size:12px; }
  header :global(.preview-name) { flex:1; }
  footer { border-top:1px solid var(--tk-border);border-bottom:0; }
  .table-wrap { flex:1;overflow:auto; }
  table { border-collapse:separate;border-spacing:0;min-width:100%;font-family:'Ubuntu Mono',monospace; }
  th, td { min-width:90px;max-width:360px;padding:6px 8px;border-right:1px solid var(--tk-border);border-bottom:1px solid var(--tk-border);white-space:pre-wrap;overflow-wrap:anywhere;vertical-align:top; }
  th { position:sticky;background:var(--tk-surface);color:var(--tk-muted);font-weight:500;z-index:1; }
  thead th { top:0;z-index:2;text-align:center; }
  tbody th, .corner { left:0;min-width:42px;width:42px;text-align:right;z-index:2; }
  .corner { z-index:3; }
  .state { margin:auto;padding:2rem;color:var(--tk-muted); }
  .error { color:#e05d5d; }
</style>
