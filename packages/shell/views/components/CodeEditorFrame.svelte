<script>
    // Renders packages/code-editor's Embed.svelte view in a sandboxed iframe,
    // driven by a file path — the chat-block counterpart of file-manager's
    // native-viewer integration for the same view.
    export let path;

    $: src = `/view/code-editor/Embed?path=${encodeURIComponent(path)}`;
</script>

<div class="container">
    <iframe
        class="preview"
        title="Code Editor"
        sandbox="allow-scripts allow-modals allow-same-origin"
        {src}
    />
</div>

<style>
    .container {
        width: 100%;
        border-radius: var(--r-lg);
        overflow: hidden;
        border: 0.75px solid var(--border);
        background: rgba(0, 0, 0, 0.35);
        resize: vertical;
    }

    .preview {
        width: 100%;
        height: 420px;
        min-height: 200px;
        border: none;
        display: block;
        background: #1e1e1e;
    }
</style>
