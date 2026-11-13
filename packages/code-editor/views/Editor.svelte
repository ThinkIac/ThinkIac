<script>
    // The single editing surface, shared by Index.svelte (full IDE) and
    // Embed.svelte (file-manager's inline editor). Both used to carry their own
    // copy of a textarea + highlight-layer + line-number implementation.
    import { onMount, createEventDispatcher } from 'svelte';

    export let value = '';
    /** Drives syntax highlighting and the status-bar language label. */
    export let path = '';
    export let theme = 'dark';
    export let fontSize = 13;
    export let readOnly = false;

    const dispatch = createEventDispatcher();

    let host;
    let view = null;
    let cm = null;
    let ready = false;

    onMount(async () => {
        // Dynamic import keeps CodeMirror out of the server-render graph.
        cm = await import('./lib/editor-setup.js');
        view = cm.createEditor({
            parent: host,
            doc: value ?? '',
            path, theme, fontSize, readOnly,
            onChange: (doc) => dispatch('change', doc),
            onSave: () => dispatch('save'),
        });
        ready = true;
        dispatch('ready');
        return () => { view?.destroy(); view = null; ready = false; };
    });

    // Only replace the document for a true external change. Comparing against
    // CodeMirror's current state is race-free: the parent can echo an input
    // event back in any reactive order without resetting its selection.
    $: if (ready && view && cm.docOf(view) !== (value ?? '')) cm.setDoc(view, value ?? '');
    $: if (ready && view) cm.setLanguage(view, path);
    $: if (ready && view) cm.setTheme(view, theme, fontSize);
    $: if (ready && view) cm.setReadOnly(view, readOnly);

    // ── Imperative API for the parents ────────────────────────────────────────
    export function goToLine(line) { if (ready) cm.goToLine(view, line); }
    export function focus() { view?.focus(); }
    export function getSelection() { return ready ? cm.selectionOf(view) : { from: 0, to: 0, text: '' }; }
    export function replaceRange(from, to, text) { if (ready) cm.replaceRange(view, from, to, text); }
    export function getDoc() { return ready ? cm.docOf(view) : value; }
</script>

<div class="cm-host" bind:this={host}></div>

<style>
    .cm-host {
        flex: 1;
        min-height: 0;
        min-width: 0;
        overflow: hidden;
    }
    /* CodeMirror mounts its own DOM inside .cm-host, so these need :global. */
    .cm-host :global(.cm-editor) { height: 100%; }
    .cm-host :global(.cm-editor.cm-focused) { outline: none; }
    .cm-host :global(.cm-scroller) { overscroll-behavior: contain; }
</style>
