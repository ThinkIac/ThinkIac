<script>
    import { onMount, createEventDispatcher } from 'svelte';
    import Editor from './Editor.svelte';
    import { langLabel } from './lib/lang-label.js';

    // Populated automatically from the `?path=` query string by the shared
    // view-engine (req.query is forwarded as component props on both SSR and
    // hydration) — no onMount/URLSearchParams parsing needed.
    export let path = '';
    export let embedded = false;
    export let value = '';
    const dispatch = createEventDispatcher();

    // Keep in sync with the CORE_PACKAGES list in views/Index.svelte.
    const CORE_PACKAGES = ['agent','agent-config','agent-host','delegatus','engineer','router','sandbox','scheduler','tasks','navegador','adb','moondream','ntfy','memory-tools'];

    let content = '';
    let originalContent = '';
    let isLoading = !embedded;
    let loadError = '';
    let isSaving = false;
    let saveMessage = '';
    let saveMessageType = '';
    let showWarning = false;
    let pendingSave = false;
    // mtime the file was read at, sent back on save so a concurrent write by
    // Agent (or another editor) is refused instead of silently clobbered.
    let baseMtime = null;

    // Follows the shell's theme like Index.svelte does, instead of the
    // hardcoded dark palette this view used to hardcode in :global(:root).
    let theme = 'dark';

    $: if (embedded) content = value;
    $: dirty = content !== originalContent;
    $: lang = langLabel(path);
    $: fileName = path ? path.split('/').pop() : '';
    $: packageId = path ? path.replace(/^\.?\/?(apps\/thinkiac\/)?packages\//, '').split('/')[0] : '';
    $: isCorePackage = CORE_PACKAGES.includes(packageId);

    // The embed is opened as a tab from file-manager, so navigating away is a
    // realistic way to lose edits.
    onMount(() => {
        theme = localStorage.getItem('agent:theme') === 'light' ? 'light' : 'dark';
        const onStorage = (event) => { if (event.key === 'agent:theme') theme = event.newValue === 'light' ? 'light' : 'dark'; };
        const onBeforeUnload = (event) => {
            if (!dirty) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('beforeunload', onBeforeUnload);
        return () => {
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('beforeunload', onBeforeUnload);
        };
    });

    async function load() {
        isLoading = true;
        loadError = '';
        try {
            const res = await fetch(`/code-editor/file/read-by-path?path=${encodeURIComponent(path)}`);
            const data = await res.json();
            if (res.ok) {
                content = data.content;
                originalContent = data.content;
                baseMtime = data.mtime ?? null;
            } else {
                loadError = data.error || 'Failed to load file';
            }
        } catch (e) {
            loadError = e.message;
        }
        isLoading = false;
    }

    $: if (path && !embedded) load();

    async function saveFile(force = false) {
        if (embedded) { dispatch('save', content); return; }
        if (isCorePackage && !pendingSave) {
            showWarning = true;
            pendingSave = true;
            return;
        }
        pendingSave = false;
        isSaving = true;
        saveMessage = '';
        try {
            const res = await fetch('/code-editor/file/write-by-path', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ path, content, baseMtime: force ? null : baseMtime })
            });
            const data = await res.json();
            if (res.ok) {
                saveMessage = 'Saved'; saveMessageType = 'success';
                originalContent = content;
                baseMtime = data.mtime ?? baseMtime;
            } else if (res.status === 409) {
                isSaving = false;
                if (confirm(`${fileName} changed on disk after you opened it.\n\nOK = overwrite it with your version (the disk copy is kept in .backups/).\nCancel = keep your edits here and save nothing.`)) {
                    return saveFile(true);
                }
                saveMessage = 'Not saved — file changed on disk'; saveMessageType = 'error';
                setTimeout(() => { saveMessage = ''; }, 3500);
                return;
            } else {
                saveMessage = data.error || 'Error'; saveMessageType = 'error';
            }
        } catch {
            saveMessage = 'Network error'; saveMessageType = 'error';
        }
        isSaving = false;
        setTimeout(() => { saveMessage = ''; }, 2500);
    }

    function confirmSave() { showWarning = false; saveFile(); }
    function cancelSave() { showWarning = false; pendingSave = false; }

    function onEditorChange(event) { content = event.detail; if (embedded) { value = content; dispatch('change', content); } }
</script>

<!-- A @import inside <style> is dropped by the runtime's CSS concatenation (the
     same trap documented in Index.svelte); a <link> is not order-sensitive. -->
<svelte:head>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,400&family=Ubuntu+Mono:ital,wght@0,400;0,700;1,400&display=swap" />
</svelte:head>

<div class="embed" class:controlled={embedded} data-theme={theme}>
    <div class="topbar">
        <span class="filename" title={path}>{fileName}</span>
        {#if dirty}<span class="dirty-dot" aria-label="unsaved"></span>{/if}
        <span class="lang-badge">{lang}</span>
        <div class="topbar-right">
            {#if saveMessage}<span class="save-badge {saveMessageType}">{saveMessage}</span>{/if}
            <button class="save-btn" on:click={() => saveFile()} disabled={isSaving || isLoading || !!loadError}>
                {isSaving ? 'Saving…' : 'Save'}
            </button>
        </div>
    </div>

    <div class="editor-wrap">
        {#if isLoading}
            <div class="empty-state"><p>Loading…</p></div>
        {:else if loadError}
            <div class="empty-state"><p>{loadError}</p></div>
        {:else}
            <Editor
                value={content}
                {path}
                {theme}
                on:change={onEditorChange}
                on:save={() => saveFile()}
            />
        {/if}
    </div>
</div>

{#if showWarning}
    <div class="modal-bg" on:click={cancelSave} role="dialog" aria-modal="true">
        <div class="modal" on:click|stopPropagation>
            <div class="modal-icon">⚠️</div>
            <h2>Core Package</h2>
            <p>You're about to save changes to <strong>{packageId}</strong>, a core system package.</p>
            <p class="modal-warn">Changes can break the entire Agent system.</p>
            <div class="modal-btns">
                <button class="btn-cancel" on:click={cancelSave}>Cancel</button>
                <button class="btn-confirm" on:click={confirmSave}>Save anyway</button>
            </div>
        </div>
    </div>
{/if}

<style>
    /* Tokens are scoped to .embed, not :global(:root): this view is mounted
       inside file-manager's page, and a :root override leaked its dark palette
       onto the host. Syntax colours now live in lib/editor-setup.js. */
    .embed[data-theme="dark"] {
        --vsc-bg: #111111;
        --vsc-surface: #181818;
        --vsc-border: rgba(255,255,255,.09);
        --vsc-text: #f5f5f5;
        --vsc-muted: #888888;
        --vsc-accent: #f5f5f5;
        --vsc-on-accent: #111111;
    }
    .embed[data-theme="light"] {
        --vsc-bg: #ffffff;
        --vsc-surface: #f5f5f5;
        --vsc-border: rgba(0,0,0,.10);
        --vsc-text: #1a1a1a;
        --vsc-muted: #666666;
        --vsc-accent: #111111;
        --vsc-on-accent: #ffffff;
    }

    .embed {
        display: flex;
        flex-direction: column;
        height: 100dvh;
        background: var(--vsc-bg);
        color: var(--vsc-text);
        font-family: 'Ubuntu Mono', 'Consolas', 'Menlo', 'Monaco', monospace;
        overflow: hidden;
    }

    .embed.controlled { height: 480px; min-height: 280px; border: 1px solid var(--vsc-border); border-radius: 8px; }
    .topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 12px;
        background: var(--vsc-surface);
        border-bottom: 1px solid var(--vsc-border);
        flex-shrink: 0;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .filename {
        font-size: 12px;
        color: var(--vsc-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .dirty-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vsc-text);
        flex-shrink: 0;
    }
    .lang-badge {
        font-size: 10px;
        letter-spacing: .06em;
        text-transform: uppercase;
        color: var(--vsc-muted);
        border: 1px solid var(--vsc-border);
        border-radius: 3px;
        padding: 1px 5px;
    }
    .topbar-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }
    .save-btn {
        background: transparent;
        border: 1px solid rgba(255,255,255,.2);
        color: var(--vsc-text);
        border-radius: 3px;
        padding: 3px 10px;
        font-size: 12px;
        cursor: pointer;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .save-btn:hover:not(:disabled) { background: rgba(255,255,255,.08); }
    .save-btn:disabled { opacity: .4; cursor: not-allowed; }
    .save-badge {
        font-size: 11px;
        padding: 2px 8px;
        border-radius: 3px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        white-space: nowrap;
    }
    .save-badge.success { color: #4ade80; background: rgba(74,222,128,.1); }
    .save-badge.error   { color: #f87171; background: rgba(248,113,113,.1); }

    .editor-wrap {
        flex: 1;
        display: flex;
        overflow: hidden;
        position: relative;
        background: var(--vsc-bg);
    }
    .empty-state {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--vsc-muted);
        font-family: 'Ubuntu', system-ui, sans-serif;
        font-size: 13px;
    }
    .modal-bg {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.65);
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .modal {
        background: var(--vsc-surface);
        border: 1px solid var(--vsc-border);
        border-radius: 6px;
        padding: 24px 20px;
        max-width: 340px;
        width: 90%;
        text-align: center;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .modal-icon { font-size: 36px; margin-bottom: 10px; }
    .modal h2 { font-size: 15px; font-weight: 600; margin: 0 0 8px; color: var(--vsc-text); }
    .modal p { font-size: 12px; color: var(--vsc-muted); line-height: 1.5; margin: 0 0 6px; }
    .modal-warn { color: #f87171 !important; }
    .modal-btns { display: flex; gap: 8px; justify-content: center; margin-top: 16px; }
    .btn-cancel {
        background: transparent;
        border: 1px solid var(--vsc-border);
        color: var(--vsc-muted);
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 12px;
        cursor: pointer;
    }
    .btn-confirm {
        background: var(--vsc-accent);
        border: none;
        /* --vsc-accent is near-white in the dark theme, so a hardcoded #fff
           label was white on white. */
        color: var(--vsc-on-accent);
        padding: 6px 14px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
    }
</style>
