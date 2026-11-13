<script>
  import { onMount } from 'svelte';
  import * as api from './lib/api.js';
  import { rawUrl } from './lib/api.js';
  import { openFilePreview } from './lib/protocol.js';
  import { getTheme, onThemeChange } from './lib/theme.js';

  // Deep-link params (carried on the view URL, e.g. from another app's "Open"
  // action): `path` = folder to open at, `select` = file name to pre-select
  // inside it. Both optional; default is the workspace root.
  export let path = '';
  export let select = '';

  let currentPath = '.';
  let entries = [];
  let absolutePath = '';
  let segments = [];
  let parent = null;
  let selectedPaths = new Set(); // full item paths currently selected
  let anchorIndex = null; // index in filteredEntries for shift-range selection
  let loading = false;
  let error = null;
  let notice = null;

  // Upload / drag-and-drop
  let uploading = false;
  let dragActive = false;
  let fileInputEl;
  let folderInputEl;

  // Context menu
  let contextMenu = { open: false, x: 0, y: 0, entry: null };

  // Marquee (drag) selection
  let marquee = null; // { startX, startY, x, y }
  let marqueeBase = new Set();
  let listContainerEl;

  // Theme
  let theme = 'dark';
  let unsubscribeTheme;

  // Clipboard
  let clipboard = { empty: true, type: null, path: null };

  // Viewers
  let viewers = [];

  // Display prefs (persisted)
  let viewMode = 'list'; // 'list' | 'grid'
  let hideDotfiles = true;
  let showDeleted = false;
  let optionsOpen = false;

  // Mobile
  let compact = false;

  // UI state
  let showNewFile = false;
  let showNewFolder = false;
  let newItemName = '';
  let renamingItem = null;
  let renameValue = '';
  let permDeleteConfirm = null; // entry pending a "delete forever" confirmation
  let showMoveInput = false;
  let moveDest = '';

  // Viewer modal
  let viewerModal = { open: false, url: null, name: null, error: null };

  // App openers ("Open with…") resolved lazily when the context menu opens.
  let contextOpeners = [];

  const CATEGORY_EXT = {
    image: ['.png', '.jpg', '.jpeg', '.jpe', '.jfif', '.gif', '.apng', '.webp', '.svg', '.bmp', '.ico', '.avif'],
    video: ['.mp4', '.webm', '.mov', '.mkv', '.ogv'],
    audio: ['.mp3', '.wav', '.ogg', '.m4a', '.flac'],
    pdf: ['.pdf'],
  };

  function categoryFor(entry) {
    if (entry.type === 'directory') return 'folder';
    const ext = entry.ext;
    if (!ext) return 'file';
    for (const [cat, exts] of Object.entries(CATEGORY_EXT)) {
      if (exts.includes(ext)) return cat;
    }
    return 'file';
  }

  // Soft-deleted items are renamed with a `.deleted` (or `.deleted2`, `.deleted3`, ...) suffix
  // by the backend (see filemanage_delete) — detected purely by name so list() stays unchanged.
  const DELETED_SUFFIX_RE = /\.deleted\d*$/;

  function isDeletedEntry(entry) {
    return DELETED_SUFFIX_RE.test(entry.name);
  }

  function originalName(name) {
    return name.replace(DELETED_SUFFIX_RE, '');
  }

  $: filteredEntries = entries.filter((e) => {
    if (hideDotfiles && e.name.startsWith('.')) return false;
    if (isDeletedEntry(e) && !showDeleted) return false;
    return true;
  });

  // `selectedEntries` drives bulk actions (copy/cut/delete); `selected` keeps the
  // old single-item shape used by rename/move, which only make sense for one item.
  $: selectedEntries = filteredEntries.filter((e) => selectedPaths.has(itemPath(e.name)));
  $: selected = selectedEntries.length === 1
    ? { name: selectedEntries[0].name, type: selectedEntries[0].type, path: itemPath(selectedEntries[0].name) }
    : null;

  function isArchive(entry) {
    return entry.type === 'file' && /\.(zip|rar|tar|gz|tgz)$/i.test(entry.name);
  }

  async function fetchList(path) {
    loading = true;
    error = null;
    try {
      const data = await api.list(path);
      if (data.success) {
        entries = data.entries;
        absolutePath = data.absolutePath;
        segments = data.segments || [];
        parent = data.parent;
        currentPath = data.path;
        selectedPaths = new Set();
        anchorIndex = null;
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
    loading = false;
  }

  async function fetchClipboard() {
    try {
      const data = await api.clipboardStatus();
      if (data.success) {
        clipboard = { empty: data.empty, type: data.type, path: data.path, count: data.count || 0 };
      }
    } catch (e) {}
  }

  async function fetchViewers() {
    try {
      const data = await api.listViewers();
      if (data.success) viewers = data.viewers;
    } catch (e) {}
  }

  function itemPath(name) {
    return currentPath === '.' ? name : `${currentPath}/${name}`;
  }

  function itemAbsPath(name) {
    return `${absolutePath}/${name}`;
  }

  function selectOnly(entry, index) {
    selectedPaths = new Set([itemPath(entry.name)]);
    anchorIndex = index;
    showMoveInput = false;
  }

  function toggleSelect(entry, index) {
    const key = itemPath(entry.name);
    const next = new Set(selectedPaths);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    selectedPaths = next;
    anchorIndex = index;
    showMoveInput = false;
  }

  function rangeSelect(index) {
    if (anchorIndex === null) {
      selectOnly(filteredEntries[index], index);
      return;
    }
    const start = Math.min(anchorIndex, index);
    const end = Math.max(anchorIndex, index);
    const next = new Set(selectedPaths);
    for (let i = start; i <= end; i++) {
      const e = filteredEntries[i];
      if (e && !isDeletedEntry(e)) next.add(itemPath(e.name));
    }
    selectedPaths = next;
    showMoveInput = false;
  }

  // Alt+click (spec) as well as Ctrl/Cmd+click (common convention) toggle a single
  // item in/out of the selection; Shift+click extends a contiguous range.
  function handleEntryClick(event, entry, index) {
    if (isDeletedEntry(entry)) return;
    if (event.shiftKey) {
      rangeSelect(index);
    } else if (event.altKey || event.ctrlKey || event.metaKey) {
      toggleSelect(entry, index);
    } else {
      selectOnly(entry, index);
    }
  }

  function navigateTo(path) {
    fetchList(path);
  }

  function navigateInto(entry) {
    if (entry.type === 'directory') {
      fetchList(itemPath(entry.name));
    }
  }

  async function openFile(entry) {
    const filePath = itemPath(entry.name);
    if (openFilePreview({ path: filePath, name: entry.name }, window.parent)) return;
    try {
      const data = await api.resolveViewer(filePath);
      if (!data.success) {
        viewerModal = { open: true, url: null, name: null, error: data.error || 'No viewer available' };
        return;
      }
      if (data.kind === 'component') {
        // New native registry: url is server-built, ?path= is workspace-relative already.
        viewerModal = { open: true, url: data.url, name: data.component, error: null };
      } else {
        // Legacy external iframe viewer: ?path= is the absolute filesystem path,
        // as it always has been for these externally-registered integrations.
        const fileAbsPath = itemAbsPath(entry.name);
        const sep = data.viewer.iframeUrl.includes('?') ? '&' : '?';
        viewerModal = {
          open: true,
          url: `${data.viewer.iframeUrl}${sep}path=${encodeURIComponent(fileAbsPath)}`,
          name: data.viewer.name,
          error: null,
        };
      }
    } catch (e) {
      viewerModal = { open: true, url: null, name: null, error: e.message };
    }
  }

  function closeViewer() {
    viewerModal = { open: false, url: null, name: null, error: null };
  }

  // ── App openers: open a file as a full Aurora tab (not the preview modal) ──
  // File Manager runs inside an <iframe>, so it talks to the Aurora host via the
  // postMessage bridge (installPostMessageBridge in aurora/views/lib/bus.js),
  // which re-emits { source:'aurora', type, detail } onto the host's local bus.
  function openInApp(opener, filePath) {
    window.parent?.postMessage({
      source: 'aurora',
      type: 'open:with',
      detail: { pkg: opener.pkg, url: opener.url, title: opener.label, path: filePath },
    }, '*');
  }

  async function loadOpeners(entry) {
    contextOpeners = [];
    if (!entry || entry.type === 'directory') return;
    try {
      const data = await api.resolveOpeners(itemPath(entry.name));
      if (data?.success && Array.isArray(data.openers)) contextOpeners = data.openers;
    } catch { /* no openers → the menu item just stays hidden */ }
  }

  // Promote the current preview modal to a full App tab (the modal URL already
  // targets a package view carrying ?path=, so it opens cleanly as a tab).
  function promoteViewerToTab() {
    if (!viewerModal.url) return;
    window.parent?.postMessage({
      source: 'aurora',
      type: 'open:with',
      detail: { url: viewerModal.url, title: viewerModal.name },
    }, '*');
    closeViewer();
  }

  async function handleCreate(type) {
    if (!newItemName.trim()) return;
    const path = itemPath(newItemName.trim());
    try {
      const data = await api.create(path, type);
      if (data.success) {
        showNewFile = false;
        showNewFolder = false;
        newItemName = '';
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  function startRename(entry) {
    renamingItem = entry;
    renameValue = entry.name;
  }

  async function confirmRename() {
    if (!renameValue.trim() || !renamingItem) return;
    const path = itemPath(renamingItem.name);
    try {
      const data = await api.rename(path, renameValue.trim());
      if (data.success) {
        renamingItem = null;
        renameValue = '';
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  function cancelRename() {
    renamingItem = null;
    renameValue = '';
  }

  async function handleDeleteSelected() {
    // Soft-delete: reversible (see Restore in the "show deleted" view), so no
    // extra confirmation step is needed here — unlike permanent delete below.
    if (selectedEntries.length === 0) return;
    for (const entry of selectedEntries) {
      try {
        const data = await api.del(itemPath(entry.name));
        if (!data.success) error = data.error;
      } catch (e) {
        error = e.message;
      }
    }
    selectedPaths = new Set();
    fetchList(currentPath);
  }

  async function handleRestore(entry) {
    try {
      const data = await api.restore(itemPath(entry.name));
      if (data.success) {
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function confirmPermanentDelete() {
    if (!permDeleteConfirm) return;
    try {
      const data = await api.permanentDelete(itemPath(permDeleteConfirm.name));
      if (data.success) {
        permDeleteConfirm = null;
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function handleCopySelected() {
    if (selectedEntries.length === 0) return;
    try {
      const data = await api.copy(selectedEntries.map((e) => itemPath(e.name)));
      if (!data.success) throw new Error(data.error || 'Could not copy the selected items');
      notice = `${selectedEntries.length} item${selectedEntries.length === 1 ? '' : 's'} copied. Choose a folder, then paste.`;
      await fetchClipboard();
    } catch (e) { error = e.message; }
  }

  async function handleCutSelected() {
    if (selectedEntries.length === 0) return;
    try {
      const data = await api.cut(selectedEntries.map((e) => itemPath(e.name)));
      if (!data.success) throw new Error(data.error || 'Could not cut the selected items');
      notice = `${selectedEntries.length} item${selectedEntries.length === 1 ? '' : 's'} cut. Choose a folder, then paste.`;
      await fetchClipboard();
    } catch (e) { error = e.message; }
  }

  async function handleExtract(entry) {
    try {
      const data = await api.extract(itemPath(entry.name));
      if (data.success) {
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function handlePaste(destination = currentPath) {
    try {
      const data = await api.paste(destination);
      if (data.success) {
        const itemCount = data.to?.length || 0;
        notice = `${itemCount} item${itemCount === 1 ? '' : 's'} ${data.action === 'cut' ? 'moved' : 'copied'} to ${destination === '.' ? 'Workspace' : destination}.`;
        await fetchList(currentPath);
        await fetchClipboard();
      } else {
        error = data.errors?.[0]?.error || data.error || 'Could not paste the clipboard contents';
      }
    } catch (e) {
      error = e.message;
    }
  }

  async function handleMove() {
    if (!selected || !moveDest.trim()) return;
    try {
      const data = await api.move(selected.path, moveDest.trim());
      if (data.success) {
        showMoveInput = false;
        moveDest = '';
        selectedPaths = new Set();
        fetchList(currentPath);
      } else {
        error = data.error;
      }
    } catch (e) {
      error = e.message;
    }
  }

  function handleKeydown(event, entry) {
    if (event.key === 'Enter') {
      if (entry.type === 'directory') {
        navigateInto(entry);
      } else {
        openFile(entry);
      }
    }
  }

  function isEditableTarget(target) {
    return target instanceof HTMLElement && (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));
  }

  function handleGlobalKeydown(event) {
    if (isEditableTarget(event.target)) return;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === 'c' && selectedEntries.length) {
      event.preventDefault(); handleCopySelected(); return;
    }
    if (modifier && event.key.toLowerCase() === 'x' && selectedEntries.length) {
      event.preventDefault(); handleCutSelected(); return;
    }
    if (modifier && event.key.toLowerCase() === 'v' && !clipboard.empty) {
      event.preventDefault(); handlePaste(); return;
    }
    if (event.key === 'Delete' && selectedEntries.length) {
      event.preventDefault(); handleDeleteSelected(); return;
    }
    if (event.key === 'F2' && selected) {
      event.preventDefault(); startRename(selectedEntries[0]); return;
    }
    if (event.key === 'Escape') closeContextMenu();
  }

  // ── Context menu ──────────────────────────────────────────────────────
  function openContextMenu(event, entry) {
    event.preventDefault();
    if (isDeletedEntry(entry)) return;
    const key = itemPath(entry.name);
    if (!selectedPaths.has(key)) {
      selectOnly(entry, filteredEntries.indexOf(entry));
    }
    contextMenu = { open: true, x: event.clientX, y: event.clientY, entry };
    loadOpeners(entry); // async — populates contextOpeners; menu opens immediately
  }

  function closeContextMenu() {
    contextMenu = { open: false, x: 0, y: 0, entry: null };
    contextOpeners = [];
  }

  // ── Marquee (rubber-band) drag selection ────────────────────────────────
  function handleContainerMouseDown(event) {
    if (event.button !== 0) return; // left click only
    if (event.target.closest('.fm-row, .fm-tile')) return; // let item handlers own clicks on entries
    closeContextMenu();
    const additive = event.shiftKey || event.altKey || event.ctrlKey || event.metaKey;
    marqueeBase = additive ? new Set(selectedPaths) : new Set();
    if (!additive) selectedPaths = new Set();
    marquee = { startX: event.clientX, startY: event.clientY, x: event.clientX, y: event.clientY };
    window.addEventListener('mousemove', handleMarqueeMove);
    window.addEventListener('mouseup', handleMarqueeUp);
  }

  function handleMarqueeMove(event) {
    if (!marquee) return;
    marquee = { ...marquee, x: event.clientX, y: event.clientY };
    updateMarqueeSelection();
  }

  function updateMarqueeSelection() {
    if (!marquee || !listContainerEl) return;
    const x1 = Math.min(marquee.startX, marquee.x);
    const x2 = Math.max(marquee.startX, marquee.x);
    const y1 = Math.min(marquee.startY, marquee.y);
    const y2 = Math.max(marquee.startY, marquee.y);
    const nodes = listContainerEl.querySelectorAll('[data-fm-item]');
    const next = new Set(marqueeBase);
    nodes.forEach((node) => {
      const r = node.getBoundingClientRect();
      if (r.left < x2 && r.right > x1 && r.top < y2 && r.bottom > y1) {
        next.add(node.getAttribute('data-fm-item'));
      }
    });
    selectedPaths = next;
  }

  function handleMarqueeUp() {
    marquee = null;
    window.removeEventListener('mousemove', handleMarqueeMove);
    window.removeEventListener('mouseup', handleMarqueeUp);
  }

  $: marqueeStyle = marquee
    ? `left:${Math.min(marquee.startX, marquee.x)}px; top:${Math.min(marquee.startY, marquee.y)}px; width:${Math.abs(marquee.x - marquee.startX)}px; height:${Math.abs(marquee.y - marquee.startY)}px;`
    : '';

  // ── Upload / drag-and-drop ───────────────────────────────────────────────
  async function uploadEntries(uploadList) {
    if (!uploadList.length) return;
    uploading = true;
    error = null;
    try {
      const data = await api.uploadEntries(currentPath, uploadList);
      if (!data.success) {
        error = data.errors?.length ? `Couldn't upload ${data.errors.length} item${data.errors.length === 1 ? '' : 's'}: ${data.errors[0].error}` : (data.error || 'Upload failed');
      }
      fetchList(currentPath);
    } catch (e) {
      error = e.message;
    }
    uploading = false;
  }

  async function handleFileInputChange(event) {
    const files = Array.from(event.target.files || []);
    event.target.value = '';
    if (!files.length) return;
    await uploadEntries(files.map((file) => ({ file, relPath: file.webkitRelativePath || file.name })));
  }

  function readEntryFile(entry) {
    return new Promise((resolve, reject) => entry.file(resolve, reject));
  }

  function readEntryDirectory(entry) {
    const reader = entry.createReader();
    return new Promise((resolve, reject) => {
      const all = [];
      function readBatch() {
        reader.readEntries((batch) => {
          if (!batch.length) { resolve(all); return; }
          all.push(...batch);
          readBatch();
        }, reject);
      }
      readBatch();
    });
  }

  async function collectEntries(entry, pathPrefix, out) {
    if (entry.isFile) {
      const file = await readEntryFile(entry);
      out.push({ file, relPath: pathPrefix + entry.name });
    } else if (entry.isDirectory) {
      const children = await readEntryDirectory(entry);
      for (const child of children) {
        await collectEntries(child, `${pathPrefix}${entry.name}/`, out);
      }
    }
  }

  async function handleDrop(event) {
    event.preventDefault();
    dragActive = false;
    const dt = event.dataTransfer;
    if (!dt) return;
    const out = [];
    if (dt.items && dt.items.length && dt.items[0].webkitGetAsEntry) {
      const fsEntries = Array.from(dt.items).map((item) => item.webkitGetAsEntry()).filter(Boolean);
      for (const fsEntry of fsEntries) {
        await collectEntries(fsEntry, '', out);
      }
    } else if (dt.files && dt.files.length) {
      for (const file of Array.from(dt.files)) out.push({ file, relPath: file.name });
    }
    await uploadEntries(out);
  }

  function handleDragOver(event) {
    event.preventDefault();
    dragActive = true;
  }

  function handleDragLeave(event) {
    if (event.currentTarget.contains(event.relatedTarget)) return;
    dragActive = false;
  }

  function formatDate(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
  }

  // Svelte action: autofocus + select text
  function autofocus(node) {
    node.focus();
    node.select();
  }

  // Prevents toolbar buttons from stealing focus from an active inline input
  // (rename / new-item name) when tapped, mirroring terminal's keepFocus pattern.
  function keepFocus(event) {
    event.preventDefault();
  }

  function setViewMode(mode) {
    viewMode = mode;
    try { window.localStorage.setItem('file-manager:viewMode', mode); } catch (e) {}
  }

  function toggleHideDotfiles() {
    hideDotfiles = !hideDotfiles;
    try { window.localStorage.setItem('file-manager:hideDotfiles', hideDotfiles ? '1' : '0'); } catch (e) {}
  }

  function toggleShowDeleted() {
    showDeleted = !showDeleted;
    if (!showDeleted) permDeleteConfirm = null;
    try { window.localStorage.setItem('file-manager:showDeleted', showDeleted ? '1' : '0'); } catch (e) {}
  }

  function refreshCompact() {
    if (typeof window === 'undefined') return;
    compact = window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 820;
  }

  onMount(() => {
    theme = getTheme();
    unsubscribeTheme = onThemeChange((t) => (theme = t));

    try {
      const savedMode = window.localStorage.getItem('file-manager:viewMode');
      if (savedMode === 'grid' || savedMode === 'list') viewMode = savedMode;
      const savedHide = window.localStorage.getItem('file-manager:hideDotfiles');
      if (savedHide !== null) hideDotfiles = savedHide === '1';
      const savedShowDeleted = window.localStorage.getItem('file-manager:showDeleted');
      if (savedShowDeleted !== null) showDeleted = savedShowDeleted === '1';
    } catch (e) {}

    refreshCompact();
    window.addEventListener('resize', refreshCompact);

    window.addEventListener('keydown', handleGlobalKeydown);
    window.addEventListener('scroll', closeContextMenu, true);

    // Honor a deep-link: open at the requested folder and pre-select the file.
    fetchList(path || '.').then(() => {
      if (select) selectedPaths = new Set([itemPath(select)]);
    });
    fetchClipboard();
    fetchViewers();

    return () => {
      unsubscribeTheme?.();
      window.removeEventListener('resize', refreshCompact);
      window.removeEventListener('keydown', handleGlobalKeydown);
      window.removeEventListener('scroll', closeContextMenu, true);
      window.removeEventListener('mousemove', handleMarqueeMove);
      window.removeEventListener('mouseup', handleMarqueeUp);
    };
  });
</script>

<div class="fm-container" data-theme={theme}>
  <!-- Breadcrumbs -->
  <nav class="fm-breadcrumbs">
    <button class="fm-crumb" on:click={() => navigateTo('.')}>Workspace</button>
    {#each segments as seg, i}
      <span class="fm-crumb-sep">/</span>
      <button class="fm-crumb" on:click={() => navigateTo(segments.slice(0, i + 1).join('/'))}>{seg}</button>
    {/each}
  </nav>

  <!-- Toolbar -->
  <div class="fm-toolbar">
    <input type="file" multiple style="display:none" bind:this={fileInputEl} on:change={handleFileInputChange} />
    <input type="file" multiple webkitdirectory style="display:none" bind:this={folderInputEl} on:change={handleFileInputChange} />
    <div class="fm-toolbar-group">
      <button class="fm-btn" on:mousedown={keepFocus} on:click={() => fileInputEl.click()}>{compact ? '+Files' : 'Upload'}</button>
      {#if !compact}
        <button class="fm-btn" on:mousedown={keepFocus} on:click={() => folderInputEl.click()}>Upload Folder</button>
      {/if}
      <button class="fm-btn" on:mousedown={keepFocus} on:click={() => { showNewFile = !showNewFile; showNewFolder = false; newItemName = ''; }}>{compact ? '+File' : 'New File'}</button>
      <button class="fm-btn" on:mousedown={keepFocus} on:click={() => { showNewFolder = !showNewFolder; showNewFile = false; newItemName = ''; }}>{compact ? '+Folder' : 'New Folder'}</button>
      <button class="fm-btn" on:mousedown={keepFocus} disabled={!selected} on:click={() => selected && startRename(selected)}>Rename</button>
      <button class="fm-btn fm-btn-danger" on:mousedown={keepFocus} disabled={selectedEntries.length === 0} on:click={handleDeleteSelected}>Delete</button>
    </div>
    <div class="fm-toolbar-group">
      <button class="fm-btn" on:mousedown={keepFocus} disabled={selectedEntries.length === 0} on:click={handleCopySelected}>Copy</button>
      <button class="fm-btn" on:mousedown={keepFocus} disabled={selectedEntries.length === 0} on:click={handleCutSelected}>Cut</button>
      <button class="fm-btn" on:mousedown={keepFocus} disabled={clipboard.empty} on:click={handlePaste}>Paste</button>
      <button class="fm-btn" on:mousedown={keepFocus} disabled={!selected} on:click={() => { showMoveInput = !showMoveInput; moveDest = ''; }}>Move</button>
      {#if selected && isArchive(selected)}
        <button class="fm-btn" on:mousedown={keepFocus} on:click={() => handleExtract(selected)}>Extract</button>
      {/if}
    </div>
    <div class="fm-toolbar-group fm-toolbar-group-view">
      <button
        class="fm-icon-btn"
        class:fm-icon-btn-active={viewMode === 'list'}
        title="List view"
        on:mousedown={keepFocus}
        on:click={() => setViewMode('list')}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M2 8h12M2 12h12"/></svg>
      </button>
      <button
        class="fm-icon-btn"
        class:fm-icon-btn-active={viewMode === 'grid'}
        title="Grid view"
        on:mousedown={keepFocus}
        on:click={() => setViewMode('grid')}
      >
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/></svg>
      </button>
      <button class="fm-icon-btn" title="Settings" on:mousedown={keepFocus} on:click={() => optionsOpen = true}>
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="8" cy="8" r="2"/><path d="M8 1v2M8 13v2M1 8h2M13 8h2M3.1 3.1l1.4 1.4M11.5 11.5l1.4 1.4M3.1 12.9l1.4-1.4M11.5 4.5l1.4-1.4"/></svg>
      </button>
    </div>
    <!-- Clipboard indicator -->
    {#if !clipboard.empty}
      <div class="fm-clipboard-badge">
        <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5">
          <rect x="4" y="2" width="8" height="12" rx="1" />
          <path d="M6 2V1h4v1" />
        </svg>
        <span class="fm-clipboard-type">{clipboard.type === 'cut' ? 'Ready to move' : 'Ready to copy'}</span>
        <span class="fm-clipboard-path">{clipboard.count > 1 ? `${clipboard.count} items` : clipboard.path}</span>
        <button class="fm-btn fm-btn-sm" title={`Paste into ${currentPath === '.' ? 'Workspace' : currentPath}`} on:mousedown={keepFocus} on:click={() => handlePaste()}>Paste here</button>
      </div>
    {/if}
    {#if uploading}
      <div class="fm-uploading-badge">Uploading...</div>
    {/if}
  </div>

  <!-- Move input -->
  {#if showMoveInput && selected}
    <div class="fm-inline-input">
      <label for="move-dest">Move "{selected.name}" to:</label>
      <div class="fm-inline-input-row">
        <input id="move-dest" type="text" bind:value={moveDest} placeholder="destination/path" on:keydown={(e) => e.key === 'Enter' && handleMove()} />
        <button class="fm-btn fm-btn-primary" on:click={handleMove}>Move</button>
        <button class="fm-btn" on:click={() => { showMoveInput = false; moveDest = ''; }}>Cancel</button>
      </div>
    </div>
  {/if}

  <!-- Error -->
  {#if error}
    <div class="fm-error" on:click={() => error = null}>{error}</div>
  {/if}
  {#if notice}
    <div class="fm-notice" on:click={() => notice = null}>{notice}</div>
  {/if}

  <!-- New item input -->
  {#if showNewFile || showNewFolder}
    <div class="fm-new-item">
      <div class="fm-new-item-icon">
        {#if showNewFolder}
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4V12a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H7L5 3H3a1 1 0 00-1 1z"/></svg>
        {:else}
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>
        {/if}
      </div>
      <input
        type="text"
        bind:value={newItemName}
        placeholder={showNewFolder ? 'folder name' : 'file name'}
        use:autofocus
        on:keydown={(e) => {
          if (e.key === 'Enter') handleCreate(showNewFolder ? 'directory' : 'file');
          if (e.key === 'Escape') { showNewFile = false; showNewFolder = false; newItemName = ''; }
        }}
      />
      <button class="fm-btn fm-btn-primary" on:mousedown={keepFocus} on:click={() => handleCreate(showNewFolder ? 'directory' : 'file')}>Create</button>
      <button class="fm-btn" on:mousedown={keepFocus} on:click={() => { showNewFile = false; showNewFolder = false; newItemName = ''; }}>Cancel</button>
    </div>
  {/if}

  <!-- File list / grid -->
  <div
    class="fm-list-container"
    class:fm-dropzone-active={dragActive}
    bind:this={listContainerEl}
    on:mousedown={handleContainerMouseDown}
    on:dragover={handleDragOver}
    on:dragleave={handleDragLeave}
    on:drop={handleDrop}
  >
    {#if dragActive}
      <div class="fm-dropzone-overlay">Drop to upload</div>
    {/if}
    {#if marquee}
      <div class="fm-marquee" style={marqueeStyle}></div>
    {/if}
    {#if loading}
      <div class="fm-loading">Loading...</div>
    {:else if filteredEntries.length === 0}
      <div class="fm-empty">This folder is empty</div>
    {:else if viewMode === 'grid'}
      <div class="fm-grid" role="grid">
        {#if parent !== null}
          <div class="fm-tile fm-tile-parent" role="gridcell" tabindex="0" on:click={() => navigateTo(parent)} on:keydown={(e) => e.key === 'Enter' && navigateTo(parent)}>
            <div class="fm-tile-icon">
              <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4L6 8l4 4"/></svg>
            </div>
            <div class="fm-tile-name">..</div>
          </div>
        {/if}
        {#each filteredEntries as entry, i}
          {#if isDeletedEntry(entry)}
            <div class="fm-tile fm-tile-deleted" style="animation-delay: {i * 15}ms">
              <div class="fm-tile-icon">
                <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M2 4h12M6 4V2h4v2M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/></svg>
              </div>
              <div class="fm-tile-name" title={originalName(entry.name)}>{originalName(entry.name)}</div>
              <div class="fm-tile-deleted-actions">
                {#if permDeleteConfirm && permDeleteConfirm.name === entry.name}
                  <button class="fm-icon-btn fm-icon-btn-sm fm-icon-btn-danger" title="Confirm permanent deletion" on:click={confirmPermanentDelete}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 8l3.5 3.5L13 5"/></svg>
                  </button>
                  <button class="fm-icon-btn fm-icon-btn-sm" title="Cancel" on:click={() => permDeleteConfirm = null}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>
                  </button>
                {:else}
                  <button class="fm-icon-btn fm-icon-btn-sm" title="Restore" on:click={() => handleRestore(entry)}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M3 8a5 5 0 118 3.9M3 8V4M3 8h4"/></svg>
                  </button>
                  <button class="fm-icon-btn fm-icon-btn-sm fm-icon-btn-danger" title="Delete permanently" on:click={() => permDeleteConfirm = entry}>
                    <svg viewBox="0 0 16 16" width="14" height="14" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M3 4.5h10M6 4.5v-1.5h4v1.5M4 4.5l.8 8.5a1 1 0 001 1h4.4a1 1 0 001-1l.8-8.5"/></svg>
                  </button>
                {/if}
              </div>
            </div>
          {:else}
            {@const cat = categoryFor(entry)}
            <div
              class="fm-tile"
              class:fm-tile-selected={selectedPaths.has(itemPath(entry.name))}
              data-fm-item={itemPath(entry.name)}
              role="gridcell"
              tabindex="0"
              style="animation-delay: {i * 15}ms"
              on:click={(e) => handleEntryClick(e, entry, i)}
              on:dblclick={() => entry.type === 'directory' ? navigateInto(entry) : openFile(entry)}
              on:contextmenu={(e) => openContextMenu(e, entry)}
              on:keydown={(e) => handleKeydown(e, entry)}
            >
              <div class="fm-tile-icon">
                {#if cat === 'folder'}
                  <svg viewBox="0 0 16 16" width="30" height="30" fill="none" stroke="#4A90D9" stroke-width="1.3"><path d="M2 4V12a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H7L5 3H3a1 1 0 00-1 1z"/></svg>
                {:else if cat === 'image'}
                  <img class="fm-tile-thumb" src={rawUrl(itemPath(entry.name))} alt="" loading="lazy" />
                {:else if cat === 'video'}
                  <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><rect x="1.5" y="3" width="9" height="10" rx="1"/><path d="M12 6.5l3-2v7l-3-2z"/></svg>
                {:else if cat === 'audio'}
                  <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="currentColor" stroke-width="1.3"><path d="M6 12V3l8-1.3v9"/><circle cx="4" cy="12" r="2"/><circle cx="12" cy="10.7" r="2"/></svg>
                {:else if cat === 'pdf'}
                  <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="#E05D5D" stroke-width="1.3"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="28" height="28" fill="none" stroke="#888" stroke-width="1.3"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>
                {/if}
              </div>
              {#if renamingItem && renamingItem.name === entry.name}
                <input
                  class="fm-rename-input fm-rename-input-grid"
                  type="text"
                  bind:value={renameValue}
                  on:keydown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
                  on:blur={confirmRename}
                  use:autofocus
                />
              {:else}
                <div class="fm-tile-name" title={entry.name}>{entry.name}</div>
              {/if}
            </div>
          {/if}
        {/each}
      </div>
    {:else}
      <div class="fm-list">
        {#if parent !== null}
          <div class="fm-row fm-row-parent" on:click={() => navigateTo(parent)} on:keydown={(e) => e.key === 'Enter' && navigateTo(parent)} role="button" tabindex="0">
            <div class="fm-cell fm-cell-icon">
              <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M10 4L6 8l4 4"/></svg>
            </div>
            <div class="fm-cell fm-cell-name">..</div>
          </div>
        {/if}
        {#each filteredEntries as entry, i}
          {#if isDeletedEntry(entry)}
            <div class="fm-row fm-row-deleted" style="animation-delay: {i * 20}ms">
              <div class="fm-cell fm-cell-icon">
                <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5"><path d="M2 4h12M6 4V2h4v2M3 4l1 9a1 1 0 001 1h6a1 1 0 001-1l1-9"/></svg>
              </div>
              <div class="fm-cell fm-cell-name">
                {originalName(entry.name)}
                <span class="fm-deleted-badge">Deleted</span>
              </div>
              <div class="fm-cell fm-cell-actions">
                {#if permDeleteConfirm && permDeleteConfirm.name === entry.name}
                  <button class="fm-btn fm-btn-danger fm-btn-sm" on:click={confirmPermanentDelete}>Confirm</button>
                  <button class="fm-btn fm-btn-sm" on:click={() => permDeleteConfirm = null}>Cancel</button>
                {:else}
                  <button class="fm-btn fm-btn-sm" on:click={() => handleRestore(entry)}>Restore</button>
                  <button class="fm-btn fm-btn-danger fm-btn-sm" on:click={() => permDeleteConfirm = entry}>Delete permanently</button>
                {/if}
              </div>
            </div>
          {:else}
            <div
              class="fm-row"
              class:fm-row-selected={selectedPaths.has(itemPath(entry.name))}
              data-fm-item={itemPath(entry.name)}
              on:click={(e) => handleEntryClick(e, entry, i)}
              on:dblclick={() => entry.type === 'directory' ? navigateInto(entry) : openFile(entry)}
              on:contextmenu={(e) => openContextMenu(e, entry)}
              on:keydown={(e) => handleKeydown(e, entry)}
              role="button"
              tabindex="0"
              style="animation-delay: {i * 20}ms"
            >
              <div class="fm-cell fm-cell-icon">
                {#if entry.type === 'directory'}
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="#4A90D9" stroke-width="1.5"><path d="M2 4V12a1 1 0 001 1h10a1 1 0 001-1V5a1 1 0 00-1-1H7L5 3H3a1 1 0 00-1 1z"/></svg>
                {:else}
                  <svg viewBox="0 0 16 16" width="18" height="18" fill="none" stroke="#888" stroke-width="1.5"><path d="M3 2h6l4 4v8a1 1 0 01-1 1H3a1 1 0 01-1-1V3a1 1 0 011-1z"/><path d="M9 2v4h4"/></svg>
                {/if}
              </div>
              <div class="fm-cell fm-cell-name">
                {#if renamingItem && renamingItem.name === entry.name}
                  <input
                    class="fm-rename-input"
                    type="text"
                    bind:value={renameValue}
                    on:keydown={(e) => { if (e.key === 'Enter') confirmRename(); if (e.key === 'Escape') cancelRename(); }}
                    on:blur={confirmRename}
                    use:autofocus
                  />
                {:else}
                  {entry.name}
                  {#if entry.type === 'file' && entry.ext}
                    <span class="fm-ext-badge">{entry.ext}</span>
                  {/if}
                {/if}
              </div>
              <div class="fm-cell fm-cell-size">{entry.type === 'file' ? entry.sizeFormatted : '--'}</div>
              <div class="fm-cell fm-cell-modified">{formatDate(entry.modified)}</div>
            </div>
          {/if}
        {/each}
      </div>
    {/if}
  </div>
</div>

<!-- Context menu -->
{#if contextMenu.open}
  <div class="fm-context-overlay" on:click={closeContextMenu} on:contextmenu|preventDefault={closeContextMenu}></div>
  <div class="fm-context-menu" data-theme={theme} style="left:{contextMenu.x}px; top:{contextMenu.y}px;">
    {#if selectedEntries.length <= 1 && contextMenu.entry}
      <button class="fm-context-item" on:click={() => { contextMenu.entry.type === 'directory' ? navigateInto(contextMenu.entry) : openFile(contextMenu.entry); closeContextMenu(); }}>Open</button>
      {#each contextOpeners as opener}
        <button class="fm-context-item" on:click={() => { openInApp(opener, itemPath(contextMenu.entry.name)); closeContextMenu(); }}>Open with {opener.label}</button>
      {/each}
      <button class="fm-context-item" on:click={() => { startRename(contextMenu.entry); closeContextMenu(); }}>Rename</button>
      {#if isArchive(contextMenu.entry)}
        <button class="fm-context-item" on:click={() => { handleExtract(contextMenu.entry); closeContextMenu(); }}>Extract</button>
      {/if}
      <div class="fm-context-sep"></div>
    {/if}
    <button class="fm-context-item" on:click={() => { handleCopySelected(); closeContextMenu(); }}>Copy{selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ''}<span class="fm-shortcut">Ctrl+C</span></button>
    <button class="fm-context-item" on:click={() => { handleCutSelected(); closeContextMenu(); }}>Cut{selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ''}<span class="fm-shortcut">Ctrl+X</span></button>
    {#if !clipboard.empty}
      <button class="fm-context-item" on:click={() => { handlePaste(); closeContextMenu(); }}>Paste here<span class="fm-shortcut">Ctrl+V</span></button>
      {#if contextMenu.entry?.type === 'directory'}
        <button class="fm-context-item" on:click={() => { handlePaste(itemPath(contextMenu.entry.name)); closeContextMenu(); }}>Paste into “{contextMenu.entry.name}”</button>
      {/if}
    {/if}
    {#if selectedEntries.length === 1}
      <button class="fm-context-item" on:click={() => { showMoveInput = true; moveDest = ''; closeContextMenu(); }}>Move</button>
    {/if}
    <div class="fm-context-sep"></div>
    <button class="fm-context-item fm-context-item-danger" on:click={() => { handleDeleteSelected(); closeContextMenu(); }}>Delete{selectedEntries.length > 1 ? ` (${selectedEntries.length})` : ''}</button>
  </div>
{/if}

<!-- Options panel -->
{#if optionsOpen}
  <div class="fm-overlay fm-overlay-options" on:click={() => optionsOpen = false} on:keydown={(e) => e.key === 'Escape' && (optionsOpen = false)} role="button" tabindex="0">
    <div class="fm-drawer" data-theme={theme} on:click|stopPropagation>
      <div class="fm-drawer-header">
        <span class="fm-modal-title">Settings</span>
        <button class="fm-modal-close" on:click={() => optionsOpen = false}>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>
        </button>
      </div>
      <div class="fm-drawer-body">
        <label class="fm-option-row">
          <span>
            <span class="fm-option-title">Hide hidden files</span>
            <span class="fm-option-desc">Hide files and folders whose names begin with a dot.</span>
          </span>
          <input type="checkbox" checked={hideDotfiles} on:change={toggleHideDotfiles} />
        </label>
        <label class="fm-option-row">
          <span>
            <span class="fm-option-title">Show deleted items</span>
            <span class="fm-option-desc">Deletion is reversible. Restore an item or delete it permanently.</span>
          </span>
          <input type="checkbox" checked={showDeleted} on:change={toggleShowDeleted} />
        </label>
      </div>
    </div>
  </div>
{/if}

<!-- Viewer Modal -->
{#if viewerModal.open}
  <div class="fm-overlay" on:click={closeViewer} on:keydown={(e) => e.key === 'Escape' && closeViewer} role="button" tabindex="0">
    <div class="fm-modal" data-theme={theme} on:click|stopPropagation>
      <div class="fm-modal-header">
        <span class="fm-modal-title">{viewerModal.name || 'File Viewer'}</span>
        <div style="display:flex; gap:6px; align-items:center;">
          {#if viewerModal.url}
            <button class="fm-modal-close" style="width:auto; padding:0 10px; font-size:12px;" on:click={promoteViewerToTab} title="Open in a tab">Open in tab</button>
          {/if}
          <button class="fm-modal-close" on:click={closeViewer}>
            <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><path d="M4 4l8 8M12 4l-8 8"/></svg>
          </button>
        </div>
      </div>
      <div class="fm-modal-body">
        {#if viewerModal.error}
          <div class="fm-no-viewer">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#888" stroke-width="1.5"><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10 10-4.5 10-10S17.5 2 12 2z"/><path d="M12 8v4M12 16h.01"/></svg>
            <p>{viewerModal.error}</p>
          </div>
        {:else}
          <iframe src={viewerModal.url} class="fm-iframe" title="File Viewer"></iframe>
        {/if}
      </div>
    </div>
  </div>
{/if}

<style>
  :global(html), :global(body) { margin: 0; padding: 0; }

  /* .fm-modal, .fm-drawer and .fm-context-menu render outside .fm-container's DOM
     subtree (they're mounted as top-level overlay siblings), so they don't inherit
     --tk-* via CSS custom-property inheritance — each needs its own [data-theme] token block. */
  .fm-container[data-theme="dark"], .fm-modal[data-theme="dark"], .fm-drawer[data-theme="dark"], .fm-context-menu[data-theme="dark"] {
    --tk-bg: #111111; --tk-surface: #181818; --tk-surface-2: #1f1f1f;
    --tk-border: rgba(255,255,255,.09); --tk-border-hi: rgba(255,255,255,.16);
    --tk-text: #f5f5f5; --tk-muted: #888888; --tk-muted-2: rgba(136,136,136,.5);
    --tk-accent: #f5f5f5; --tk-on-accent: #111111;
    --tk-radius-md: 8px; --tk-radius-lg: 14px;
    --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
    --fm-danger: #e05d5d; --fm-danger-on: #ffffff;
    --fm-shadow: 0 8px 24px rgba(0,0,0,.45);
  }
  .fm-container[data-theme="light"], .fm-modal[data-theme="light"], .fm-drawer[data-theme="light"], .fm-context-menu[data-theme="light"] {
    --tk-bg: #ffffff; --tk-surface: #f5f5f5; --tk-surface-2: #ececec;
    --tk-border: rgba(0,0,0,.10); --tk-border-hi: rgba(0,0,0,.18);
    --tk-text: #1a1a1a; --tk-muted: #666666; --tk-muted-2: rgba(0,0,0,.4);
    --tk-accent: #111111; --tk-on-accent: #ffffff;
    --tk-radius-md: 8px; --tk-radius-lg: 14px;
    --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
    --fm-danger: #e05d5d; --fm-danger-on: #ffffff;
    --fm-shadow: 0 2px 8px rgba(0,0,0,.08);
  }

  .fm-container {
    background: var(--tk-bg);
    color: var(--tk-text);
    font-family: var(--tk-font);
    font-size: 16px;
    line-height: 1.6;
    padding: 0;
    margin: 0;
    width: 100%;
    min-height: 100dvh;
    display: flex;
    flex-direction: column;
    padding-bottom: env(safe-area-inset-bottom, 0px);
  }

  /* Breadcrumbs */
  .fm-breadcrumbs {
    display: flex;
    align-items: center;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 0;
    padding: 0.75rem 1rem;
    background: var(--tk-surface);
    border-bottom: 1px solid var(--tk-border);
    position: sticky;
    top: 0;
    z-index: 100;
  }
  .fm-crumb {
    background: none;
    border: none;
    color: var(--tk-text);
    font-size: 0.875rem;
    font-weight: 600;
    cursor: pointer;
    padding: 0.25rem 0.5rem;
    border-radius: var(--tk-radius-md);
    transition: background 200ms ease-out;
    white-space: nowrap;
  }
  .fm-crumb:hover {
    background: var(--tk-surface-2);
  }
  .fm-crumb-sep {
    color: var(--tk-muted);
    font-size: 0.875rem;
    padding: 0 0.25rem;
  }

  /* Toolbar */
  .fm-toolbar {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--tk-surface);
    border-bottom: 1px solid var(--tk-border);
  }
  .fm-toolbar-group {
    display: flex;
    gap: 0.375rem;
    flex-wrap: wrap;
  }
  .fm-toolbar-group-view {
    margin-left: auto;
  }

  /* Buttons */
  .fm-btn {
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    padding: 0.4rem 0.75rem;
    font-size: 0.8125rem;
    font-weight: 600;
    color: var(--tk-text);
    cursor: pointer;
    transition: all 200ms ease-out;
    white-space: nowrap;
  }
  .fm-btn:hover:not(:disabled) {
    background: var(--tk-surface-2);
    border-color: var(--tk-border-hi);
  }
  .fm-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .fm-btn-primary {
    background: var(--tk-accent);
    color: var(--tk-on-accent);
    border-color: var(--tk-accent);
  }
  .fm-btn-primary:hover:not(:disabled) {
    opacity: 0.85;
  }
  .fm-btn-danger {
    color: var(--fm-danger);
    border-color: var(--fm-danger);
  }
  .fm-btn-danger:hover:not(:disabled) {
    background: var(--fm-danger);
    color: var(--fm-danger-on);
  }
  .fm-btn-sm {
    padding: 0.25rem 0.5rem;
    font-size: 0.75rem;
  }

  .fm-icon-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    color: var(--tk-muted);
    cursor: pointer;
    transition: all 200ms ease-out;
  }
  .fm-icon-btn:hover {
    background: var(--tk-surface-2);
    color: var(--tk-text);
  }
  .fm-icon-btn-active {
    color: var(--tk-text);
    border-color: var(--tk-border-hi);
    background: var(--tk-surface-2);
  }
  .fm-icon-btn-sm {
    width: 26px;
    height: 26px;
  }
  .fm-icon-btn-danger {
    color: var(--fm-danger);
    border-color: var(--fm-danger);
  }
  .fm-icon-btn-danger:hover {
    background: var(--fm-danger);
    color: var(--fm-danger-on);
  }

  /* Clipboard badge */
  .fm-clipboard-badge {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    background: var(--tk-surface-2);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    padding: 0.3rem 0.6rem;
    font-size: 0.75rem;
    color: var(--tk-text);
    width: 100%;
  }
  .fm-clipboard-type {
    font-weight: 600;
    text-transform: uppercase;
    color: var(--tk-muted);
    font-size: 0.6875rem;
  }
  .fm-clipboard-path {
    color: var(--tk-muted);
    max-width: 200px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Inline inputs */
  .fm-inline-input {
    padding: 0.75rem 1rem;
    background: var(--tk-surface-2);
    border-bottom: 1px solid var(--tk-border);
  }
  .fm-inline-input label {
    display: block;
    font-size: 0.75rem;
    color: var(--tk-muted);
    margin-bottom: 0.25rem;
  }
  .fm-inline-input-row {
    display: flex;
    gap: 0.5rem;
    align-items: center;
  }
  .fm-inline-input-row input {
    flex: 1;
  }

  /* New item */
  .fm-new-item {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    background: var(--tk-surface-2);
    border-bottom: 1px solid var(--tk-border);
  }
  .fm-new-item-icon {
    color: var(--tk-muted);
    display: flex;
    align-items: center;
  }
  .fm-new-item input {
    flex: 1;
  }

  /* Inputs */
  input[type="text"] {
    background: var(--tk-bg);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    padding: 0.4rem 0.6rem;
    font-size: 0.8125rem;
    color: var(--tk-text);
    outline: none;
    transition: border-color 200ms ease-out, box-shadow 200ms ease-out;
  }
  input[type="text"]:focus {
    border-color: var(--tk-accent);
    box-shadow: 0 0 0 2px var(--tk-muted-2);
  }

  /* Error */
  .fm-error {
    background: rgba(224,93,93,0.12);
    color: var(--fm-danger);
    padding: 0.6rem 1rem;
    font-size: 0.8125rem;
    border-bottom: 1px solid var(--tk-border);
    cursor: pointer;
  }
  .fm-notice {
    background: var(--tk-surface-2);
    color: var(--tk-text);
    padding: 0.6rem 1rem;
    font-size: 0.8125rem;
    border-bottom: 1px solid var(--tk-border);
    cursor: pointer;
  }

  /* List */
  .fm-list-container {
    flex: 1;
    overflow-y: auto;
    padding: 0.75rem;
    position: relative;
    user-select: none;
  }
  .fm-dropzone-active {
    outline: 2px dashed var(--tk-accent);
    outline-offset: -4px;
  }
  .fm-dropzone-overlay {
    position: absolute;
    inset: 0;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    background: var(--tk-muted-2);
    color: var(--tk-text);
    font-weight: 600;
    font-size: 0.9375rem;
    pointer-events: none;
  }
  .fm-marquee {
    position: fixed;
    z-index: 60;
    border: 1px solid var(--tk-accent);
    background: var(--tk-muted-2);
    pointer-events: none;
  }
  .fm-uploading-badge {
    background: var(--tk-surface-2);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    padding: 0.3rem 0.6rem;
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--tk-text);
  }
  .fm-loading, .fm-empty {
    padding: 2rem 1rem;
    text-align: center;
    color: var(--tk-muted);
    font-size: 0.875rem;
  }
  .fm-list {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }

  /* Rows */
  .fm-row {
    display: flex;
    align-items: center;
    padding: 0.5rem 0.75rem;
    cursor: pointer;
    background: var(--tk-surface);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    transition: background 200ms ease-out;
    animation: fmFadeIn 250ms ease-out both;
  }
  .fm-row:hover {
    background: var(--tk-surface-2);
  }
  .fm-row-selected {
    background: var(--tk-surface-2) !important;
    box-shadow: inset 2px 0 0 var(--tk-accent);
  }
  .fm-row-parent {
    color: var(--tk-muted);
  }
  .fm-row-deleted {
    opacity: 0.7;
  }
  .fm-deleted-badge {
    font-size: 0.6875rem;
    color: var(--fm-danger);
    background: rgba(224,93,93,0.12);
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-weight: 600;
    text-transform: uppercase;
  }

  @keyframes fmFadeIn {
    from { opacity: 0; transform: translateY(4px); }
    to { opacity: 1; transform: translateY(0); }
  }

  /* Cells */
  .fm-cell {
    padding: 0 0.5rem;
  }
  .fm-cell-icon {
    display: flex;
    align-items: center;
    flex-shrink: 0;
  }
  .fm-cell-name {
    flex: 1;
    font-size: 0.875rem;
    display: flex;
    align-items: center;
    gap: 0.375rem;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .fm-cell-size {
    width: 80px;
    text-align: right;
    font-size: 0.75rem;
    color: var(--tk-muted);
    flex-shrink: 0;
  }
  .fm-cell-modified {
    width: 140px;
    font-size: 0.75rem;
    color: var(--tk-muted);
    flex-shrink: 0;
  }
  .fm-cell-actions {
    display: flex;
    gap: 0.25rem;
    flex-shrink: 0;
  }

  /* Extension badge */
  .fm-ext-badge {
    font-size: 0.6875rem;
    color: var(--tk-muted);
    background: var(--tk-surface-2);
    padding: 0.1rem 0.3rem;
    border-radius: 0.25rem;
    font-weight: 500;
  }

  /* Rename input */
  .fm-rename-input {
    width: 100%;
    padding: 0.2rem 0.4rem;
    font-size: 0.875rem;
  }
  .fm-rename-input-grid {
    width: 90%;
    text-align: center;
    font-size: 0.75rem;
  }

  /* Grid */
  .fm-grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(96px, 1fr));
    gap: 0.75rem;
    padding: 0.9rem;
  }
  .fm-tile {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.4rem;
    padding: 0.75rem 0.4rem;
    border-radius: var(--tk-radius-md);
    cursor: pointer;
    border: 1px solid transparent;
    animation: fmFadeIn 220ms ease-out both;
    text-align: center;
  }
  .fm-tile:hover {
    background: var(--tk-surface-2);
  }
  .fm-tile-selected {
    background: var(--tk-surface-2);
    border-color: var(--tk-border-hi);
  }
  .fm-tile-parent {
    color: var(--tk-muted);
  }
  .fm-tile-deleted {
    opacity: 0.7;
    cursor: default;
  }
  .fm-tile-deleted-actions {
    display: flex;
    gap: 0.3rem;
  }
  .fm-tile-icon {
    width: 44px;
    height: 44px;
    display: flex;
    align-items: center;
    justify-content: center;
  }
  .fm-tile-thumb {
    width: 44px;
    height: 44px;
    object-fit: cover;
    border-radius: 0.3rem;
    border: 1px solid var(--tk-border);
  }
  .fm-tile-name {
    font-size: 0.75rem;
    max-width: 100%;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  /* Overlay / Modal */
  .fm-overlay {
    position: fixed;
    top: 0; left: 0; right: 0; bottom: 0;
    background: rgba(0,0,0,0.5);
    z-index: 200;
    display: flex;
    align-items: center;
    justify-content: center;
    animation: fmOverlayIn 200ms ease-out;
  }
  .fm-overlay-options {
    justify-content: flex-end;
    align-items: stretch;
  }
  @keyframes fmOverlayIn {
    from { opacity: 0; }
    to { opacity: 1; }
  }
  .fm-modal {
    background: var(--tk-bg);
    color: var(--tk-text);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-lg);
    box-shadow: var(--fm-shadow);
    width: 90vw;
    max-width: 900px;
    height: 80vh;
    display: flex;
    flex-direction: column;
    z-index: 300;
    animation: fmModalIn 250ms ease-out;
  }
  @keyframes fmModalIn {
    from { opacity: 0; transform: translateY(12px); }
    to { opacity: 1; transform: translateY(0); }
  }
  .fm-modal-header, .fm-drawer-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.75rem 1rem;
    border-bottom: 1px solid var(--tk-border);
  }
  .fm-modal-title {
    font-size: 0.875rem;
    font-weight: 600;
    color: var(--tk-text);
  }
  .fm-modal-close {
    background: none;
    border: none;
    cursor: pointer;
    color: var(--tk-muted);
    padding: 0.25rem;
    border-radius: 0.25rem;
    display: flex;
    align-items: center;
    transition: background 200ms ease-out;
  }
  .fm-modal-close:hover {
    background: var(--tk-surface-2);
    color: var(--tk-text);
  }
  .fm-modal-body {
    flex: 1;
    overflow: hidden;
    border-radius: 0 0 var(--tk-radius-lg) var(--tk-radius-lg);
  }
  .fm-iframe {
    width: 100%;
    height: 100%;
    border: none;
  }
  .fm-no-viewer {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    height: 100%;
    gap: 1rem;
    color: var(--tk-muted);
  }
  .fm-no-viewer p {
    font-size: 0.875rem;
  }

  /* Options drawer */
  .fm-drawer {
    background: var(--tk-bg);
    color: var(--tk-text);
    border-left: 1px solid var(--tk-border);
    box-shadow: var(--fm-shadow);
    width: min(320px, 88vw);
    height: 100%;
    display: flex;
    flex-direction: column;
    animation: fmDrawerIn 250ms cubic-bezier(.32,.72,0,1);
  }
  @keyframes fmDrawerIn {
    from { transform: translateX(100%); }
    to { transform: translateX(0); }
  }
  .fm-drawer-body {
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }
  .fm-option-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    cursor: pointer;
  }
  .fm-option-title {
    display: block;
    font-size: 0.875rem;
    font-weight: 600;
  }
  .fm-option-desc {
    display: block;
    font-size: 0.75rem;
    color: var(--tk-muted);
    margin-top: 0.15rem;
  }
  .fm-option-row input[type="checkbox"] {
    width: 18px;
    height: 18px;
    accent-color: var(--tk-accent);
    flex-shrink: 0;
  }

  /* Context menu (right-click) — anchored at the cursor, opening upward */
  .fm-context-overlay {
    position: fixed;
    inset: 0;
    z-index: 400;
    background: transparent;
  }
  .fm-context-menu {
    position: fixed;
    z-index: 401;
    transform: translateY(-100%);
    margin-top: -6px;
    min-width: 160px;
    background: var(--tk-bg);
    color: var(--tk-text);
    border: 1px solid var(--tk-border);
    border-radius: var(--tk-radius-md);
    box-shadow: var(--fm-shadow);
    padding: 0.3rem;
    display: flex;
    flex-direction: column;
    animation: fmContextIn 140ms ease-out;
  }
  @keyframes fmContextIn {
    from { opacity: 0; transform: translateY(-96%); }
    to { opacity: 1; transform: translateY(-100%); }
  }
  .fm-context-item {
    background: none;
    border: none;
    text-align: left;
    padding: 0.45rem 0.6rem;
    font-size: 0.8125rem;
    font-weight: 500;
    color: var(--tk-text);
    border-radius: 0.35rem;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1.5rem;
  }
  .fm-shortcut {
    color: var(--tk-muted);
    font-size: 0.6875rem;
    font-family: var(--tk-mono);
  }
  .fm-context-item:hover {
    background: var(--tk-surface-2);
  }
  .fm-context-item-danger {
    color: var(--fm-danger);
  }
  .fm-context-item-danger:hover {
    background: var(--fm-danger);
    color: var(--fm-danger-on);
  }
  .fm-context-sep {
    height: 1px;
    background: var(--tk-border);
    margin: 0.25rem 0.2rem;
  }

  /* Responsive / mobile */
  @media (max-width: 640px) {
    .fm-cell-size, .fm-cell-modified {
      display: none;
    }
    .fm-toolbar {
      gap: 0.25rem;
    }
    .fm-btn {
      padding: 0.35rem 0.5rem;
      font-size: 0.75rem;
    }
    .fm-clipboard-path {
      max-width: 120px;
    }
    .fm-modal {
      width: 95vw;
      height: 85vh;
    }
    .fm-grid {
      grid-template-columns: repeat(auto-fill, minmax(78px, 1fr));
      gap: 0.5rem;
    }
  }

  @media (pointer: coarse) {
    .fm-btn, .fm-icon-btn, .fm-crumb {
      min-height: 40px;
    }
    .fm-row {
      padding: 0.7rem 0.75rem;
    }
  }
</style>
