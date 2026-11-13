<script>
    import { createEventDispatcher } from "svelte";
    // Tira de anexos de uma mensagem. Serve dois casos:
    //  · upload recém-feito → o anexo traz `base64`/`textContent` em memória;
    //  · sessão reaberta do histórico → só sobrou o path, e o arquivo vem por
    //    `url` (/agent/attachment?path=…).
    // Também é o que a IA usa quando anexa um arquivo que ela mesma gerou.
    export let attachments = [];
    // "user" alinha à direita (bolha do usuário); "assistant" à esquerda.
    export let align = "user";

    function guessLang(name = "") {
        const ext = (name.split(".").pop() || "").toLowerCase();
        const map = {
            js: "javascript",
            ts: "typescript",
            jsx: "javascript",
            tsx: "typescript",
            py: "python",
            json: "json",
            md: "markdown",
            yaml: "yaml",
            yml: "yaml",
            html: "html",
            css: "css",
            scss: "css",
            sh: "bash",
            rs: "rust",
            go: "go",
            java: "java",
            c: "c",
            cpp: "cpp",
            h: "c",
        };
        return map[ext] || ext || "text";
    }

    const dispatch = createEventDispatcher();
    const src = (att) => att.base64 || att.url || null;
    const isHtml = (att) =>
        att.artifact?.type === "text/html" || /\.html?$/i.test(att.name || "");
    const isVideo = (att) => !!att.mimetype?.startsWith("video/");
    const isAudio = (att) => !!att.mimetype?.startsWith("audio/");
</script>

{#if attachments.length}
    <div class="attachments" class:left={align === "assistant"}>
        {#each attachments as att}
            {@const source = src(att)}
            {#if att.isImage && source}
                <div class="att-img-wrap">
                    <img
                        src={source}
                        alt={att.name || "Attached image"}
                        title={att.name || "Attached image"}
                        class="att-img"
                    />
                </div>
            {:else if att.isText && att.textContent}
                <div class="att-code-wrap">
                    <div class="att-code-header">
                        <svg viewBox="0 0 16 16" fill="none" width="11" height="11">
                            <path
                                d="M14 2H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"
                                stroke="currentColor"
                                stroke-width="1.2"
                            />
                            <polyline
                                points="10 2 10 6 14 6"
                                stroke="currentColor"
                                stroke-width="1.2"
                            />
                        </svg>
                        <span class="att-code-name">{att.name}</span>
                        <span class="att-code-lang">{guessLang(att.name)}</span>
                        {#if isHtml(att)}
                            <button
                                class="att-canvas-btn"
                                on:click={() =>
                                    dispatch("openCanvas", att.artifact || { url: att.path })}
                            >Abrir Canvas</button>
                        {/if}
                    </div>
                    <pre class="att-code-body"><code
                            >{att.textContent.length > 800
                                ? att.textContent.slice(0, 800) +
                                  "\n… (truncado)"
                                : att.textContent}</code
                        ></pre>
                </div>
            {:else if isVideo(att) && source}
                <div class="att-img-wrap">
                    <!-- svelte-ignore a11y-media-has-caption -->
                    <video class="att-img" src={source} controls preload="metadata"
                    ></video>
                    <span class="att-label">{att.name}</span>
                </div>
            {:else if isAudio(att) && source}
                <div class="att-img-wrap">
                    <audio class="att-audio" src={source} controls preload="metadata"
                    ></audio>
                    <span class="att-label">{att.name}</span>
                </div>
            {:else if source}
                <a
                    class="att-file-pill"
                    href={source}
                    target="_blank"
                    rel="noopener noreferrer"
                    title={att.path || att.name}
                >
                    <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path
                            d="M14 2H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"
                            stroke="currentColor"
                            stroke-width="1.3"
                        />
                    </svg>
                    {att.name}
                </a>
            {:else}
                <div class="att-file-pill" title={att.path || att.name}>
                    <svg viewBox="0 0 16 16" fill="none" width="12" height="12">
                        <path
                            d="M14 2H6a2 2 0 00-2 2v10a2 2 0 002 2h8a2 2 0 002-2V4a2 2 0 00-2-2z"
                            stroke="currentColor"
                            stroke-width="1.3"
                        />
                    </svg>
                    {att.name}
                </div>
            {/if}
        {/each}
    </div>
{/if}

<style>
    .attachments {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        align-items: flex-end;
        width: 100%;
    }
    .attachments.left {
        align-items: flex-start;
    }
    .att-img-wrap {
        display: flex;
        align-items: flex-end;
        max-width: min(300px, 72vw);
    }
    .attachments.left .att-img-wrap {
        align-items: flex-start;
    }
    .att-img {
        display: block;
        max-width: 100%;
        max-height: 220px;
        border-radius: 9px;
        border: 1px solid var(--w08, rgba(255, 255, 255, 0.08));
        object-fit: contain;
        cursor: default;
        transition: opacity 200ms ease-out;
    }
    .att-img:hover {
        opacity: 0.86;
    }
    :global(.mobile) .att-img {
        max-width: min(220px, 72vw);
        max-height: 160px;
    }
    .att-audio {
        max-width: 300px;
        height: 34px;
    }
    .att-label {
        font-size: 10px;
        color: var(--txt-3);
        font-family: var(--font-mono);
        letter-spacing: 0.02em;
    }
    .att-code-wrap {
        width: 100%;
        max-width: 500px;
        border: 1px solid var(--border);
        border-radius: 9px;
        overflow: hidden;
        background: rgba(0, 0, 0, 0.35);
    }
    .att-code-header {
        display: flex;
        align-items: center;
        gap: 7px;
        padding: 7px 11px;
        background: var(--w02, rgba(255, 255, 255, 0.02));
        border-bottom: 1px solid var(--border);
        color: var(--txt-2);
    }
    .att-code-name {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-2);
        flex: 1;
    }
    .att-code-lang {
        font-family: var(--font-mono);
        font-size: 9px;
        color: var(--txt);
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 5px;
        letter-spacing: 0.04em;
    }
    .att-canvas-btn {
        border: 1px solid var(--border-hi, var(--border));
        border-radius: 5px;
        padding: 3px 7px;
        background: var(--surface-2, var(--w05));
        color: var(--txt);
        font: 600 10px var(--font-body, system-ui, sans-serif);
        cursor: pointer;
        transition:
            transform 200ms ease-out,
            opacity 200ms ease-out;
    }
    .att-canvas-btn:hover {
        opacity: 0.8;
        transform: translateY(-1px);
    }
    .att-code-body {
        margin: 0;
        padding: 10px 12px;
        font-family: var(--font-mono);
        font-size: 11px;
        color: rgba(200, 200, 200, 0.6);
        line-height: 1.6;
        max-height: 200px;
        overflow-y: auto;
        white-space: pre-wrap;
        word-break: break-all;
    }
    .att-code-body::-webkit-scrollbar {
        width: 2px;
    }
    .att-code-body::-webkit-scrollbar-thumb {
        background: var(--w07, rgba(255, 255, 255, 0.07));
        border-radius: 2px;
    }
    .att-file-pill {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 4px 9px;
        border-radius: 6px;
        background: var(--w03, rgba(255, 255, 255, 0.03));
        border: 1px solid var(--border);
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-2);
        text-decoration: none;
    }
    a.att-file-pill:hover {
        border-color: var(--border-hi);
        color: var(--txt);
    }

    @media (max-width: 600px) {
        .att-img-wrap {
            max-width: min(220px, 42vw);
        }
    }
</style>
