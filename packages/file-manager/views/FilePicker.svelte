<script>
  import { createEventDispatcher, onMount } from 'svelte';
  import { list, rawUrl, uploadEntries } from './lib/api.js';

  export let accept = '';
  export let multiple = false;
  // Directory the picker opens in. Users start here but can browse freely —
  // up to the workspace root and back down into any folder. Read-only: no
  // creating, renaming or reorganizing here.
  export let root = 'uploads';

  const dispatch = createEventDispatcher();

  let path = root;
  let parent = null;   // path of the parent dir, or null at the workspace root
  let segments = [];   // folder names of the current path (from the API)
  let entries = [];
  let selected = [];
  let loading = true;
  let uploading = false;
  let error = '';
  let input;
  let view = 'grid'; // 'grid' (large, with previews) | 'list'

  const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico'];
  const AUDIO_EXTS = ['mp3', 'wav', 'ogg', 'm4a', 'flac'];
  const VIDEO_EXTS = ['mp4', 'webm', 'mov', 'mkv', 'ogv'];

  function extOf(name) {
    return name.includes('.') ? name.split('.').pop().toLowerCase() : '';
  }

  function mimeGroup(name) {
    const ext = extOf(name);
    if (IMAGE_EXTS.includes(ext)) return 'image/';
    if (AUDIO_EXTS.includes(ext)) return 'audio/';
    if (VIDEO_EXTS.includes(ext)) return 'video/';
    return '';
  }

  // Which broad category an entry falls into — drives the icon / thumbnail.
  function categoryFor(entry) {
    if (entry.type === 'directory') return 'folder';
    const ext = extOf(entry.name);
    if (IMAGE_EXTS.includes(ext)) return 'image';
    if (VIDEO_EXTS.includes(ext)) return 'video';
    if (AUDIO_EXTS.includes(ext)) return 'audio';
    if (ext === 'pdf') return 'pdf';
    if (['zip', 'rar', 'tar', 'gz', 'tgz', '7z'].includes(ext)) return 'archive';
    if (['csv', 'tsv', 'xlsx', 'xls'].includes(ext)) return 'sheet';
    if (['js', 'ts', 'jsx', 'tsx', 'py', 'json', 'html', 'css', 'sh', 'rs', 'go', 'java', 'c', 'cpp', 'h', 'xml', 'yaml', 'yml', 'toml'].includes(ext)) return 'code';
    return 'file';
  }

  function accepts(name) {
    if (!accept) return true;
    const patterns = accept.split(',').map((p) => p.trim().toLowerCase()).filter(Boolean);
    const ext = `.${extOf(name)}`;
    const lower = name.toLowerCase();
    return patterns.some((pattern) =>
      pattern === ext ||
      (pattern.startsWith('.') && lower.endsWith(pattern)) ||
      pattern === '*/*' ||
      (pattern.endsWith('/*') && mimeGroup(name) === pattern.slice(0, -1))
    );
  }

  // Folders always show (so the user can navigate); files honor `accept`.
  function visible(entry) {
    if (entry.type === 'directory') return !entry.name.startsWith('.');
    return accepts(entry.name);
  }

  async function refresh() {
    loading = true;
    error = '';
    try {
      const data = await list(path);
      if (data.success === false) throw new Error(data.error || 'Failed to open folder');
      // Trust the server's resolved location so navigation stays consistent.
      if (data.path !== undefined) path = data.path;
      parent = data.parent ?? null;
      segments = data.segments || [];
      const all = data.entries || [];
      entries = all.filter(visible).sort((a, b) => {
        if (a.type !== b.type) return a.type === 'directory' ? -1 : 1;
        return a.name.localeCompare(b.name);
      });
    } catch (e) {
      error = `Couldn't open this folder: ${e.message}`;
      entries = [];
    } finally {
      loading = false;
    }
  }

  function navigateInto(entry) {
    navigateTo(path === '.' || path === '' ? entry.name : `${path}/${entry.name}`);
  }

  function navigateTo(target) {
    if (target === path) return;
    path = target;
    selected = [];
    refresh();
  }

  function goBack() {
    if (parent !== null) navigateTo(parent);
  }

  // Full path of an entry in the current folder ('.' is the workspace root).
  function entryPath(entry) {
    return path === '.' || path === '' ? entry.name : `${path}/${entry.name}`;
  }

  function toggle(entry) {
    if (entry.type === 'directory') { navigateInto(entry); return; }
    const full = entryPath(entry);
    if (multiple) {
      selected = selected.includes(full) ? selected.filter((p) => p !== full) : [...selected, full];
    } else {
      selected = [full];
    }
  }

  function isSelected(entry) {
    return selected.includes(entryPath(entry));
  }

  async function upload(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    uploading = true;
    error = '';
    try {
      const data = await uploadEntries(path, files.map((file) => ({ file, relPath: file.name })));
      if (!data.success) throw new Error(data.error || 'Upload failed');
      await refresh();
      selected = (data.written || []).filter(accepts);
    } catch (e) {
      error = e.message;
    } finally {
      uploading = false;
    }
  }

  async function confirm() {
    if (!selected.length) return;
    try {
      const files = await Promise.all(selected.map(async (p) => {
        const response = await fetch(rawUrl(p));
        if (!response.ok) throw new Error(`Couldn't read ${p}`);
        const blob = await response.blob();
        return new File([blob], p.split('/').pop(), { type: blob.type });
      }));
      dispatch('select', { files, paths: selected });
    } catch (e) {
      error = e.message;
    }
  }

  // Move the whole picker to <body> so a transformed / positioned chat header
  // (which creates a stacking context) can never render on top of it.
  function portal(node) {
    document.body.appendChild(node);
    return { destroy() { node.remove(); } };
  }

  function onKeydown(event) {
    if (event.key === 'Escape') dispatch('cancel');
  }

  onMount(() => {
    window.addEventListener('keydown', onKeydown);
    refresh();
    return () => window.removeEventListener('keydown', onKeydown);
  });
</script>

<div class="fp" use:portal>
  <div class="fp-backdrop" on:click={() => dispatch('cancel')} role="presentation"></div>

  <section class="fp-modal" role="dialog" aria-modal="true" aria-label="Select files">
    <header class="fp-header">
      <h2>Select a file</h2>
      <button class="fp-icon" aria-label="Close" on:click={() => dispatch('cancel')}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
      </button>
    </header>

    <div class="fp-toolbar">
      <button class="fp-back" aria-label="Back" title="Back" on:click={goBack} disabled={parent === null}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M15 6l-6 6 6 6"/></svg>
      </button>
      <nav class="fp-crumbs" aria-label="Breadcrumb">
        <button class="fp-crumb" class:current={path === '.'} on:click={() => navigateTo('.')} disabled={path === '.'}>Workspace</button>
        {#each segments as seg, i}
          <span class="fp-crumb-sep">/</span>
          {@const segPath = segments.slice(0, i + 1).join('/')}
          <button class="fp-crumb" class:current={segPath === path} on:click={() => navigateTo(segPath)} disabled={segPath === path}>{seg}</button>
        {/each}
      </nav>
      <div class="fp-view-toggle" role="group" aria-label="View mode">
        <button class:active={view === 'grid'} aria-label="Large icons" title="Large icons" on:click={() => view = 'grid'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
        </button>
        <button class:active={view === 'list'} aria-label="List" title="List" on:click={() => view = 'list'}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>
        </button>
      </div>
    </div>

    <div class="fp-body" class:grid={view === 'grid'} aria-busy={loading}>
      {#if loading}
        <p class="fp-empty">Loading…</p>
      {:else if !entries.length}
        <div class="fp-empty">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 7h6l2 2h10v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>
          <p>{accept ? 'No matching files here.' : 'This folder is empty.'}</p>
        </div>
      {:else if view === 'grid'}
        <div class="fp-grid">
          {#each entries as entry}
            {@const cat = categoryFor(entry)}
            <button class="fp-tile" class:selected={isSelected(entry)} on:click={() => toggle(entry)} title={entry.name}>
              <div class="fp-thumb" data-cat={cat}>
                {#if cat === 'image'}
                  <img src={rawUrl(entryPath(entry))} alt="" loading="lazy" />
                {:else}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true">
                    {#if cat === 'folder'}
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    {:else if cat === 'video'}
                      <rect x="2" y="4" width="14" height="16" rx="2"/><path d="M18 9l4-2v10l-4-2z"/>
                    {:else if cat === 'audio'}
                      <path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
                    {:else if cat === 'pdf'}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v4h4"/>
                    {:else if cat === 'sheet'}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v4h4"/><path d="M8 13h8M8 17h8M12 11v8"/>
                    {:else if cat === 'code'}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v4h4"/><path d="M10 12l-2 2 2 2M14 12l2 2-2 2"/>
                    {:else if cat === 'archive'}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M12 4v3M12 9v2M12 13v2"/>
                    {:else}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v4h4"/>
                    {/if}
                  </svg>
                {/if}
                {#if isSelected(entry)}
                  <span class="fp-badge"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3"><path d="m5 12 4 4L19 6"/></svg></span>
                {/if}
              </div>
              <span class="fp-tile-name">{entry.name}</span>
            </button>
          {/each}
        </div>
      {:else}
        <div class="fp-rows">
          {#each entries as entry}
            {@const cat = categoryFor(entry)}
            <button class="fp-row" class:selected={isSelected(entry)} on:click={() => toggle(entry)}>
              <span class="fp-row-icon" data-cat={cat}>
                {#if cat === 'image'}
                  <img src={rawUrl(entryPath(entry))} alt="" loading="lazy" />
                {:else}
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true">
                    {#if cat === 'folder'}
                      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
                    {:else if cat === 'video'}
                      <rect x="2" y="4" width="14" height="16" rx="2"/><path d="M18 9l4-2v10l-4-2z"/>
                    {:else if cat === 'audio'}
                      <path d="M9 18V5l10-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="16" cy="16" r="3"/>
                    {:else}
                      <path d="M6 2h8l4 4v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v4h4"/>
                    {/if}
                  </svg>
                {/if}
              </span>
              <span class="fp-row-name">{entry.name}</span>
              {#if entry.type === 'directory'}
                <svg class="fp-row-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M9 6l6 6-6 6"/></svg>
              {:else}
                <span class="fp-row-meta">{entry.sizeFormatted || ''}</span>
                {#if isSelected(entry)}<svg class="fp-row-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="m5 12 4 4L19 6"/></svg>{/if}
              {/if}
            </button>
          {/each}
        </div>
      {/if}
    </div>

    {#if error}<p class="fp-error">{error}</p>{/if}

    <footer class="fp-footer">
      <button class="fp-upload" on:click={() => input?.click()} disabled={uploading}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 16V4M7 9l5-5 5 5M5 20h14"/></svg>
        {uploading ? 'Uploading…' : 'Upload'}
      </button>
      <input bind:this={input} type="file" {accept} {multiple} hidden data-logos-native-file-picker on:change={upload} />
      <div class="fp-footer-spacer"></div>
      <button class="fp-cancel" on:click={() => dispatch('cancel')}>Cancel</button>
      <button class="fp-confirm" disabled={!selected.length} on:click={confirm}>
        Select{multiple && selected.length ? ` (${selected.length})` : ''}
      </button>
    </footer>
  </section>
</div>

<style>
  .fp { position: fixed; inset: 0; z-index: 2147483000; font: inherit; }
  .fp-backdrop { position: absolute; inset: 0; background: rgba(0,0,0,.5); backdrop-filter: blur(2px); }

  .fp-modal {
    position: absolute;
    z-index: 1;
    left: 0; right: 0; bottom: 0;
    display: flex; flex-direction: column;
    max-height: 92dvh;
    height: 92dvh;
    background: var(--tk-surface, #181818);
    color: var(--tk-text, #f5f5f5);
    border-top: 1px solid var(--tk-border-hi, rgba(255,255,255,.16));
    border-radius: 18px 18px 0 0;
    box-shadow: 0 -8px 40px rgba(0,0,0,.4);
    overflow: hidden;
    animation: fp-rise .22s cubic-bezier(.2,.8,.2,1);
  }
  @keyframes fp-rise { from { transform: translateY(6%); opacity: .6; } to { transform: none; opacity: 1; } }

  button { font: inherit; cursor: pointer; color: inherit; }

  .fp-header { display: flex; align-items: center; justify-content: space-between; padding: .85rem 1rem; border-bottom: 1px solid var(--tk-border, rgba(255,255,255,.09)); }
  /* grab handle on mobile */
  .fp-header::before { content: ''; position: absolute; top: 7px; left: 50%; transform: translateX(-50%); width: 38px; height: 4px; border-radius: 3px; background: var(--tk-border-hi, rgba(255,255,255,.22)); }
  .fp-header h2 { margin: 0; font-size: 1rem; font-weight: 650; }
  .fp-icon { background: transparent; border: 0; padding: .3rem; display: grid; place-items: center; border-radius: 8px; }
  .fp-icon:hover { background: var(--tk-surface-2, #262626); }
  .fp-icon svg { width: 20px; height: 20px; }

  .fp-toolbar { display: flex; align-items: center; gap: .4rem; padding: .5rem 1rem; border-bottom: 1px solid var(--tk-border, rgba(255,255,255,.06)); }
  .fp-back { flex: none; display: grid; place-items: center; border: 0; background: var(--tk-surface-2, #1f1f1f); border-radius: 8px; padding: .35rem; color: inherit; }
  .fp-back svg { width: 18px; height: 18px; }
  .fp-back:not(:disabled):hover { background: var(--tk-surface, #333); }
  .fp-back:disabled { opacity: .35; cursor: default; }
  .fp-crumbs { flex: 1; min-width: 0; display: flex; align-items: center; gap: .15rem; overflow-x: auto; scrollbar-width: none; }
  .fp-crumbs::-webkit-scrollbar { display: none; }
  .fp-crumb { background: transparent; border: 0; padding: .2rem .35rem; border-radius: 6px; white-space: nowrap; color: var(--tk-muted, #9a9a9a); font-size: .85rem; }
  .fp-crumb:not(:disabled):hover { background: var(--tk-surface-2, #262626); color: inherit; }
  .fp-crumb.current { color: var(--tk-text, #f5f5f5); font-weight: 600; }
  .fp-crumb-sep { color: var(--tk-muted, #666); font-size: .8rem; }

  .fp-view-toggle { display: flex; flex: none; gap: 2px; background: var(--tk-surface-2, #1f1f1f); border-radius: 8px; padding: 2px; }
  .fp-view-toggle button { border: 0; background: transparent; padding: .3rem .4rem; border-radius: 6px; display: grid; place-items: center; color: var(--tk-muted, #9a9a9a); }
  .fp-view-toggle button svg { width: 17px; height: 17px; }
  .fp-view-toggle button.active { background: var(--tk-surface, #333); color: var(--tk-text, #f5f5f5); }

  .fp-body { flex: 1; overflow-y: auto; -webkit-overflow-scrolling: touch; padding: .75rem; }

  .fp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(96px, 1fr)); gap: .6rem; }
  .fp-tile { display: flex; flex-direction: column; align-items: center; gap: .4rem; padding: .55rem .35rem; border: 1px solid transparent; border-radius: 12px; background: transparent; }
  .fp-tile:hover { background: var(--tk-surface-2, #1f1f1f); }
  .fp-tile.selected { background: color-mix(in srgb, var(--tk-accent, #4A90D9) 18%, transparent); border-color: var(--tk-accent, #4A90D9); }
  .fp-thumb { position: relative; width: 100%; aspect-ratio: 1; border-radius: 10px; display: grid; place-items: center; background: var(--tk-surface-2, #202020); overflow: hidden; }
  .fp-thumb img { width: 100%; height: 100%; object-fit: cover; }
  .fp-thumb svg { width: 42%; height: 42%; opacity: .8; }
  .fp-thumb[data-cat='folder'] svg { color: #4A90D9; opacity: 1; }
  .fp-thumb[data-cat='pdf'] svg { color: #E05D5D; }
  .fp-thumb[data-cat='sheet'] svg { color: #3F9E6B; }
  .fp-thumb[data-cat='code'] svg { color: #C08CE0; }
  .fp-badge { position: absolute; top: 5px; right: 5px; width: 20px; height: 20px; border-radius: 50%; background: var(--tk-accent, #4A90D9); color: #fff; display: grid; place-items: center; }
  .fp-badge svg { width: 12px; height: 12px; opacity: 1; }
  .fp-tile-name { font-size: .74rem; line-height: 1.2; text-align: center; width: 100%; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; word-break: break-word; }

  .fp-rows { display: flex; flex-direction: column; }
  .fp-row { display: flex; align-items: center; gap: .7rem; width: 100%; padding: .6rem .55rem; border: 0; border-radius: 10px; background: transparent; text-align: left; }
  .fp-row:hover { background: var(--tk-surface-2, #1f1f1f); }
  .fp-row.selected { background: color-mix(in srgb, var(--tk-accent, #4A90D9) 16%, transparent); }
  .fp-row-icon { flex: none; width: 34px; height: 34px; border-radius: 8px; display: grid; place-items: center; background: var(--tk-surface-2, #202020); overflow: hidden; color: var(--tk-muted, #9a9a9a); }
  .fp-row-icon img { width: 100%; height: 100%; object-fit: cover; }
  .fp-row-icon svg { width: 19px; height: 19px; }
  .fp-row-icon[data-cat='folder'] svg { color: #4A90D9; }
  .fp-row-name { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: .9rem; }
  .fp-row-meta { flex: none; color: var(--tk-muted, #888); font-size: .78rem; }
  .fp-row-chevron { flex: none; width: 16px; height: 16px; color: var(--tk-muted, #666); }
  .fp-row-check { flex: none; width: 18px; height: 18px; color: var(--tk-accent, #4A90D9); }

  .fp-empty { min-height: 40dvh; display: grid; place-content: center; justify-items: center; gap: .6rem; color: var(--tk-muted, #888); text-align: center; }
  .fp-empty svg { width: 36px; height: 36px; }

  .fp-error { margin: 0; padding: .25rem 1rem; color: #E88; font-size: .82rem; }

  .fp-footer { display: flex; align-items: center; gap: .55rem; padding: .8rem 1rem; padding-bottom: max(.8rem, env(safe-area-inset-bottom)); border-top: 1px solid var(--tk-border, rgba(255,255,255,.09)); }
  .fp-footer-spacer { flex: 1; }
  .fp-upload { display: inline-flex; align-items: center; gap: .4rem; border: 1px solid var(--tk-border-hi, rgba(255,255,255,.16)); background: transparent; border-radius: 10px; padding: .55rem .8rem; font-size: .88rem; }
  .fp-upload:disabled { opacity: .5; cursor: default; }
  .fp-upload svg { width: 16px; height: 16px; }
  .fp-cancel { background: transparent; border: 0; padding: .55rem .7rem; border-radius: 10px; font-size: .9rem; }
  .fp-cancel:hover { background: var(--tk-surface-2, #262626); }
  .fp-confirm { border: 0; border-radius: 10px; padding: .55rem 1.1rem; background: var(--tk-accent, #4A90D9); color: var(--tk-on-accent, #fff); font-weight: 650; font-size: .9rem; }
  .fp-confirm:disabled { opacity: .4; cursor: not-allowed; }

  /* Desktop: centered dialog instead of bottom sheet */
  @media (min-width: 640px) {
    .fp-modal { left: 50%; right: auto; top: 50%; bottom: auto; transform: translate(-50%, -50%); width: min(680px, calc(100vw - 3rem)); height: auto; max-height: min(80dvh, 720px); border: 1px solid var(--tk-border-hi, rgba(255,255,255,.16)); border-radius: 16px; animation: fp-fade .18s ease; }
    @keyframes fp-fade { from { opacity: 0; transform: translate(-50%, -48%); } to { opacity: 1; transform: translate(-50%, -50%); } }
    .fp-header::before { display: none; }
    .fp-grid { grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); }
  }
</style>
