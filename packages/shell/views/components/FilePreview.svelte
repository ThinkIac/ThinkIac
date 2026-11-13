<script>
    import CodeView from './CodeView.svelte';
    import * as agentRuntime from '../agents/runtime.js';

    export let path = '';
    export let onClose = () => {};

    let file = null;
    let error = '';
    let loading = false;
    let requestId = 0;
    let dismissed = false;

    async function load(filePath) {
        const currentRequest = ++requestId;
        file = null;
        error = '';
        loading = true;
        try {
            const response = await agentRuntime.request(`/file-preview?path=${encodeURIComponent(filePath)}`);
            const result = await response.json();
            if (currentRequest !== requestId) return;
            if (!response.ok || result.error) {
                error = result.error || 'Could not open the file';
                return;
            }
            file = result;
        } catch {
            if (currentRequest === requestId) error = 'Network failure while opening the file';
        } finally {
            if (currentRequest === requestId) loading = false;
        }
    }

    function close() {
        requestId += 1;
        dismissed = true;
        onClose();
    }

    function onKeydown(event) {
        if (event.key === 'Escape' && path) close();
    }

    $: if (path) {
        dismissed = false;
        load(path);
    }
</script>

<svelte:window on:keydown={onKeydown} />

{#if path && !dismissed}
    <div class="file-preview-backdrop" role="presentation" on:click={close}>
        <section
            class="file-preview-modal"
            role="dialog"
            aria-modal="true"
            aria-label="File preview"
            on:click|stopPropagation
        >
            <header class="file-preview-head">
                <div class="file-preview-title">
                    <span>{file?.name || path.split('/').pop() || 'File'}</span>
                    {#if file}<small>{file.path}</small>{/if}
                </div>
                <button class="file-preview-close" type="button" on:click={close} aria-label="Close preview">
                    <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9m0-9l-9 9" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>
                </button>
            </header>

            <div class="file-preview-body">
                {#if loading}
                    <p class="file-preview-state">Opening file…</p>
                {:else if error}
                    <p class="file-preview-state error">{error}</p>
                {:else if file}
                    <CodeView lang={file.language} source={file.content} />
                    {#if file.truncated}
                        <p class="file-preview-note">Preview limitado aos primeiros 512 KB.</p>
                    {/if}
                {/if}
            </div>
        </section>
    </div>
{/if}

<style>
    .file-preview-backdrop {
        position: fixed;
        inset: 0;
        z-index: 1000;
        display: grid;
        place-items: center;
        padding: 20px;
        background: color-mix(in srgb, var(--tk-bg, #111111) 78%, transparent);
    }

    .file-preview-modal {
        width: min(960px, 100%);
        max-height: min(78dvh, 820px);
        display: flex;
        flex-direction: column;
        overflow: hidden;
        border: 1px solid var(--tk-border-hi, var(--border));
        border-radius: var(--tk-radius-lg, var(--r-lg));
        background: var(--tk-surface, var(--surface));
        color: var(--tk-text, var(--txt));
        box-shadow: 0 2px 8px color-mix(in srgb, var(--tk-text, var(--txt)) 8%, transparent);
    }

    .file-preview-head {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        padding: 12px 14px;
        border-bottom: 1px solid var(--tk-border, var(--border));
    }

    .file-preview-title { min-width: 0; display: grid; gap: 2px; font: 500 13px var(--tk-font, var(--font-body, system-ui)); }
    .file-preview-title span, .file-preview-title small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .file-preview-title small { color: var(--tk-muted, var(--txt-3)); font: 11px var(--tk-mono, var(--font-mono)); }
    .file-preview-close { width: 28px; height: 28px; display: grid; place-items: center; flex: 0 0 auto; border: 1px solid var(--tk-border, var(--border)); border-radius: var(--tk-radius-md, var(--r)); color: var(--tk-text, var(--txt)); background: transparent; cursor: pointer; transition: transform 200ms ease-out, opacity 200ms ease-out; }
    .file-preview-close:hover { transform: translateY(-1px); opacity: .72; }
    .file-preview-close svg { width: 15px; height: 15px; }
    .file-preview-body { min-height: 150px; overflow: auto; padding: 14px; }
    .file-preview-state { margin: 0; color: var(--tk-muted, var(--txt-3)); font: 13px var(--tk-font, var(--font-body, system-ui)); }
    .file-preview-state.error { color: var(--tk-text, var(--txt)); }
    .file-preview-note { margin: 10px 0 0; color: var(--tk-muted, var(--txt-3)); font: 12px var(--tk-font, var(--font-body, system-ui)); }
</style>
