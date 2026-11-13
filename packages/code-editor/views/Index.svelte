<script>
    import { onMount, tick } from 'svelte';
    import Editor from './Editor.svelte';
    import { langLabel, extOf } from './lib/lang-label.js';

    // ── State ──────────────────────────────────────────────────────────────────
    let packages = [];
    let selectedPackage = null;
    let selectedPackageId = '';
    let files = [];
    const packageEnvironments = new Map();

    // Tabs: array of { path, content, dirty }
    let tabs = [];
    let activeTabIdx = -1;

    let isLoadingPackages = false;
    let isLoadingFiles = false;
    let isLoadingFile = false;
    let isSaving = false;
    let saveMessage = '';
    let saveMessageType = '';

    let showWarning = false;
    let pendingSave = false; // true = warning triggered by save attempt
    let conflict = null;     // { tabIdx, path } when the file changed under us
    let sidebarOpen = false; // mobile: sidebar drawer
    let showSearch = false;
    let searchQuery = '';
    let searchResults = [];
    let searching = false;
    let showPalette = false;
    let showTerminal = false;
    let fileAction = null;
    let fileActionValue = '';
    let fileActionError = '';
    let theme = 'dark';
    let packageMenuOpen = false;
    let packageQuery = '';
    let packageSearchInput;
    let fileActionInput;
    let fileActionBusy = false;
    $: filteredPackages = packages.filter(pkg => `${pkg.declaredName || pkg.name} ${pkg.name} ${pkg.id}`.toLowerCase().includes(packageQuery.toLowerCase().trim()));

    // Folder expand state: Set of folder paths that are open
    let expandedFolders = new Set();

    // ── Git + AI ───────────────────────────────────────────────────────────────
    let gitStatus = {};   // { 'views/Index.svelte': 'modified', … }
    let gitAvailable = true;
    let showDiff = null;  // { path, diff, untracked }
    let aiActions = [];   // fetched from the backend so both sides agree
    let aiPanel = null;   // { action, label, mode, status, text, model, from, to, error }

    const GIT_BADGE = { modified: 'M', added: 'A', deleted: 'D', renamed: 'R', copied: 'C', conflict: '!', untracked: '?' };

    let editorRef;

    const CORE_PACKAGES = ['agent','agent-config','agent-host','delegatus','engineer','router','sandbox','scheduler','tasks','navegador','adb','moondream','ntfy','memory-tools'];

    // ── Derived ────────────────────────────────────────────────────────────────
    $: activeTab = tabs[activeTabIdx] ?? null;
    $: fileContent = activeTab?.content ?? '';
    $: selectedFile = activeTab?.path ?? null;
    $: isCorePackage = selectedPackage ? CORE_PACKAGES.includes(selectedPackage.id) : false;

    // ── Session persistence ────────────────────────────────────────────────────
    // The per-package environment used to live only in the in-memory Map above,
    // so a reload dropped every open tab, expanded folder and the terminal
    // state. Unsaved buffer contents are persisted too, which is what makes a
    // reload non-destructive.
    const SESSION_KEY = 'code-editor:session:v1';

    function persistSession() {
        saveEnvironment();
        try {
            const environments = {};
            for (const [pkg, env] of packageEnvironments) environments[pkg] = env;
            localStorage.setItem(SESSION_KEY, JSON.stringify({
                selectedPackageId, environments, editorFontSize,
            }));
        } catch { /* quota exceeded or storage disabled: session is best-effort */ }
    }

    function restoreSession() {
        try {
            const raw = localStorage.getItem(SESSION_KEY);
            if (!raw) return null;
            const saved = JSON.parse(raw);
            for (const [pkg, env] of Object.entries(saved.environments ?? {})) packageEnvironments.set(pkg, env);
            if (Number.isFinite(saved.editorFontSize)) {
                editorFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, saved.editorFontSize));
            }
            return saved.selectedPackageId ?? null;
        } catch { return null; }
    }

    $: hasUnsavedWork = tabs.some(tab => tab.dirty)
        || [...packageEnvironments.values()].some(env => env.tabs?.some(tab => tab.dirty));

    // ── Lifecycle ──────────────────────────────────────────────────────────────
    onMount(async () => {
        theme = localStorage.getItem('think:theme') === 'light' ? 'light' : 'dark';
        const onStorage = (event) => { if (event.key === 'think:theme') theme = event.newValue === 'light' ? 'light' : 'dark'; };
        const onBeforeUnload = (event) => {
            persistSession();
            if (!hasUnsavedWork) return;
            event.preventDefault();
            event.returnValue = '';
        };
        window.addEventListener('storage', onStorage);
        window.addEventListener('beforeunload', onBeforeUnload);
        const restoredPackage = restoreSession();
        loadAiActions();
        await loadPackages(restoredPackage);
        window.addEventListener('keydown', onGlobalKeydown);
        return () => {
            persistSession();
            window.removeEventListener('storage', onStorage);
            window.removeEventListener('beforeunload', onBeforeUnload);
            window.removeEventListener('keydown', onGlobalKeydown);
        };
    });

    // ── API calls ──────────────────────────────────────────────────────────────
    async function loadPackages(preferredId = null) {
        isLoadingPackages = true;
        try {
            const res = await fetch('/code-editor/packages');
            if (res.ok) {
                packages = await res.json();
                // Prefer the package from the restored session, but fall back to
                // the first one if it has since been deleted or renamed.
                const target = packages.some(pkg => pkg.id === preferredId) ? preferredId : packages[0]?.id;
                if (target) await selectPackage(target);
            }
        } catch (e) { console.error(e); }
        isLoadingPackages = false;
    }

    async function selectPackage(packageId) {
        if (packageId === selectedPackageId) return;
        saveEnvironment();
        selectedPackageId = packageId;
        selectedPackage = packages.find(p => p.id === packageId);
        const saved = packageEnvironments.get(packageId);
        tabs = saved?.tabs ? saved.tabs.map(tab => ({ ...tab })) : [];
        activeTabIdx = saved?.activeTabIdx ?? -1;
        expandedFolders = new Set(saved?.expandedFolders ?? []);
        showTerminal = saved?.showTerminal ?? false;
        await loadFiles(packageId);
    }

    function saveEnvironment() {
        if (!selectedPackageId) return;
        packageEnvironments.set(selectedPackageId, { tabs: tabs.map(tab => ({ ...tab })), activeTabIdx, expandedFolders: [...expandedFolders], showTerminal });
    }

    async function loadFiles(packageId) {
        isLoadingFiles = true;
        try {
            const res = await fetch(`/code-editor/files?package=${encodeURIComponent(packageId)}`);
            if (res.ok) files = await res.json();
        } catch (e) { console.error(e); }
        isLoadingFiles = false;
        loadGitStatus(packageId); // not awaited: the tree renders without it
    }

    async function loadGitStatus(packageId) {
        try {
            const res = await fetch(`/code-editor/git/status?package=${encodeURIComponent(packageId)}`);
            if (res.ok) {
                gitStatus = (await res.json()).files ?? {};
                gitAvailable = true;
            } else {
                // No git, or the package is not in a repo: badges just stay off.
                gitStatus = {};
                gitAvailable = false;
            }
        } catch { gitStatus = {}; gitAvailable = false; }
    }

    async function openDiff(filePath) {
        if (!selectedPackage || !filePath) return;
        try {
            const res = await fetch(`/code-editor/git/diff?package=${encodeURIComponent(selectedPackage.id)}&path=${encodeURIComponent(filePath)}`);
            const data = await res.json();
            if (!res.ok) { saveMessage = data.error || 'Diff failed'; saveMessageType = 'error'; setTimeout(() => { saveMessage = ''; }, 2500); return; }
            showDiff = data;
        } catch { saveMessage = 'Network error'; saveMessageType = 'error'; }
    }

    // ── AI actions on the current selection ────────────────────────────────────
    async function loadAiActions() {
        try {
            const res = await fetch('/code-editor/ai/actions');
            if (res.ok) aiActions = await res.json();
        } catch { aiActions = []; }
    }

    async function runAiAction(action) {
        const selection = editorRef?.getSelection();
        if (!selection?.text?.trim()) {
            saveMessage = 'Select some code first'; saveMessageType = 'error';
            setTimeout(() => { saveMessage = ''; }, 2500);
            return;
        }
        aiPanel = {
            action: action.id, label: action.label, mode: action.mode,
            status: 'running', text: '', model: null, error: '',
            from: selection.from, to: selection.to,
        };
        try {
            const res = await fetch('/code-editor/ai/assist', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    package: selectedPackage?.id,
                    path: activeTab?.path,
                    action: action.id,
                    selection: selection.text,
                })
            });
            const data = await res.json();
            if (!res.ok) aiPanel = { ...aiPanel, status: 'error', error: data.error || 'Request failed' };
            else aiPanel = { ...aiPanel, status: 'done', text: data.text, model: data.model, mode: data.mode };
        } catch (e) {
            aiPanel = { ...aiPanel, status: 'error', error: 'Network error' };
        }
    }

    // Only offered for 'replace' actions; the original selection range is used,
    // so editing elsewhere in the meantime would apply it in the wrong place.
    function applyAiResult() {
        if (!aiPanel || aiPanel.mode !== 'replace' || !aiPanel.text) return;
        editorRef?.replaceRange(aiPanel.from, aiPanel.to, aiPanel.text);
        aiPanel = null;
    }

    async function openFile(filePath) {
        // If already open, just switch
        const existingIdx = tabs.findIndex(t => t.path === filePath);
        if (existingIdx !== -1) {
            activeTabIdx = existingIdx;
            sidebarOpen = false;
            return;
        }
        isLoadingFile = true;
        try {
            const res = await fetch(`/code-editor/file/read?package=${encodeURIComponent(selectedPackage.id)}&path=${encodeURIComponent(filePath)}`);
            const data = await res.json();
            if (res.ok) {
                // mtime rides along on the tab so the save can prove which
                // version of the file it started from.
                tabs = [...tabs, { path: filePath, content: data.content, dirty: false, mtime: data.mtime }];
                activeTabIdx = tabs.length - 1;
                sidebarOpen = false;
                await tick();
            } else {
                // Binary, too large or missing: say so instead of doing nothing.
                saveMessage = data.error || 'Could not open file';
                saveMessageType = 'error';
                setTimeout(() => { saveMessage = ''; }, 3500);
            }
        } catch (e) { console.error(e); }
        isLoadingFile = false;
    }

    // `force` skips the mtime check — only set from the conflict dialog, where
    // the user has explicitly chosen to overwrite the other writer's version.
    async function saveFile(force = false) {
        if (!activeTab || !selectedPackage) return;
        // Show warning on first save attempt for core packages
        if (isCorePackage && !pendingSave) {
            showWarning = true;
            pendingSave = true;
            return;
        }
        pendingSave = false;
        isSaving = true;
        saveMessage = '';
        const savedIdx = activeTabIdx;
        try {
            const res = await fetch('/code-editor/file/write', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    package: selectedPackage.id,
                    path: activeTab.path,
                    content: activeTab.content,
                    baseMtime: force ? null : (activeTab.mtime ?? null),
                })
            });
            const data = await res.json();
            if (res.ok) {
                saveMessage = data.backup ? 'Saved' : 'Created'; saveMessageType = 'success';
                tabs[savedIdx].dirty = false;
                tabs[savedIdx].mtime = data.mtime;
                tabs = [...tabs];
                loadGitStatus(selectedPackage.id); // the file just became "modified"
            } else if (res.status === 409) {
                // Someone else (Agent, another tab, an editor elsewhere) wrote
                // this file after we opened it. Never silently pick a winner.
                conflict = { tabIdx: savedIdx, path: activeTab.path };
            } else {
                saveMessage = data.error || 'Error'; saveMessageType = 'error';
            }
        } catch { saveMessage = 'Network error'; saveMessageType = 'error'; }
        isSaving = false;
        if (saveMessage) setTimeout(() => { saveMessage = ''; }, 2500);
    }

    // ── Conflict resolution ────────────────────────────────────────────────────
    async function reloadFromDisk() {
        const target = conflict;
        conflict = null;
        if (!target || !selectedPackage) return;
        try {
            const res = await fetch(`/code-editor/file/read?package=${encodeURIComponent(selectedPackage.id)}&path=${encodeURIComponent(target.path)}`);
            const data = await res.json();
            if (!res.ok) { saveMessage = data.error || 'Reload failed'; saveMessageType = 'error'; return; }
            tabs[target.tabIdx] = { ...tabs[target.tabIdx], content: data.content, mtime: data.mtime, dirty: false };
            tabs = [...tabs];
            saveMessage = 'Reloaded from disk'; saveMessageType = 'success';
        } catch { saveMessage = 'Network error'; saveMessageType = 'error'; }
        setTimeout(() => { saveMessage = ''; }, 2500);
    }

    function overwriteAnyway() {
        conflict = null;
        saveFile(true);
    }

    function closeTab(idx, e) {
        e?.stopPropagation();
        const tab = tabs[idx];
        // Closing a tab is the one place where edits are silently discarded, so
        // it is also the one place that has to ask.
        if (tab?.dirty && !confirm(`"${shortName(tab.path)}" has unsaved changes. Close anyway?`)) return;
        tabs = tabs.filter((_, i) => i !== idx);
        if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
        else if (activeTabIdx > idx) activeTabIdx--;
    }

    function confirmSave() { showWarning = false; saveFile(); }
    function cancelSave() { showWarning = false; pendingSave = false; }

    // ── Editor input ──────────────────────────────────────────────────────────
    // CodeMirror owns indentation, undo, bracket matching and in-file search;
    // this only mirrors the document back into the tab model.
    function onEditorChange(event) {
        if (!activeTab) return;
        tabs[activeTabIdx].content = event.detail;
        tabs[activeTabIdx].dirty = true;
        tabs = [...tabs];
    }

    function onGlobalKeydown(e) {
        const mod = e.ctrlKey || e.metaKey;
        if (mod && e.shiftKey && e.key.toLowerCase() === 'p') {
            e.preventDefault(); showPalette = true; showSearch = false;
        } else if (mod && e.shiftKey && e.key.toLowerCase() === 'f') {
            e.preventDefault(); showSearch = true; showPalette = false;
        } else if (mod && e.key === 's') {
            // Also bound inside the editor; this covers focus being anywhere else.
            e.preventDefault(); saveFile();
        } else if (mod && (e.key === '=' || e.key === '+')) {
            e.preventDefault(); changeFontSize(1);
        } else if (mod && e.key === '-') {
            e.preventDefault(); changeFontSize(-1);
        } else if (e.key === 'Escape') {
            showSearch = false; showPalette = false; fileAction = null; packageMenuOpen = false;
        }
    }

    // ── Helpers ────────────────────────────────────────────────────────────────
    // One table for both the label and the colour class: a type missing from
    // here used to fall through to `ic-file`, which had no rule at all and
    // rendered an invisible badge.
    const FILE_ICONS = {
        js:    ['js', 'ic-js'],
        mjs:   ['js', 'ic-js'],
        cjs:   ['js', 'ic-js'],
        jsx:   ['jsx', 'ic-js'],
        ts:    ['ts', 'ic-ts'],
        tsx:   ['tsx', 'ic-ts'],
        svelte:['sv', 'ic-sv'],
        json:  ['{}', 'ic-json'],
        md:    ['md', 'ic-md'],
        markdown: ['md', 'ic-md'],
        txt:   ['txt', 'ic-txt'],
        prisma:['db', 'ic-db'],
        sql:   ['sql', 'ic-db'],
        html:  ['ht', 'ic-html'],
        htm:   ['ht', 'ic-html'],
        css:   ['cs', 'ic-css'],
        scss:  ['sc', 'ic-css'],
        yaml:  ['ym', 'ic-yaml'],
        yml:   ['ym', 'ic-yaml'],
        toml:  ['tml', 'ic-yaml'],
        ini:   ['ini', 'ic-yaml'],
        sh:    ['sh', 'ic-sh'],
        bash:  ['sh', 'ic-sh'],
        py:    ['py', 'ic-py'],
    };

    function getFileIcon(ext) {
        return FILE_ICONS[ext]?.[0] ?? '•';
    }

    function getIconClass(ext) {
        return FILE_ICONS[ext]?.[1] ?? 'ic-file';
    }

    function shortName(filePath) {
        return filePath?.split('/').pop() ?? '';
    }

    // Flatten the nested tree into an ordered list for rendering (Svelte
    // templates can't recurse).
    //
    // `expanded` is a parameter and not a closure read of `expandedFolders` on
    // purpose. Svelte derives the dependencies of a template/reactive
    // expression from the identifiers it *mentions*, so with the set read from
    // the closure the rows kept `fileTree` as their only dependency: toggling a
    // folder rebuilt the array but the per-row updates (name, indent, title,
    // icon class) stayed behind their `fileTree` dirty check and never ran.
    // Existing rows kept the old file's text while the extra rows were appended
    // at the bottom — the tree looked like a flat list that grew from the end.
    function renderTree(node, parentPath, depth, expanded) {
        const result = [];
        // Directories first; this matches the deterministic backend ordering.
        const folders = Object.keys(node.children).sort((a, b) => a.localeCompare(b));
        const sortedFiles = [...node.files].sort((a, b) =>
            a.path.split('/').pop().localeCompare(b.path.split('/').pop())
        );

        // Build merged list: folders always appear before files.
        const entries = [
            ...folders.map(name => ({ kind: 'folder', name })),
            ...sortedFiles.map(f => ({ kind: 'file', name: f.path.split('/').pop(), file: f }))
        ];

        for (const entry of entries) {
            if (entry.kind === 'folder') {
                const folderPath = parentPath ? `${parentPath}/${entry.name}` : entry.name;
                const open = expanded.has(folderPath);
                result.push({ key: `d:${folderPath}`, type: 'folder', name: entry.name, path: folderPath, depth, open });
                if (open) {
                    result.push(...renderTree(node.children[entry.name], folderPath, depth + 1, expanded));
                }
            } else {
                result.push({ key: `f:${entry.file.path}`, type: 'file', file: entry.file, name: entry.name, depth });
            }
        }
        return result;
    }

    async function togglePackageMenu() {
        packageMenuOpen = !packageMenuOpen;
        packageQuery = '';
        if (packageMenuOpen) { await tick(); packageSearchInput?.focus(); }
    }

    function choosePackage(id) {
        packageMenuOpen = false;
        selectPackage(id);
    }

    // ── Folder tree ────────────────────────────────────────────────────────────
    // Build a nested tree from the flat, typed entries returned by the backend.
    function buildTree(entries) {
        const root = { children: {}, files: [] };
        for (const entry of entries) {
            const parts = entry.path.split('/');
            let node = root;
            const last = entry.type === 'directory' ? parts.length : parts.length - 1;
            for (let i = 0; i < last; i++) {
                const seg = parts[i];
                if (!node.children[seg]) node.children[seg] = { children: {}, files: [] };
                node = node.children[seg];
            }
            if (entry.type === 'file') node.files.push(entry);
        }
        return root;
    }

    function toggleFolder(folderPath) {
        const next = new Set(expandedFolders);
        if (next.has(folderPath)) next.delete(folderPath);
        else next.add(folderPath);
        expandedFolders = next;
    }

    async function runSearch() {
        if (!searchQuery.trim() || !selectedPackage) return;
        searching = true;
        try {
            const res = await fetch(`/code-editor/search?package=${encodeURIComponent(selectedPackage.id)}&q=${encodeURIComponent(searchQuery)}`);
            searchResults = res.ok ? (await res.json()).results : [];
        } catch { searchResults = []; }
        searching = false;
    }

    async function openSearchResult(result) {
        await openFile(result.path);
        showSearch = false;
        await tick();
        editorRef?.goToLine(result.line);
    }

    async function beginFileAction(mode, type, path = '') {
        fileAction = { mode, type, path };
        fileActionValue = mode === 'rename' ? path.split('/').pop() : '';
        fileActionError = '';
        await tick();
        fileActionInput?.focus();
    }

    async function submitFileAction() {
        if (!fileAction || !fileActionValue.trim() || !selectedPackage || fileActionBusy) return;
        const action = fileAction;
        const packageId = selectedPackage.id;
        fileActionBusy = true;
        const parent = fileAction.mode === 'rename' ? fileAction.path.split('/').slice(0, -1).join('/') : '';
        const destination = parent ? `${parent}/${fileActionValue.trim()}` : fileActionValue.trim();
        const endpoint = fileAction.mode === 'rename' ? '/code-editor/file/rename' : '/code-editor/file/create';
        const body = fileAction.mode === 'rename'
            ? { package: selectedPackage.id, from: fileAction.path, to: destination }
            : { package: selectedPackage.id, path: destination, type: fileAction.type };
        try {
            const res = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            const data = await res.json();
            if (!res.ok || data.error) { fileActionError = data.error || 'Action failed'; return; }
            if (selectedPackageId !== packageId) return;
            if (action.mode === 'rename') tabs = tabs.map(tab => tab.path === action.path || tab.path.startsWith(`${action.path}/`) ? { ...tab, path: destination + tab.path.slice(action.path.length) } : tab);
            const createdFile = action.mode === 'create' && action.type === 'file' ? destination : null;
            if (fileAction === action) fileAction = null;
            const parents = destination.split('/').slice(0, -1);
            expandedFolders = new Set([...expandedFolders, ...parents.map((_, i) => parents.slice(0, i + 1).join('/'))]);
            await loadFiles(packageId);
            if (createdFile && selectedPackageId === packageId) await openFile(createdFile);
        } catch { fileActionError = 'Network error'; } finally { fileActionBusy = false; }
    }

    async function deleteEntry(entryPath) {
        if (!selectedPackage || !entryPath) return;
        if (!confirm(`Delete "${entryPath}"? This cannot be undone.`)) return;
        try {
            const res = await fetch('/code-editor/file/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ package: selectedPackage.id, path: entryPath })
            });
            const data = await res.json();
            if (!res.ok || data.error) {
                saveMessage = data.error || 'Delete failed'; saveMessageType = 'error';
                setTimeout(() => { saveMessage = ''; }, 2500);
                return;
            }
            // Close any tab that pointed at the deleted entry (or lived under it).
            tabs = tabs.filter(tab => tab.path !== entryPath && !tab.path.startsWith(`${entryPath}/`));
            if (activeTabIdx >= tabs.length) activeTabIdx = tabs.length - 1;
            await loadFiles(selectedPackage.id);
        } catch { saveMessage = 'Network error'; saveMessageType = 'error'; }
    }

    function executePalette(action) {
        showPalette = false;
        if (action === 'search') showSearch = true;
        if (action === 'terminal') { showTerminal = !showTerminal; saveEnvironment(); }
        if (action === 'new-file') beginFileAction('create', 'file');
        if (action === 'new-folder') beginFileAction('create', 'directory');
        if (action === 'rename' && activeTab) beginFileAction('rename', 'file', activeTab.path);
        if (action === 'delete' && activeTab) deleteEntry(activeTab.path);
        if (action === 'diff' && activeTab) openDiff(activeTab.path);
        if (action === 'git-refresh' && selectedPackage) loadGitStatus(selectedPackage.id);
    }

    // ── Tab label disambiguation ───────────────────────────────────────────────
    // If two open tabs share the same filename, show "parent/file.ext" instead
    function tabLabel(tab) {
        const name = shortName(tab.path);
        const siblings = tabs.filter(t => shortName(t.path) === name && t.path !== tab.path);
        if (siblings.length === 0) return name;
        // Show one parent segment for disambiguation
        const parts = tab.path.split('/');
        return parts.length >= 2 ? `${parts[parts.length - 2]}/${name}` : name;
    }

    // Debounced so that typing into a buffer doesn't serialise every keystroke
    // to localStorage, while still surviving a crash or an accidental reload.
    let persistTimer;
    function schedulePersist() {
        if (typeof window === 'undefined') return;
        clearTimeout(persistTimer);
        persistTimer = setTimeout(persistSession, 500);
    }
    $: tabs, activeTabIdx, expandedFolders, showTerminal, selectedPackageId, editorFontSize, schedulePersist();

    $: fileTree = buildTree(files);
    // Both dependencies are named here so the rows are rebuilt on expand/collapse
    // as well as on a package switch.
    $: treeRows = renderTree(fileTree, '', 0, expandedFolders);

    let editorFontSize = 13; // px, clamped 10–24
    const FONT_MIN = 10, FONT_MAX = 24;
    function changeFontSize(delta) {
        editorFontSize = Math.min(FONT_MAX, Math.max(FONT_MIN, editorFontSize + delta));
    }
    function onEditorWheel(e) {
        if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            changeFontSize(e.deltaY < 0 ? 1 : -1);
        }
    }
</script>

<!-- The runtime concatenates this component's CSS after its own `body {…}` rule,
     and a misplaced @import is dropped by the parser — the whole UI silently
     fell back to system fonts. A <link> in the head is not order-sensitive. -->
<svelte:head>
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
    <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Ubuntu:ital,wght@0,300;0,400;0,500;0,700;1,400&family=Ubuntu+Mono:ital,wght@0,400;0,700;1,400&display=swap" />
</svelte:head>

<!-- ── Markup ──────────────────────────────────────────────────────────────── -->
<div class="vsc" data-theme={theme}>

    <!-- Activity bar (left, desktop) -->
    <aside class="activitybar" aria-label="Activity bar">
        <button class="ab-btn" class:active={!showSearch} title="Explorer" on:click={() => { showSearch = false; sidebarOpen = !sidebarOpen; }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/></svg>
        </button>
        <button class="ab-btn" class:active={showSearch} title="Search (Ctrl+Shift+F)" aria-label="Open package search" on:click={() => { showSearch = true; showPalette = false; }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"><circle cx="11" cy="11" r="7"/><line x1="16.5" y1="16.5" x2="22" y2="22"/></svg>
        </button>
    </aside>

    <!-- Sidebar (file tree) -->
    <div class="sidebar {sidebarOpen ? 'open' : ''}" aria-label="File explorer">
        <div class="sidebar-pkg">
            <span class="sidebar-section">PACKAGE</span>
            <div class="package-picker">
                <button class="pkg-select" type="button" aria-label="Select package" aria-haspopup="listbox" aria-expanded={packageMenuOpen} disabled={isLoadingPackages} on:click={togglePackageMenu}>
                    <span>{selectedPackage ? `${selectedPackage.declaredName || selectedPackage.name} (${selectedPackage.id})` : 'Select package'}</span><span aria-hidden="true">⌄</span>
                </button>
                {#if packageMenuOpen}
                    <div class="package-menu" on:focusout={(event) => { if (!event.currentTarget.parentNode.contains(event.relatedTarget)) packageMenuOpen = false; }}>
                        <input bind:this={packageSearchInput} bind:value={packageQuery} aria-label="Search packages" placeholder="Search packages" on:keydown={(event) => { if (event.key === 'Enter' && filteredPackages.length) { event.preventDefault(); choosePackage(filteredPackages[0].id); } }} />
                        <div class="package-options" role="listbox" aria-label="Packages">
                            {#each filteredPackages as pkg (pkg.id)}
                                <button type="button" role="option" aria-selected={pkg.id === selectedPackageId} on:click={() => choosePackage(pkg.id)}>
                                    <span class="package-option-name">{pkg.declaredName || pkg.name} <span class="package-option-id">({pkg.id})</span></span>
                                    {#if pkg.description}<span class="package-option-description">{pkg.description}</span>{/if}
                                </button>
                            {:else}<div class="tree-msg">No packages found</div>{/each}
                        </div>
                    </div>
                {/if}
            </div>
        </div>

        <div class="sidebar-section-label">
            EXPLORER
            {#if isCorePackage}<span class="core-badge">CORE</span>{/if}
            <span class="explorer-actions">
                <button title="New file" aria-label="New file" disabled={!selectedPackage} on:click={() => beginFileAction('create', 'file')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M13 3H5v18h14v-9M13 3v6h6M13 3l6 6M16 16h6m-3-3v6"/></svg></button>
                <button title="New folder" aria-label="New folder" disabled={!selectedPackage} on:click={() => beginFileAction('create', 'directory')}><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M3 19V5h6l2 2h9v5M3 19h10m3-3h6m-3-3v6"/></svg></button>
            </span>
        </div>

        {#if fileAction}
            <form class="file-action" on:submit|preventDefault={submitFileAction}>
                <label for="file-action-input">{fileAction.mode === 'rename' ? `Rename ${fileAction.path}` : fileAction.type === 'file' ? 'New file path' : 'New folder path'}</label>
                <div><input id="file-action-input" bind:this={fileActionInput} bind:value={fileActionValue} placeholder={fileAction.mode === 'rename' ? 'New name' : 'Path in package'} /><button type="submit" disabled={fileActionBusy || !fileActionValue.trim()}>{fileActionBusy ? '…' : 'Save'}</button><button type="button" on:click={() => fileAction = null} aria-label="Cancel">×</button></div>
                {#if fileActionError}<p role="alert">{fileActionError}</p>{/if}
            </form>
        {/if}
        <div class="file-tree" role="tree">
            {#if isLoadingFiles}
                <div class="tree-msg">Loading…</div>
            {:else if files.length === 0}
                <div class="tree-msg">No files</div>
            {:else}
                {#each treeRows as node (node.key)}
                    {#if node.type === 'folder'}
                        <button
                            class="tree-item tree-folder"
                            class:expanded={node.open}
                            role="treeitem"
                            aria-expanded={node.open}
                            aria-selected="false"
                            on:click={() => toggleFolder(node.path)}
                            on:contextmenu|preventDefault={() => beginFileAction('rename', 'directory', node.path)}
                            title={node.path}
                        >
                            {#each { length: node.depth } as _}
                                <span class="indent-guide" aria-hidden="true"></span>
                            {/each}
                            <span class="folder-arrow" class:open={node.open} aria-hidden="true">
                                <svg viewBox="0 0 16 16" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 3 11 8 6 13"/></svg>
                            </span>
                            <span class="tree-icon ic-folder" aria-hidden="true">
                                {#if node.open}
                                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.5 3a1 1 0 011-1h3.172a1 1 0 01.707.293L7.086 3H12.5a1 1 0 011 1v1h-10a1 1 0 00-.97.757L1.5 11V3z"/><path d="M3.53 6.757A1 1 0 014.5 6h10.2a.8.8 0 01.776.994l-1.25 5A1 1 0 0113.256 13H1.9a.4.4 0 01-.388-.497l2.018-5.746z"/></svg>
                                {:else}
                                    <svg viewBox="0 0 16 16" width="14" height="14" fill="currentColor"><path d="M1.5 3a1 1 0 011-1h3.172a1 1 0 01.707.293L7.086 3H13.5a1 1 0 011 1v8a1 1 0 01-1 1h-12a1 1 0 01-1-1V3z"/></svg>
                                {/if}
                            </span>
                            <span class="tree-name">{node.name}</span>
                        </button>
                    {:else}
                        <button
                            class="tree-item {selectedFile === node.file.path ? 'active' : ''}"
                            role="treeitem"
                            aria-selected={selectedFile === node.file.path}
                            on:click={() => openFile(node.file.path)}
                            on:contextmenu|preventDefault={() => beginFileAction('rename', 'file', node.file.path)}
                            title={node.file.path}
                        >
                            {#each { length: node.depth } as _}
                                <span class="indent-guide" aria-hidden="true"></span>
                            {/each}
                            <span class="folder-arrow spacer" aria-hidden="true"></span>
                            <span class="tree-icon {getIconClass(node.file.ext ?? extOf(node.file.path))}" aria-hidden="true">{getFileIcon(node.file.ext ?? extOf(node.file.path))}</span>
                            <span class="tree-name" class:git-changed={gitStatus[node.file.path]}>{node.name}</span>
                            {#if gitStatus[node.file.path]}
                                <span class="git-badge git-{gitStatus[node.file.path]}" title="git: {gitStatus[node.file.path]}">
                                    {GIT_BADGE[gitStatus[node.file.path]] ?? 'M'}
                                </span>
                            {/if}
                        </button>
                    {/if}
                {/each}
            {/if}
        </div>
    </div>

    <!-- Sidebar backdrop (mobile) -->
    {#if sidebarOpen}
        <div class="sidebar-backdrop" on:click={() => sidebarOpen = false} aria-hidden="true"></div>
    {/if}

    <!-- Main editor area -->
    <div class="editor-main">

        <!-- Mobile top bar -->
        <div class="mobile-topbar">
            <button class="topbar-btn" on:click={() => sidebarOpen = !sidebarOpen} aria-label="Toggle sidebar">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/></svg>
            </button>
            <span class="topbar-title">{selectedPackage?.name ?? 'Code Editor'}</span>
            <div class="topbar-right">
                {#if saveMessage}<span class="save-badge {saveMessageType}">{saveMessage}</span>{/if}
                <button class="save-btn" on:click={() => saveFile()} disabled={isSaving || !activeTab}>
                    {isSaving ? '…' : 'Save'}
                </button>
            </div>
        </div>

        <!-- Tab bar -->
        <div class="tabbar" role="tablist">
            <!-- A div, not a button: the close control is itself a <button>, and
                 a button nested inside a button is invalid HTML that browsers
                 recover from inconsistently. -->
            {#each tabs as tab, i}
                {@const ext = extOf(tab.path)}
                <div
                    class="tab {activeTabIdx === i ? 'active' : ''}"
                    role="tab"
                    tabindex="0"
                    aria-selected={activeTabIdx === i}
                    on:click={() => activeTabIdx = i}
                    on:keydown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activeTabIdx = i; } }}
                    on:auxclick={(e) => { if (e.button === 1) closeTab(i, e); }}
                    title={tab.path}
                >
                    <span class="tab-icon {getIconClass(ext)}" aria-hidden="true">{getFileIcon(ext)}</span>
                    <span class="tab-name">{tabLabel(tab)}</span>
                    {#if tab.dirty}<span class="tab-dot" aria-label="unsaved"></span>{/if}
                    <button class="tab-close" on:click={(e) => closeTab(i, e)} aria-label="Close tab">×</button>
                </div>
            {/each}
        </div>

        <!-- Desktop save bar (above editor) -->
        <div class="desktop-savebar">
            {#if activeTab}<span class="breadcrumb">{selectedPackage?.name} / {activeTab.path}</span>{/if}
            <div class="savebar-right">
                <button class="save-btn" on:click={() => showPalette = true} title="Command Palette (Ctrl+Shift+P)">Commands</button>
                <button class="save-btn" on:click={() => { showTerminal = !showTerminal; saveEnvironment(); }} title="Toggle terminal">Terminal</button>
                {#if saveMessage}<span class="save-badge {saveMessageType}">{saveMessage}</span>{/if}
                <button class="save-btn" on:click={() => saveFile()} disabled={isSaving || !activeTab} title="Save (⌘S / Ctrl+S)">
                    {isSaving ? 'Saving…' : 'Save'}
                </button>
            </div>
        </div>

        <!-- Code editor -->
        <div class="editor-wrap" on:wheel={onEditorWheel} style="--editor-fs: {editorFontSize}px">
            {#if !activeTab}
                <div class="empty-state">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" width="48" height="48" opacity=".25"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                    <p>Open a file from the explorer</p>
                </div>
            {:else if isLoadingFile}
                <div class="empty-state"><p>Loading…</p></div>
            {:else}
                <Editor
                    bind:this={editorRef}
                    value={fileContent}
                    path={activeTab.path}
                    {theme}
                    fontSize={editorFontSize}
                    on:change={onEditorChange}
                    on:save={() => saveFile()}
                />
            {/if}
        </div>

        <!-- AI result panel. 'replace' results are never applied automatically:
             the model's rewrite lands only when the user says so. -->
        {#if aiPanel}
            <div class="ai-panel">
                <div class="ai-title">
                    AGENT · {aiPanel.label}
                    {#if aiPanel.model}<span class="ai-model">{aiPanel.model}</span>{/if}
                    <button class="ai-close" on:click={() => aiPanel = null} aria-label="Close">×</button>
                </div>
                <div class="ai-body">
                    {#if aiPanel.status === 'running'}
                        <p class="ai-muted">Thinking…</p>
                    {:else if aiPanel.status === 'error'}
                        <p class="modal-warn">{aiPanel.error}</p>
                    {:else}
                        <pre class="ai-text">{aiPanel.text}</pre>
                    {/if}
                </div>
                {#if aiPanel.status === 'done' && aiPanel.mode === 'replace'}
                    <div class="ai-actions">
                        <button class="btn-cancel" on:click={() => aiPanel = null}>Discard</button>
                        <button class="btn-confirm" on:click={applyAiResult}>Replace selection</button>
                    </div>
                {/if}
            </div>
        {/if}

        {#if showTerminal}
            <div class="terminal-panel">
                <div class="terminal-title">TERMINAL · {selectedPackage?.name}<button on:click={() => { showTerminal = false; saveEnvironment(); }}>×</button></div>
                <iframe title="Terminal" src="/view/terminal/Index"></iframe>
            </div>
        {/if}

        <!-- Status bar -->
        <div class="statusbar">
            {#if activeTab}
                <span>{langLabel(activeTab.path).toUpperCase()}</span>
                <span>{activeTab.dirty ? '● Modified' : 'Saved'}</span>
            {:else}
                <span>Ready</span>
            {/if}
            <span class="statusbar-right">
                <button class="fs-btn" on:click={() => changeFontSize(-1)} disabled={editorFontSize <= FONT_MIN} title="Decrease font size (Ctrl+-)">A−</button>
                <span class="fs-label">{editorFontSize}px</span>
                <button class="fs-btn" on:click={() => changeFontSize(1)} disabled={editorFontSize >= FONT_MAX} title="Increase font size (Ctrl+=)">A+</button>
            </span>
        </div>
    </div>

    <!-- Modals stay *inside* .vsc on purpose: every --vsc-* / --tk-* token is
         declared on that element, so a modal mounted as a sibling resolved each
         var() to nothing — transparent panel over the backdrop, transparent
         input, inherited text colour. It rendered, it just wasn't visible. -->
    {#if showSearch || showPalette}
        <div class="modal-bg" on:click={() => { showSearch = false; showPalette = false; fileAction = null; }} role="dialog" aria-modal="true">
            <div class="modal command-modal" on:click|stopPropagation>
                {#if showSearch}
                    <h2>Search in {selectedPackage?.name}</h2>
                    <form on:submit|preventDefault={runSearch}><input class="command-input" bind:value={searchQuery} placeholder="Text to find" autofocus /><button class="btn-confirm" aria-label="Run package search">Search</button></form>
                    <div class="search-results">{#if searching}Searching…{:else}{#each searchResults as result}<button on:click={() => openSearchResult(result)}><b>{result.path}:{result.line}</b> {result.text}</button>{/each}{/if}</div>
                {:else if showPalette}
                    <h2>Command Palette</h2>
                    <div class="palette-actions">
                        <button on:click={() => executePalette('search')}>Search in package</button>
                        <button on:click={() => executePalette('new-file')}>New file</button>
                        <button on:click={() => executePalette('new-folder')}>New folder</button>
                        <button disabled={!activeTab} on:click={() => executePalette('rename')}>Rename active file</button>
                        <button disabled={!activeTab} on:click={() => executePalette('delete')}>Delete active file</button>
                        <button on:click={() => executePalette('terminal')}>{showTerminal ? 'Hide' : 'Show'} terminal</button>
                        {#if gitAvailable}
                            <div class="palette-group">Git</div>
                            <button disabled={!activeTab} on:click={() => executePalette('diff')}>Diff active file</button>
                            <button on:click={() => executePalette('git-refresh')}>Refresh git status</button>
                        {/if}
                        {#if aiActions.length}
                            <div class="palette-group">Agent — acts on the current selection</div>
                            {#each aiActions as action}
                                <button disabled={!activeTab} on:click={() => { showPalette = false; runAiAction(action); }}>
                                    {action.label}{action.mode === 'replace' ? ' (rewrites selection)' : ''}
                                </button>
                            {/each}
                        {/if}
                    </div>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Diff modal -->
    {#if showDiff}
        <div class="modal-bg" on:click={() => showDiff = null} role="dialog" aria-modal="true">
            <div class="modal command-modal diff-modal" on:click|stopPropagation>
                <h2>Diff — {showDiff.path}</h2>
                {#if showDiff.untracked}
                    <p>This file is not tracked by git yet, so there is nothing to compare against.</p>
                {:else if !showDiff.diff}
                    <p>No changes against HEAD.</p>
                {:else}
                    <pre class="diff-body">{#each showDiff.diff.split('\n') as line}<span
                        class="diff-line"
                        class:diff-add={line.startsWith('+') && !line.startsWith('+++')}
                        class:diff-del={line.startsWith('-') && !line.startsWith('---')}
                        class:diff-hunk={line.startsWith('@@')}
                        class:diff-meta={line.startsWith('diff ') || line.startsWith('index ') || line.startsWith('+++') || line.startsWith('---')}
                    >{line}
</span>{/each}</pre>
                {/if}
            </div>
        </div>
    {/if}

    <!-- Conflict modal: the file changed on disk after we opened it. Both
         options are destructive in one direction, so neither is the default. -->
    {#if conflict}
        <div class="modal-bg" role="dialog" aria-modal="true">
            <div class="modal">
                <div class="modal-icon">⚠️</div>
                <h2>File changed on disk</h2>
                <p><strong>{conflict.path}</strong> was modified by something else after you opened it — Agent, another tab, or an editor outside Thinkiac.</p>
                <p class="modal-warn">Whichever you pick, the other version is lost. A copy of the version on disk is kept in .backups/ if you overwrite.</p>
                <div class="modal-btns">
                    <button class="btn-cancel" on:click={reloadFromDisk}>Discard mine, reload</button>
                    <button class="btn-confirm" on:click={overwriteAnyway}>Overwrite disk</button>
                </div>
            </div>
        </div>
    {/if}

    <!-- Warning modal -->
    {#if showWarning}
        <div class="modal-bg" on:click={cancelSave} role="dialog" aria-modal="true">
            <div class="modal" on:click|stopPropagation>
                <div class="modal-icon">⚠️</div>
                <h2>Core Package</h2>
                <p>You're about to save changes to <strong>{selectedPackage?.name}</strong>, a core system package.</p>
                <p class="modal-warn">Changes can break the entire Agent system.</p>
                <div class="modal-btns">
                    <button class="btn-cancel" on:click={cancelSave}>Cancel</button>
                    <button class="btn-confirm" on:click={confirmSave}>Save anyway</button>
                </div>
            </div>
        </div>
    {/if}
</div>

<!-- ── Styles ──────────────────────────────────────────────────────────────── -->
<style>
    /* Ubuntu / Ubuntu Mono are loaded via <svelte:head>, not @import — see the
       note above the markup. */

    /* ── Tokens ── */
    .vsc[data-theme="dark"] {
        --tk-bg: #111111; --tk-surface: #181818; --tk-surface-2: #1f1f1f; --tk-border: rgba(255,255,255,.09); --tk-border-hi: rgba(255,255,255,.16); --tk-text: #f5f5f5; --tk-muted: #888888; --tk-muted-2: rgba(136,136,136,.5); --tk-accent: #f5f5f5; --tk-on-accent: #111111; --tk-radius-md: 8px; --tk-radius-lg: 14px; --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
    }
    .vsc[data-theme="light"] {
        --tk-bg: #ffffff; --tk-surface: #f5f5f5; --tk-surface-2: #ececec; --tk-border: rgba(0,0,0,.10); --tk-border-hi: rgba(0,0,0,.18); --tk-text: #1a1a1a; --tk-muted: #666666; --tk-muted-2: rgba(0,0,0,.4); --tk-accent: #111111; --tk-on-accent: #ffffff; --tk-radius-md: 8px; --tk-radius-lg: 14px; --tk-font: 'Ubuntu', system-ui, sans-serif; --tk-mono: 'Ubuntu Mono', monospace;
    }
    .vsc {
        --vsc-bg: var(--tk-bg);
        --vsc-surface: var(--tk-surface);
        --vsc-surface2: var(--tk-surface-2);
        --vsc-border: var(--tk-border);
        --vsc-text: var(--tk-text);
        --vsc-muted: var(--tk-muted);
        --vsc-accent: var(--tk-accent);
        --vsc-accent2: var(--tk-surface-2);
        --vsc-tab-active: var(--tk-bg);
        --vsc-tab-inactive: var(--tk-surface-2);
        --vsc-ab: var(--tk-surface);
        --vsc-status: var(--tk-accent);
        --vsc-status-text: var(--tk-on-accent);
        /* Syntax */
        --hl-comment: #6a9955;
        --hl-string: #ce9178;
        --hl-number: #b5cea8;
        --hl-keyword: #569cd6;
        --hl-key: #9cdcfe;
        --hl-property: #9cdcfe;
        --hl-op: #d4d4d4;
    }

    /* ── Layout ── */
    .vsc {
        display: flex;
        height: 100dvh;
        background: var(--vsc-bg);
        color: var(--vsc-text);
        font-family: 'Ubuntu Mono', 'Consolas', 'Menlo', 'Monaco', monospace;
        overflow: hidden;
    }

    /* ── Activity bar ── */
    .activitybar {
        width: 48px;
        min-width: 48px;
        background: var(--vsc-ab);
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 8px;
        gap: 4px;
        border-right: 1px solid var(--vsc-border);
    }
    .ab-btn {
        width: 36px;
        height: 36px;
        border-radius: 4px;
        background: transparent;
        border: none;
        color: var(--vsc-muted);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color .12s;
        padding: 6px;
    }
    .ab-btn:hover, .ab-btn.active { color: var(--vsc-text); }
    .ab-btn.active { border-left: 2px solid var(--vsc-accent); }
    .ab-btn svg { width: 20px; height: 20px; }

    /* ── Sidebar ── */
    .sidebar {
        width: 240px;
        min-width: 240px;
        background: var(--vsc-surface);
        display: flex;
        flex-direction: column;
        border-right: 1px solid var(--vsc-border);
        overflow: hidden;
        transition: transform .2s ease;
    }
    .sidebar-pkg {
        padding: 8px 12px;
        border-bottom: 1px solid var(--vsc-border);
    }
    .sidebar-section {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: .1em;
        color: var(--vsc-muted);
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .sidebar-section-label {
        font-size: 11px;
        font-weight: 700;
        letter-spacing: .08em;
        color: var(--vsc-muted);
        padding: 8px 12px 4px;
        display: flex;
        align-items: center;
        gap: 6px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        text-transform: uppercase;
    }
    .explorer-actions { margin-left: auto; display: flex; gap: 4px; }
    .explorer-actions button { border: 0; background: transparent; color: var(--vsc-muted); cursor: pointer; padding: 1px 3px; font-family: var(--tk-font); }
    .explorer-actions button:hover { color: var(--vsc-text); }
    .explorer-actions svg { display: block; width: 16px; height: 16px; }
    .file-action { padding: 6px 12px; }
    .file-action label { display: block; color: var(--vsc-muted); font-size: 11px; margin-bottom: 4px; overflow-wrap: anywhere; }
    .file-action div { display: flex; gap: 4px; }
    .file-action input, .package-menu input { min-width: 0; width: 100%; box-sizing: border-box; background: var(--vsc-bg); color: var(--vsc-text); border: 1px solid var(--vsc-border); border-radius: 4px; padding: 6px; font: 12px var(--tk-font); }
    .file-action button { border: 1px solid var(--vsc-border); background: var(--vsc-surface2); color: var(--vsc-text); border-radius: 4px; cursor: pointer; }
    .file-action p { color: var(--vsc-text); font-size: 11px; overflow-wrap: anywhere; }
    .package-picker { position: relative; }
    .pkg-select { display: flex; justify-content: space-between; gap: 8px; text-align: left; }
    .pkg-select span:first-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .package-menu { position: absolute; z-index: 20; top: 100%; left: 0; right: 0; padding: 6px; background: var(--vsc-surface2); border: 1px solid var(--vsc-border); border-radius: 4px; }
    .package-options { max-height: 220px; overflow-y: auto; margin-top: 4px; }
    .package-options button { display: block; width: 100%; padding: 6px; text-align: left; border: 0; border-radius: 3px; background: transparent; color: var(--vsc-text); font: 12px var(--tk-font); cursor: pointer; }
    .package-option-name, .package-option-description { display: block; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .package-option-id, .package-option-description { color: var(--vsc-muted); }
    .package-option-description { margin-top: 2px; font-size: 11px; }
    .package-options button:hover, .package-options button:focus, .package-options button[aria-selected="true"] { background: var(--vsc-accent2); }
    .core-badge {
        font-size: 9px;
        background: #c53030;
        color: #fff;
        padding: 1px 5px;
        border-radius: 3px;
        letter-spacing: .05em;
    }
    .pkg-select {
        width: 100%;
        margin-top: 4px;
        background: var(--vsc-surface2);
        border: 1px solid var(--vsc-border);
        border-radius: 3px;
        color: var(--vsc-text);
        font-size: 12px;
        padding: 4px 6px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        cursor: pointer;
    }
    .file-tree {
        flex: 1;
        overflow-y: auto;
        padding: 4px 0;
    }
    .file-tree::-webkit-scrollbar { width: 4px; }
    .file-tree::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); border-radius: 2px; }
    .tree-msg {
        font-size: 12px;
        color: var(--vsc-muted);
        padding: 12px 16px;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .tree-item {
        display: flex;
        align-items: center;
        gap: 6px;
        width: 100%;
        padding: 3px 12px;
        background: transparent;
        border: none;
        color: var(--vsc-text);
        cursor: pointer;
        font-size: 13px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        text-align: left;
        white-space: nowrap;
        overflow: hidden;
    }
    .tree-item:hover { background: rgba(255,255,255,.05); }
    .tree-item.active { background: var(--vsc-accent2); }
    .tree-icon {
        font-size: 10px;
        font-weight: 700;
        min-width: 20px;
        text-align: center;
        border-radius: 2px;
        padding: 1px 3px;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .ic-js  { background:#f0db4f; color:#000; }
    .ic-ts  { background:#3178c6; color:#fff; }
    .ic-sv  { background:#ff3e00; color:#fff; }
    .ic-json{ background:#44475a; color:#f1fa8c; }
    .ic-md  { background:#555; color:#aaa; }
    .ic-css { background:#264de4; color:#fff; }
    .ic-html{ background:#e34c26; color:#fff; }
    .ic-yaml{ background:#cb171e; color:#fff; }
    .ic-db  { background:#336791; color:#fff; }
    .ic-txt { background:#3a3a3a; color:#d0d0d0; }
    .ic-sh  { background:#4d4d4d; color:#89e051; }
    .ic-py  { background:#3572a5; color:#ffd43b; }
    /* Fallback for anything not in FILE_ICONS. Without a rule of its own this
       badge was a blank, unstyled box — the "missing icon". */
    .ic-file { background: var(--vsc-surface2); color: var(--vsc-muted); }
    /* Git badges: the letter carries the meaning, the colour only reinforces
       it, so this still reads without colour perception. */
    .git-badge {
        margin-left: auto;
        flex-shrink: 0;
        font-size: 10px;
        font-weight: 700;
        font-family: 'Ubuntu', system-ui, sans-serif;
        padding-left: 6px;
    }
    .git-modified, .git-renamed, .git-copied { color: #e2b341; }
    .git-added { color: #4ade80; }
    .git-deleted { color: #f87171; }
    .git-untracked { color: #6b9fd4; }
    .git-conflict { color: #f87171; }
    .tree-name.git-changed { color: #e2b341; }

    .tree-folder { color: var(--vsc-muted); }
    .tree-folder:hover, .tree-folder.expanded { color: var(--vsc-text); }
    .folder-arrow {
        display: flex;
        align-items: center;
        justify-content: center;
        width: 12px;
        min-width: 12px;
        height: 16px;
        transition: transform .12s ease;
        transform: rotate(0deg);
        color: var(--vsc-muted);
        flex-shrink: 0;
    }
    .folder-arrow.open { transform: rotate(90deg); }
    /* Files have no chevron but must line up with the folders above them. */
    .folder-arrow.spacer { transition: none; }
    .ic-folder { background: transparent; color: #dcb862; padding: 0; min-width: 16px; }
    .ic-folder svg { display: block; }
    .tree-name { overflow: hidden; text-overflow: ellipsis; font-size: 13px; }
    /* One guide per nesting level: the indent reads as layers instead of the
       rows all sitting flush at the same margin. */
    .indent-guide {
        /* 8px + the 6px flex gap of .tree-item = the 14px step per level. */
        flex: 0 0 8px;
        width: 8px;
        align-self: stretch;
        border-left: 1px solid var(--vsc-border);
    }

    /* Mobile sidebar backdrop */
    .sidebar-backdrop {
        display: none;
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.5);
        z-index: 10;
    }

    /* ── Editor main ── */
    .editor-main {
        flex: 1;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        min-width: 0;
    }

    /* Mobile topbar — hidden on desktop */
    .mobile-topbar {
        display: none;
        align-items: center;
        gap: 8px;
        padding: 0 10px;
        height: 44px;
        background: var(--vsc-surface);
        border-bottom: 1px solid var(--vsc-border);
        flex-shrink: 0;
    }
    .topbar-btn {
        background: transparent;
        border: none;
        color: var(--vsc-muted);
        cursor: pointer;
        padding: 6px;
        display: flex;
    }
    .topbar-title {
        flex: 1;
        font-size: 13px;
        font-weight: 500;
        font-family: 'Ubuntu', system-ui, sans-serif;
        color: var(--vsc-text);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .topbar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    /* Desktop save bar — hidden on mobile */
    .desktop-savebar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 4px 12px;
        background: var(--vsc-surface);
        border-bottom: 1px solid var(--vsc-border);
        flex-shrink: 0;
        min-height: 30px;
    }
    .breadcrumb {
        font-size: 12px;
        color: var(--vsc-muted);
        font-family: 'Ubuntu', system-ui, sans-serif;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .savebar-right {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
    }

    /* ── Tab bar ── */
    .tabbar {
        display: flex;
        overflow-x: auto;
        background: var(--vsc-surface2);
        flex-shrink: 0;
        border-bottom: 1px solid var(--vsc-border);
    }
    .tabbar::-webkit-scrollbar { height: 2px; }
    .tabbar::-webkit-scrollbar-thumb { background: rgba(255,255,255,.1); }
    .tab {
        display: flex;
        align-items: center;
        gap: 5px;
        padding: 0 8px 0 10px;
        height: 35px;
        background: var(--vsc-tab-inactive);
        border: none;
        border-right: 1px solid var(--vsc-border);
        color: var(--vsc-muted);
        cursor: pointer;
        white-space: nowrap;
        font-size: 13px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        transition: color .1s, background .1s;
        position: relative;
    }
    .tab:hover { color: var(--vsc-text); background: var(--vsc-surface); }
    .tab.active {
        background: var(--vsc-tab-active);
        color: var(--vsc-text);
        border-top: 1px solid var(--vsc-accent);
    }
    .tab-icon {
        font-size: 9px;
        font-weight: 700;
        min-width: 18px;
        text-align: center;
        border-radius: 2px;
        padding: 1px 3px;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .tab-name { max-width: 120px; overflow: hidden; text-overflow: ellipsis; }
    .tab-dot {
        width: 6px;
        height: 6px;
        border-radius: 50%;
        background: var(--vsc-text);
        display: inline-block;
        margin: 0 2px;
    }
    .tab-close {
        background: transparent;
        border: none;
        color: inherit;
        cursor: pointer;
        padding: 0 2px;
        font-size: 16px;
        line-height: 1;
        opacity: 0;
        transition: opacity .1s;
        display: flex;
        align-items: center;
    }
    .tab:hover .tab-close, .tab.active .tab-close { opacity: .7; }
    .tab-close:hover { opacity: 1 !important; }

    /* ── Editor area ── */
    .editor-wrap {
        flex: 1;
        display: flex;
        overflow: hidden;
        position: relative;
        background: var(--vsc-bg);
    }
    /* Line numbers, the highlight layer and the textarea are all CodeMirror's
       responsibility now; their styling lives in lib/editor-setup.js. */

    .empty-state {
        flex: 1;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 12px;
        color: var(--vsc-muted);
        font-family: 'Ubuntu', system-ui, sans-serif;
        font-size: 13px;
    }
    .empty-state p { margin: 0; }

    /* ── Status bar ── */
    .statusbar {
        display: flex;
        align-items: center;
        gap: 16px;
        padding: 0 12px;
        height: 22px;
        background: var(--vsc-status);
        color: var(--vsc-status-text);
        font-size: 11px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        flex-shrink: 0;
    }
    /* ── AI panel ── */
    .ai-panel {
        height: min(40dvh, 360px);
        min-height: 160px;
        border-top: 1px solid var(--vsc-border);
        background: var(--vsc-surface);
        display: flex;
        flex-direction: column;
        flex-shrink: 0;
    }
    .ai-title {
        height: 28px;
        padding: 0 10px;
        display: flex;
        align-items: center;
        gap: 8px;
        color: var(--vsc-muted);
        font: 700 10px var(--tk-font);
        letter-spacing: .08em;
        flex-shrink: 0;
    }
    .ai-model { font-weight: 400; letter-spacing: 0; opacity: .7; text-transform: none; }
    .ai-close { margin-left: auto; border: 0; background: transparent; color: var(--vsc-text); font-size: 18px; cursor: pointer; line-height: 1; }
    .ai-body { flex: 1; overflow: auto; padding: 0 12px 10px; }
    .ai-muted { color: var(--vsc-muted); font: 13px var(--tk-font); }
    .ai-text {
        margin: 0;
        white-space: pre-wrap;
        word-break: break-word;
        font-family: 'Ubuntu Mono', 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.6;
        color: var(--vsc-text);
    }
    .ai-actions { display: flex; gap: 8px; justify-content: flex-end; padding: 8px 12px; border-top: 1px solid var(--vsc-border); flex-shrink: 0; }
    .palette-group {
        font: 700 10px var(--tk-font);
        letter-spacing: .08em;
        text-transform: uppercase;
        color: var(--vsc-muted);
        padding: 10px 9px 2px;
    }

    /* ── Diff ── */
    .diff-modal { max-width: 900px; }
    .diff-body {
        margin: 12px 0 0;
        max-height: 60vh;
        overflow: auto;
        font-family: 'Ubuntu Mono', 'Consolas', monospace;
        font-size: 12px;
        line-height: 1.5;
        white-space: pre;
        background: var(--vsc-bg);
        border: 1px solid var(--vsc-border);
        border-radius: var(--tk-radius-md);
        padding: 10px;
    }
    .diff-line { display: block; }
    .diff-add { color: #4ade80; background: rgba(74,222,128,.08); }
    .diff-del { color: #f87171; background: rgba(248,113,113,.08); }
    .diff-hunk { color: #6b9fd4; }
    .diff-meta { color: var(--vsc-muted); }

    .terminal-panel { height: min(38dvh, 330px); border-top: 1px solid var(--vsc-border); background: var(--vsc-bg); display: flex; flex-direction: column; min-height: 150px; }
    .terminal-title { height: 28px; padding: 0 10px; display: flex; align-items: center; color: var(--vsc-muted); font: 700 10px var(--tk-font); letter-spacing: .08em; }
    .terminal-title button { margin-left: auto; border: 0; background: transparent; color: var(--vsc-text); font-size: 18px; cursor: pointer; }
    .terminal-panel iframe { flex: 1; width: 100%; border: 0; background: var(--vsc-bg); }
    .statusbar-right {
        margin-left: auto;
        display: flex;
        align-items: center;
        gap: 4px;
    }
    .fs-btn {
        background: transparent;
        border: none;
        color: var(--vsc-status-text);
        cursor: pointer;
        font-size: 11px;
        font-family: 'Ubuntu', system-ui, sans-serif;
        padding: 0 5px;
        height: 18px;
        border-radius: 2px;
        opacity: .85;
        transition: opacity .1s, background .1s;
        line-height: 1;
    }
    .fs-btn:hover:not(:disabled) { opacity: 1; background: rgba(255,255,255,.15); }
    .fs-btn:disabled { opacity: .35; cursor: default; }
    .fs-label {
        font-size: 11px;
        min-width: 28px;
        text-align: center;
        opacity: .8;
    }

    /* ── Save/action buttons ── */
    .save-btn {
        background: transparent;
        border: 1px solid rgba(255,255,255,.2);
        color: var(--vsc-text);
        border-radius: 3px;
        padding: 3px 10px;
        font-size: 12px;
        cursor: pointer;
        font-family: 'Ubuntu', system-ui, sans-serif;
        transition: background .1s;
        white-space: nowrap;
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

    /* ── Warning modal ── */
    .modal-bg {
        position: fixed;
        inset: 0;
        background: rgba(0,0,0,.65);
        backdrop-filter: blur(2px);
        z-index: 100;
        display: flex;
        align-items: center;
        justify-content: center;
    }
    .modal {
        background: var(--vsc-surface);
        border: 1px solid var(--vsc-border);
        border-radius: 6px;
        padding: 28px 24px;
        max-width: 380px;
        width: 90%;
        text-align: center;
        font-family: 'Ubuntu', system-ui, sans-serif;
    }
    .modal-icon { font-size: 40px; margin-bottom: 12px; }
    .modal h2 { font-size: 16px; font-weight: 600; margin: 0 0 10px; color: var(--vsc-text); }
    .modal p { font-size: 13px; color: var(--vsc-muted); line-height: 1.6; margin: 0 0 8px; }
    .modal-warn { color: #f87171 !important; }
    .modal-btns { display: flex; gap: 10px; justify-content: center; margin-top: 20px; }
    .command-modal { text-align: left; max-width: 560px; }
    .command-modal form { display: flex; gap: 8px; }
    .command-input { flex: 1; min-width: 0; border: 1px solid var(--vsc-border); background: var(--vsc-bg); color: var(--vsc-text); padding: 9px; border-radius: var(--tk-radius-md); font: 13px var(--tk-font); }
    .palette-actions, .search-results { display: flex; flex-direction: column; gap: 4px; margin-top: 12px; max-height: 300px; overflow: auto; }
    .palette-actions button, .search-results button { background: transparent; border: 0; color: var(--vsc-text); padding: 9px; text-align: left; cursor: pointer; border-radius: var(--tk-radius-md); font: 13px var(--tk-font); }
    .palette-actions button:hover:not(:disabled), .search-results button:hover { background: var(--vsc-surface2); }
    .palette-actions button:disabled { opacity: .4; cursor: default; }
    .btn-cancel {
        background: transparent;
        border: 1px solid var(--vsc-border);
        color: var(--vsc-muted);
        padding: 8px 18px;
        border-radius: 4px;
        font-size: 13px;
        cursor: pointer;
        transition: all .1s;
    }
    .btn-cancel:hover { color: var(--vsc-text); }
    .btn-confirm {
        background: var(--vsc-accent);
        /* --vsc-accent is near-white in the dark theme, so a hardcoded #fff
           label was white on white. --tk-on-accent flips with the theme. */
        color: var(--tk-on-accent);
        border: none;
        padding: 8px 18px;
        border-radius: 4px;
        font-size: 13px;
        font-weight: 500;
        cursor: pointer;
        transition: opacity .1s;
    }
    .btn-confirm:hover { opacity: .85; }

    /* ── Mobile breakpoint (≤768px) ── */
    @media (max-width: 768px) {
        .activitybar { display: none; }
        .sidebar {
            position: fixed;
            top: 0;
            left: 0;
            bottom: 0;
            z-index: 20;
            transform: translateX(-100%);
            width: 280px;
            min-width: 280px;
            box-shadow: 4px 0 20px rgba(0,0,0,.5);
        }
        .sidebar.open { transform: translateX(0); }
        .sidebar-backdrop { display: block; }
        .mobile-topbar { display: flex; }
        .desktop-savebar { display: none; }
        .tab-name { max-width: 80px; }
    }
</style>
