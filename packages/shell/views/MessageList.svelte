<script>
    import { tick, createEventDispatcher, onDestroy } from "svelte";
    import { api } from "./api";
    import DynamicBlock from "./components/DynamicBlock.svelte";
    import SigmaLoader from "./components/SigmaLoader.svelte";
    import Attachments from "./components/Attachments.svelte";
    import FilePreview from "./components/FilePreview.svelte";
    import MessageActions from "./components/MessageActions.svelte";
    import {
        registryVersion,
    } from "./lib/renderers.js";
    import { renderMarkdown } from "./lib/markdown.js";
    import { parseMessageBlocks } from "./lib/message_blocks.js";
    import { formatMessageTime, messageTimestamp } from "./lib/message_time.js";

    export let history = [];
    export let loading = false;
    export let isMobile = false;
    export let sessionId = null;
    export let agentName = "Agent";

    const dispatch = createEventDispatcher();
    let scrollEl;
    let previewPath = "";

    function isLocalWorkspacePath(href) {
        if (!href || /^(?:https?:|mailto:|tel:|#)/i.test(href)) return false;
        return href.startsWith("/") || /^(?:\.\/)?packages\//.test(href);
    }

    function openWorkspaceLink(event) {
        const link = event.target?.closest?.("a[href]");
        const href = link?.getAttribute("href");
        if (!isLocalWorkspacePath(href)) return;
        event.preventDefault();
        previewPath = href;
    }

    // Sugestões removidas — o InputBar cuida de atalhos contextuais.
    // Mantemos a função para compatibilidade com event handlers existentes.
    function useSuggestion(text) {
        dispatch("useSuggestion", text);
    }

    function isLatestCompletedAssistant(index) {
        for (let i = history.length - 1; i > index; i -= 1) {
            if (history[i]?.role === "assistant" && !history[i]?.streaming) return false;
        }
        return true;
    }

    function previousInputWasAudio(index) {
        for (let i = index - 1; i >= 0; i -= 1) {
            if (history[i]?.role === "user") return history[i]?.metadata?.input_mode === "audio";
        }
        return false;
    }

    // Emite a decisão de permissão (Aprovar/Negar) pro Home.svelte, que faz o
    // POST /permission/resolve — liberando/bloqueando a ferramenta no claude-cli.
    function resolvePermission(request_id, decision) {
        dispatch("resolvePermission", { request_id, decision, session_id: sessionId });
    }

    // Rótulo curto de uma linha do input da ferramenta, pro card de permissão.
    function permInputSummary(input) {
        if (!input || typeof input !== "object") return "";
        const pick =
            input.file_path || input.path || input.command || input.pattern ||
            input.query || input.url || input.prompt || input.description;
        if (pick) return String(pick).replace(/\s+/g, " ").trim().slice(0, 140);
        try { return JSON.stringify(input).slice(0, 140); } catch { return ""; }
    }

    // ── Scroll "pinned to bottom" + botão "nova mensagem" ──────────────────
    // Auto-scroll só acontece se o usuário já está no fim. Se ele rolou pra
    // cima pra ler o histórico, conteúdo novo (tokens/reasoning/steps) NÃO
    // arrasta a view pra baixo — em vez disso acende `hasNew`, que mostra o
    // botão "nova mensagem"; clicar desce e reancora.
    let atBottom = true;
    let hasNew = false;
    const NEAR_BOTTOM_PX = 80;

    function isNearBottom() {
        if (!scrollEl) return true;
        return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < NEAR_BOTTOM_PX;
    }

    function onScroll() {
        atBottom = isNearBottom();
        if (atBottom) hasNew = false;
    }

    // force=true: ação do usuário (enviar msg, abrir sessão) sempre desce.
    // force=false (default): streaming — só desce se ancorado no fim.
    let pendingScroll = null;
    let forceScroll = false;
    export function scrollBottom(force = false) {
        forceScroll ||= force;
        if (pendingScroll) return pendingScroll;
        pendingScroll = (async () => {
            await tick();
            if (typeof requestAnimationFrame === "function") {
                await new Promise(resolve => {
                    let frame;
                    const timer = setTimeout(() => { cancelAnimationFrame(frame); resolve(); }, 50);
                    frame = requestAnimationFrame(() => { clearTimeout(timer); resolve(); });
                });
            }
            if (!scrollEl) return;
            if (forceScroll || atBottom) {
                scrollEl.scrollTop = scrollEl.scrollHeight;
                atBottom = true;
                hasNew = false;
            } else hasNew = true;
        })().finally(() => { pendingScroll = null; forceScroll = false; });
        return pendingScroll;
    }

    function jumpToBottom() {
        if (!scrollEl) return;
        scrollEl.scrollTop = scrollEl.scrollHeight;
        atBottom = true;
        hasNew = false;
    }

    let assistantOrdinals = [];
    $: {
        let ordinal = -1;
        assistantOrdinals = history.map(message => {
            if (message.role === "assistant" && String(message.content ?? "").trim()) ordinal++;
            return ordinal;
        });
    }
    function assistantOrdinal(index) { return assistantOrdinals[index] ?? -1; }

    function forwardFeedback(detail) { dispatch("messageFeedback", detail); }

    // Nome curto do modelo: ids vêm longos e vendor-prefixados
    // ("anthropic/claude-sonnet-4-5-20250929"). O rodapé mostra o essencial e
    // o title guarda o id inteiro + provider.
    function shortModel(model) {
        const raw = String(model ?? "");
        if (!raw) return "";
        const tail = raw.split("/").pop();
        return tail.length > 28 ? `${tail.slice(0, 27)}…` : tail;
    }

    function modelTitle(msg) {
        const parts = [msg.model];
        if (msg.provider) parts.push(`via ${msg.provider}`);
        const u = msg.usage;
        if (u) {
            const tokens = (u.prompt_tokens || 0) + (u.completion_tokens || 0);
            if (tokens) parts.push(`${tokens} tokens`);
            if (u.cost) parts.push(`custo ${formatCost(u)}`);
        }
        return parts.filter(Boolean).join(" · ");
    }

    // Custo do turno: centavos fracionários são a norma, então a precisão
    // acompanha a ordem de grandeza em vez de fixar casas decimais.
    function formatCost(usage) {
        if (!usage || usage.cost == null) return "";
        const c = Number(usage.cost);
        if (!Number.isFinite(c)) return "";
        if (c >= 0.01) return `$${c.toFixed(2)}`;
        if (c >= 0.0001) return `$${c.toFixed(4)}`;
        return `$${c.toFixed(6)}`;
    }

    function toggleThinking(idx) {
        history = history.map((m, i) =>
            i === idx ? { ...m, thinkingExpanded: !m.thinkingExpanded } : m,
        );
    }

    let openContext = {};
    function toggleContext(idx) {
        openContext = { ...openContext, [idx]: !openContext[idx] };
    }
    const TRACE_SOURCE_NAMES = {
        system: "Agent base prompt",
        session: "Session memory and summary",
        bags: "Session plan",
        runtime_context: "Additional context",
        tools: "Tool catalog",
        workspace: "Workspace snapshot",
    };
    function traceSourceName(source) {
        return source.type === "agent_md"
            ? source.name
            : TRACE_SOURCE_NAMES[source.type] ?? source.name;
    }
    function traceSourceLabel(source) {
        const activation = source.activation === "pinned"
            ? "always included"
            : source.activation === "routed"
              ? "selected by relevance"
              : "included";
        return source.type === "agent_md" ? `AGENT.md · ${activation}` : source.type.replace(/_/g, " ");
    }

    // ── Thinking timeline: local disclosure state ──────────────────────────
    // Expansão é UI local (não toca em history/steps): mapas keyed por
    // `${idx}-${si}` (step), `r${idx}` (reasoning do topo) e `${sk}:${key}`
    // (valor de arg). Reatribuir o objeto dispara a reatividade do Svelte.
    let openThought = {};
    let openSteps = {};
    let openResult = {};
    let openReasoning = {};
    function toggleThought(k) { openThought[k] = !openThought[k]; openThought = openThought; }
    function toggleSteps(k) { openSteps[k] = !openSteps[k]; openSteps = openSteps; }
    function toggleResult(k) { openResult[k] = !openResult[k]; openResult = openResult; }
    function toggleReasoning(k) { openReasoning[k] = !openReasoning[k]; openReasoning = openReasoning; }
    function keyToggle(e, fn) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); fn(); }
    }

    const EXCERPT_LEN = 150;
    const isLong = (s) => !!s && String(s).length > EXCERPT_LEN;
    const excerpt = (s) => {
        if (!s) return "";
        s = String(s);
        return s.length > EXCERPT_LEN
            ? s.slice(0, EXCERPT_LEN).replace(/\s+\S*$/, "")
            : s;
    };
    const firstLines = (s, count) => String(s ?? "").split("\n").slice(0, count).join("\n");
    const hasMoreLines = (s, count) => String(s ?? "").split("\n").length > count;

    // Título "vivo" enquanto processa.
    //
    // Era uma lista estática de 10 frases genéricas escolhida por hash do índice
    // da mensagem: não dizia nada sobre o turno e repetia entre conversas, então
    // o olho aprendia a ignorar. Agora um modelo de classificação lê a mensagem
    // e devolve 3–5 frases ligadas ao assunto (POST /chat/thinking-titles, ver
    // core/thinking_titles.js), que rotacionam enquanto o agente trabalha.
    //
    // O fallback estático continua aqui porque a UI precisa de algo para mostrar
    // no primeiro render, antes da resposta do modelo — e se ela nunca vier.
    const THINKING_TITLES = [
        "Working through it",
        "Mapping the approach",
        "Weighing the options",
        "Connecting the dots",
        "Planning the steps",
        "Reasoning it out",
        "Structuring the answer",
        "Gathering the pieces",
        "Checking the details",
        "Thinking it through",
    ];

    const TITLE_ROTATE_MS = 2600;

    let liveTitles = THINKING_TITLES;
    let liveTitleIdx = 0;
    let titlesForMessage = null; // mensagem cujos títulos já pedimos
    let rotateTimer = null;

    // Ordem embaralhada uma vez, e então percorrida em sequência: sorteio a cada
    // troca repetiria a mesma frase por acaso, o que parece travamento.
    function shuffled(list) {
        const a = [...list];
        for (let i = a.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [a[i], a[j]] = [a[j], a[i]];
        }
        return a;
    }

    function startRotation(titles) {
        stopRotation();
        liveTitles = titles.length ? shuffled(titles) : THINKING_TITLES;
        liveTitleIdx = 0;
        if (liveTitles.length < 2) return; // uma frase só não tem o que rodar
        rotateTimer = setInterval(() => {
            liveTitleIdx = (liveTitleIdx + 1) % liveTitles.length;
        }, TITLE_ROTATE_MS);
    }

    function stopRotation() {
        if (rotateTimer) {
            clearInterval(rotateTimer);
            rotateTimer = null;
        }
    }

    // Última mensagem do usuário — é ela que descreve o que o agente está
    // fazendo agora.
    function lastUserMessage(hist) {
        for (let i = hist.length - 1; i >= 0; i--) {
            if (hist[i].role === "user" && hist[i].content && !hist[i].queued) {
                return hist[i].content;
            }
        }
        return null;
    }

    async function refreshTitles(message) {
        titlesForMessage = message;
        startRotation(THINKING_TITLES); // algo na tela já no primeiro frame
        try {
            const res = await api("/chat/thinking-titles", "POST", { message });
            // A resposta pode chegar depois do turno acabar (ou de outro turno
            // começar) — só aplica se ainda for sobre esta mensagem.
            if (titlesForMessage === message && Array.isArray(res?.titles)) {
                startRotation(res.titles);
            }
        } catch {
            /* fallback estático já está rodando */
        }
    }

    $: streamingNow = history.some((m) => m.streaming);

    // Um turno começou: busca as frases uma única vez por mensagem.
    $: if (streamingNow) {
        const msg = lastUserMessage(history);
        if (msg && msg !== titlesForMessage) refreshTitles(msg);
    } else if (rotateTimer) {
        stopRotation();
    }

    // Derivado, não função: o template precisa depender de `liveTitleIdx` para
    // re-renderizar a cada rotação — uma chamada de função não cria essa
    // dependência e o título ficaria congelado no primeiro valor.
    $: thinkingTitle = liveTitles[liveTitleIdx] ?? THINKING_TITLES[0];

    onDestroy(stopRotation);

    function stepResult(step) {
        const value = step?.result ?? step?.output ?? step?.stdout ?? null;
        if (value == null || value === "") return "";
        return typeof value === "string" ? value : JSON.stringify(value, null, 2);
    }

    // Ação Svelte: mantém o próprio scroll do bloco (não o da página) ancorado
    // no fim enquanto o texto cresce — necessário porque o raciocínio ao vivo
    // agora tem max-height própria (às vezes o texto fica enorme), então sem
    // isso o cursor piscando ficaria escondido fora da área visível.
    function autoscrollBottom(node) {
        node.scrollTop = node.scrollHeight;
        return {
            update() {
                node.scrollTop = node.scrollHeight;
            },
        };
    }

    function extractHtml(raw) {
        if (!raw) return null;
        const fenced = raw.match(/```html\s*\n([\s\S]*?)```/i);
        if (fenced) {
            const outside = raw.replace(/```html\s*\n[\s\S]*?```/gi, "").trim();
            if (outside.length > 12) return null;
            return fenced[1].trim();
        }
        if (/<!doctype\s+html/i.test(raw) || /<html[\s>]/i.test(raw))
            return raw.trim();
        return null;
    }

    function stripHtmlBlock(raw) {
        return raw.replace(/```html\s*\n[\s\S]*?```/gi, "").trim();
    }

    function getHtmlTitle(html) {
        const m = html.match(/<title[^>]*>([^<]+)<\/title>/i);
        return m ? m[1].trim() : "index.html";
    }

    function openCanvas(html) {
        dispatch("openCanvas", { html });
    }

    function isCodeFile(name = "") {
        return /\.(js|ts|jsx|tsx|py|json|md|yaml|yml|xml|html|css|scss|sh|env|toml|rs|go|java|c|cpp|h)$/i.test(
            name,
        );
    }


    let prevLength = 0;
    $: {
        if (history.length > prevLength) {
            const last = history[history.length - 1];
            if (last && last.role === "assistant" && !last.streaming) {
                const html = extractHtml(last.content);
                if (html) tick().then(() => dispatch("openCanvas", { html }));
            }
            prevLength = history.length;
        }
    }

    let wasStreaming = false;
    $: {
        const last = history[history.length - 1];
        if (last?.role === "assistant") {
            if (wasStreaming && !last.streaming) {
                const html = extractHtml(last.content);
                if (html) tick().then(() => dispatch("openCanvas", { html }));
            }
            wasStreaming = last.streaming ?? false;
        }
    }

</script>

<div class="ml-root">
<div
    class="scroll-area"
    class:mobile={isMobile}
    bind:this={scrollEl}
    on:scroll={onScroll}
>
    <div class="msgs" class:mobile={isMobile}>
        {#each history as msg, idx (idx)}
            {@const htmlContent =
                msg.role === "assistant" && !msg.streaming
                    ? extractHtml(msg.content)
                    : null}
            {@const textContent = htmlContent
                ? stripHtmlBlock(msg.content)
                : msg.content}
            {@const hasSteps = (msg.steps?.length ?? 0) > 0}
            {@const hasReasoning = !!msg.allReasoning}
            {@const hasAttachments = (msg.attachments?.length ?? 0) > 0}
            {@const trace = msg.role === "user" ? msg.inputTrace : null}
            {@const messageTime = formatMessageTime(messageTimestamp(msg))}

            <div class="msg-row {msg.role}">
                {#if msg.role === "user"}
                    <div class="user-side">
                        {#if hasAttachments}
                            <Attachments
                                attachments={msg.attachments}
                                on:openCanvas={(e) => openArtifactCanvas(e.detail)}
                            />
                        {/if}

                        {#if msg.content}
                            <div
                                class="bubble user-bubble"
                                class:is-queued={msg.queued}
                                class:just-settled={msg.justSettled}
                            >{msg.content}</div>
                        {/if}
                        {#if trace?.sources?.length || messageTime}
                            <div class="context-trace">
                                <div class="context-summary">
                                    {#if trace?.sources?.length}
                                        <button
                                            type="button"
                                            class="context-toggle"
                                            aria-expanded={!!openContext[idx]}
                                            on:click={() => toggleContext(idx)}
                                        >
                                            <svg viewBox="0 0 16 16" fill="none" width="13" height="13" aria-hidden="true">
                                                <path d="M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11Zm0 3v3l2 1.25" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round" />
                                            </svg>
                                            Context · {trace.sources.length}
                                            <svg class:open={openContext[idx]} viewBox="0 0 12 12" fill="none" width="10" height="10" aria-hidden="true"><path d="M2.5 4.5 6 8l3.5-3.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" /></svg>
                                        </button>
                                    {/if}
                                    {#if messageTime}<span class="message-time"><span aria-hidden="true">-</span> {messageTime}</span>{/if}
                                </div>
                                {#if trace?.sources?.length && openContext[idx]}
                                    <section class="context-panel" aria-label="Context used for this message">
                                        <div class="context-meta">{trace.provider} / {trace.model} · {trace.approximationLevel} · {new Date(trace.capturedAt).toLocaleString()}</div>
                                        <div class="context-sources">
                                            {#each trace.sources as source}
                                                <div class="context-source">
                                                    <div><strong>{traceSourceName(source)}</strong><span>{traceSourceLabel(source)} · ~{source.estimatedTokens} tokens</span></div>
                                                    {#if source.path}<code>{source.path}</code>{/if}
                                                    {#if source.hash}<small>{source.hash.slice(0, 15)}…</small>{/if}
                                                </div>
                                            {/each}
                                        </div>
                                    </section>
                                {/if}
                            </div>
                        {/if}
                    </div>
                {:else}
                    <div class="bubble-wrap">
                        {#if hasSteps || hasReasoning || (msg.streaming && !textContent)}
                            <!-- Thinking flows inline with the page (Slate),
                                 not a boxed card: a header + a chronological
                                 timeline of reasoning -> tools -> step notes. -->
                            <div class="think" class:is-streaming={msg.streaming}>
                                <div class="think-head static">
                                    {#if msg.streaming}
                                        <SigmaLoader size={11} color="var(--txt)" variant="wave" />
                                    {/if}
                                </div>

                                {#if hasSteps || hasReasoning}
                                    <div class="think-body">
                                        <div class="timeline">
                                            {#if msg.allReasoning}
                                                <div class="srow">
                                                    <div class="track">
                                                        <span class="tdot"></span>
                                                        {#if hasSteps || msg.streaming}<span class="tline"></span>{/if}
                                                    </div>
                                                    <div class="sbody">
                                                        {#if msg.streaming}
                                                            <p
                                                                class="thought live"
                                                                use:autoscrollBottom={msg.allReasoning}
                                                            >{msg.allReasoning}</p>
                                                        {:else}
                                                            {@const reasoningKey = `reasoning-${idx}`}
                                                            <p
                                                                class="thought reasoning-copy"
                                                                class:expanded={openReasoning[reasoningKey]}
                                                                role="button"
                                                                tabindex="0"
                                                                aria-expanded={!!openReasoning[reasoningKey]}
                                                                on:click={() => toggleReasoning(reasoningKey)}
                                                                on:keydown={(e) => keyToggle(e, () => toggleReasoning(reasoningKey))}
                                                            >{openReasoning[reasoningKey] || !hasMoreLines(msg.allReasoning, 5)
                                                                    ? msg.allReasoning
                                                                    : firstLines(msg.allReasoning, 5)}{!openReasoning[reasoningKey] && hasMoreLines(msg.allReasoning, 5) ? "\n..." : ""}</p>
                                                        {/if}
                                                    </div>
                                                </div>
                                            {/if}

                                            {#if hasSteps}
                                                {@const stepsKey = `steps-${idx}`}
                                                <div class="srow step-group-row">
                                                    <div class="track">
                                                        <span class="tdot"></span>
                                                        {#if openSteps[stepsKey]}<span class="tline"></span>{/if}
                                                    </div>
                                                    <div class="sbody">
                                                        <button
                                                            class="steps-toggle"
                                                            class:open={openSteps[stepsKey]}
                                                            type="button"
                                                            aria-expanded={!!openSteps[stepsKey]}
                                                            aria-label={String(msg.steps.length)}
                                                            on:click={() => toggleSteps(stepsKey)}
                                                        >
                                                            <span>{msg.steps.length} Actions</span>
                                                        </button>
                                                    </div>
                                                </div>
                                            {/if}

                                            {#if openSteps[`steps-${idx}`]}
                                            {#each msg.steps as step, si}
                                                {@const chips = (step.label || "step")
                                                    .split("·")
                                                    .map((s) => s.trim())
                                                    .filter(Boolean)}
                                                {@const sk = `${idx}-${si}`}
                                                {@const output = stepResult(step)}
                                                <div class="srow">
                                                    <div class="track">
                                                        <span class="tdot" class:glow={msg.streaming && si === msg.steps.length - 1}></span>
                                                        {#if si !== msg.steps.length - 1}<span class="tline"></span>{/if}
                                                    </div>
                                                    <div class="sbody">
                                                        <div class="step-summary" title={chips.join(" · ")}>{chips[0] || "step"}</div>
                                                        {#if output}
                                                            <div
                                                                class="step-result"
                                                                class:expanded={openResult[sk]}
                                                                role="button"
                                                                tabindex="0"
                                                                aria-expanded={!!openResult[sk]}
                                                                on:click={() => toggleResult(sk)}
                                                                on:keydown={(e) => keyToggle(e, () => toggleResult(sk))}
                                                            >{output}</div>
                                                        {/if}
                                                    </div>
                                            </div>
                                            {/each}
                                            {/if}

                                            {#if msg.streaming}
                                                <div class="srow">
                                                    <div class="track"><span class="tdot glow"></span></div>
                                                    <div class="sbody">
                                                        <span class="chip loading"><SigmaLoader size={11} color="var(--txt)" /></span>
                                                    </div>
                                                </div>
                                            {/if}
                                        </div>
                                    </div>
                                {/if}
                            </div>
                        {/if}
                        {#if (msg.pendingPermissions?.length ?? 0) > 0}
                            <div class="perm-list">
                                {#each msg.pendingPermissions as perm (perm.request_id)}
                                    <div class="perm-card {perm.status}">
                                        <div class="perm-head">
                                            <span class="perm-icon" aria-hidden="true"><svg viewBox="0 0 16 16" fill="none"><rect x="3.25" y="7" width="9.5" height="7" rx="1.5" stroke="currentColor" stroke-width="1.3"/><path d="M5.25 7V5.5a2.75 2.75 0 0 1 5.5 0V7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></span>
                                            <span class="perm-title"
                                                >Permissão para
                                                <b>{perm.tool_name}</b></span
                                            >
                                        </div>
                                        {#if permInputSummary(perm.tool_input)}
                                            <code class="perm-input"
                                                >{permInputSummary(
                                                    perm.tool_input,
                                                )}</code
                                            >
                                        {/if}
                                        {#if perm.error}<p role="alert">{perm.error}</p>{/if}
                                        {#if perm.status === "pending"}
                                            <div class="perm-actions">
                                                <button
                                                    class="perm-btn allow"
                                                    on:click={() =>
                                                        resolvePermission(
                                                            perm.request_id,
                                                            "allow",
                                                        )}>Aprovar</button
                                                >
                                                <button
                                                    class="perm-btn deny"
                                                    on:click={() =>
                                                        resolvePermission(
                                                            perm.request_id,
                                                            "deny",
                                                        )}>Negar</button
                                                >
                                            </div>
                                        {:else}
                                            <div
                                                class="perm-verdict {perm.status}"
                                            >
                                                {perm.status === "allow"
                                                    ? "✓ Aprovado"
                                                    : "✕ Negado"}
                                            </div>
                                        {/if}
                                    </div>
                                {/each}
                            </div>
                        {/if}

                        {#if textContent}
                            {#if hasSteps || hasReasoning}
                                    <div class="answer-divider" aria-hidden="true">
                                    <span></span><small>Answer</small><span></span>
                                </div>
                            {/if}
                            {@const parsed = parseMessageBlocks(
                                textContent,
                                msg.streaming,
                                $registryVersion,
                            )}
                            <div
                                class="assistant-content md"
                                class:streaming={msg.streaming}
                                on:click={openWorkspaceLink}
                            >
                                {#each parsed.blocks as block, blockIndex}
                                    {#if block.type === "text"}
                                        <div class:pending-text={block.pending}>
                                            {@html renderMarkdown(block.content)}
                                        </div>
                                    {:else}
                                        <DynamicBlock
                                            type={block.type}
                                            source={block.content}
                                        />
                                    {/if}
                                {/each}

                                {#if parsed.openBlock}
                                    {#if parsed.openBlock.type === "generic_code" || parsed.openBlock.type === "bash"}
                                        <div class="embedded-component-wrap">
                                            <pre><span class="code-lang"
                                                    >{parsed.openBlock.type === "bash" ? "bash" : parsed.openBlock.lang ||
                                                        ""}</span
                                                ><code
                                                    >{parsed.openBlock
                                                        .content}</code
                                                ></pre>
                                        </div>
                                    {:else}
                                        <DynamicBlock
                                            type={parsed.openBlock.type}
                                            source={parsed.openBlock.content}
                                            partial={true}
                                        />
                                    {/if}
                                {/if}

                                {#if msg.streaming}
                                    {#if !textContent}
                                        <SigmaLoader size={11} color="var(--txt)" variant="wave" />
                                    {:else if !parsed.openBlock}
                                        <span
                                            class="stream-cursor"
                                            aria-hidden="true"
                                        ></span>
                                    {/if}
                                {/if}
                            </div>
                        {/if}

                        {#if hasAttachments}
                            <Attachments
                                attachments={msg.attachments}
                                align="assistant"
                                on:openCanvas={(e) => openArtifactCanvas(e.detail)}
                            />
                        {/if}

                        {#if msg.timedOut}
                            <button class="retry-turn" type="button" on:click={() => dispatch("retry", { sessionId, index: idx })} aria-label="Tentar novamente">Tentar novamente</button>
                        {/if}

                        {#if msg.model}
                            <!-- Identificador de modelo: quem respondeu esta
                                 mensagem. Discreto de propósito — informação de
                                 rodapé, não elemento de leitura. -->
                            <div class="model-tag" title={modelTitle(msg)}>
                                <span class="model-dot"></span>
                                <span class="model-name">{shortModel(msg.model)}</span>
                                {#if msg.usage?.cost}
                                    <span class="model-cost">{formatCost(msg.usage)}</span>
                                {/if}
                                {#if messageTime}<span class="message-time"><span aria-hidden="true">-</span> {messageTime}</span>{/if}
                            </div>
                        {/if}

                        {#if !msg.streaming}
                            <MessageActions
                                message={msg}
                                index={idx}
                                assistantOrdinal={assistantOrdinal(idx)}
                                {sessionId}
                                isLatest={isLatestCompletedAssistant(idx)}
                                previousInputWasAudio={previousInputWasAudio(idx)}
                                justCompleted={msg.justCompleted === true}
                                onFeedback={forwardFeedback}
                            />
                        {/if}

                        {#if htmlContent}
                            <button
                                class="file-card"
                                on:click={() => openCanvas(htmlContent)}
                            >
                                <div class="file-icon">
                                    <svg
                                        viewBox="0 0 28 28"
                                        fill="none"
                                        width="18"
                                        height="18"
                                    >
                                        <path
                                            d="M7 4h10l5 5v15a2 2 0 01-2 2H7a2 2 0 01-2-2V6a2 2 0 012-2z"
                                            stroke="currentColor"
                                            stroke-width="1.4"
                                        />
                                        <path
                                            d="M17 4v5h5"
                                            stroke="currentColor"
                                            stroke-width="1.4"
                                            stroke-linecap="round"
                                        />
                                        <path
                                            d="M10 14l2.5 2.5L10 19M15 19h3"
                                            stroke="currentColor"
                                            stroke-width="1.3"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                </div>
                                <div class="file-info">
                                    <span class="file-name"
                                        >{getHtmlTitle(htmlContent)}</span
                                    >
                                    <span class="file-meta"
                                        >Click to open preview</span
                                    >
                                </div>
                                <div class="file-arrow">
                                    <svg
                                        viewBox="0 0 16 16"
                                        fill="none"
                                        width="14"
                                        height="14"
                                    >
                                        <path
                                            d="M6 4l4 4-4 4"
                                            stroke="currentColor"
                                            stroke-width="1.5"
                                            stroke-linecap="round"
                                            stroke-linejoin="round"
                                        />
                                    </svg>
                                </div>
                            </button>
                        {/if}
                    </div>
                {/if}
            </div>
        {/each}

        {#if loading && (history.length === 0 || history[history.length - 1]?.role === "user")}
            <div class="msg-row assistant">
                <div class="think is-streaming">
                    <div class="think-head static">
                        <span class="think-title muted"
                            >{thinkingTitle}</span
                        >
                        <SigmaLoader size={11} color="var(--txt)" variant="wave" />
                    </div>
                </div>
            </div>
        {/if}
    </div>
</div>

<FilePreview path={previewPath} onClose={() => (previewPath = "")} />

{#if hasNew}
    <button class="new-msg-btn" on:click={jumpToBottom} aria-label="Ir para a mensagem mais recente">
        <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true">
            <path d="M12 5v14M5 12l7 7 7-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
        <span>New message</span>
    </button>
{/if}
</div>

<style>
    /* ─── EASING GLOBAL ────────────────────────────────────────────────── */
    :root {
        --ease-ui: cubic-bezier(0.4, 0, 0.2, 1);
        --ease-spring: cubic-bezier(0.34, 1.56, 0.64, 1);
    }

    /* ─── SCROLL AREA ──────────────────────────────────────────────────── */
    /* Wrapper relativo pra ancorar o botão "nova mensagem" sobre a área de
       scroll sem que ele role junto com o conteúdo. Ocupa o mesmo slot flex
       que a scroll-area ocupava antes. */
    .ml-root {
        flex: 1;
        min-height: 0;
        position: relative;
        display: flex;
        flex-direction: column;
    }
    .new-msg-btn {
        position: absolute;
        bottom: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 5;
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 7px 14px 7px 11px;
        border: 1px solid var(--border-hi);
        border-radius: 999px;
        background: var(--accent, var(--txt));
        color: var(--bg);
        font-size: 0.82rem;
        font-weight: 600;
        cursor: pointer;
        box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
        animation: newmsg-in 0.18s var(--ease-spring, ease) both;
    }
    .new-msg-btn:hover { opacity: 0.85; }
    .new-msg-btn:active { transform: translateX(-50%) translateY(1px); }
    .new-msg-btn svg { display: block; }
    @keyframes newmsg-in {
        from { opacity: 0; transform: translateX(-50%) translateY(8px); }
        to   { opacity: 1; transform: translateX(-50%) translateY(0); }
    }
    .scroll-area {
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        padding: 1.5rem 0 0.5rem;
        scroll-behavior: smooth;
        -webkit-overflow-scrolling: touch;
        overscroll-behavior-y: contain;
    }
    .scroll-area::-webkit-scrollbar {
        width: 2px;
    }
    .scroll-area::-webkit-scrollbar-track {
        background: transparent;
    }
    .scroll-area::-webkit-scrollbar-thumb {
        background: var(--w06, rgba(255, 255, 255, 0.06));
        border-radius: 2px;
        transition: background 0.2s var(--ease-ui);
    }
    .scroll-area::-webkit-scrollbar-thumb:hover {
        background: var(--w14, rgba(255, 255, 255, 0.14));
    }
    .scroll-area.mobile::-webkit-scrollbar {
        display: none;
    }
    .scroll-area.mobile {
        scrollbar-width: none;
    }

    /* ─── MSGS CONTAINER ───────────────────────────────────────────────── */
    .msgs {
        max-width: 760px;
        margin: 0 auto;
        padding: 0 24px;
        display: flex;
        flex-direction: column;
        gap: 2rem;
    }
    .msgs.mobile {
        padding: 0 16px;
        max-width: 100%;
        gap: 1.5rem;
    }

    /* ─── MSG ROW ──────────────────────────────────────────────────────── */
    .msg-row {
        display: flex;
        animation: fade-up 420ms ease-out both;
        animation-delay: calc(var(--entry-idx, 0) * 80ms);
    }
    .msg-row:nth-child(1) { --entry-idx: 0; }
    .msg-row:nth-child(2) { --entry-idx: 1; }
    .msg-row:nth-child(3) { --entry-idx: 2; }
    .msg-row:nth-child(4) { --entry-idx: 3; }
    .msg-row:nth-child(5) { --entry-idx: 4; }
    .msg-row:nth-child(6) { --entry-idx: 5; }
    .msg-row:nth-child(7) { --entry-idx: 6; }
    .msg-row:nth-child(8) { --entry-idx: 7; }
    .msg-row:nth-child(9) { --entry-idx: 8; }
    .msg-row:nth-child(10) { --entry-idx: 9; }
    .msg-row.user {
        justify-content: flex-end;
    }
    .msg-row.assistant {
        justify-content: flex-start;
        width: 100%;
    }

    @keyframes fade-up {
        from {
            opacity: 0;
            transform: translateY(16px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    /* ─── USER SIDE ──────────────────────────────────────────────────────
       Continua como uma "etiqueta" sutil, alinhada à direita — é o único
       elemento que mantém um leve invólucro visual, servindo de contraste
       discreto para ancorar onde a entrada do usuário termina.
    */
    .user-side {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 8px;
        max-width: 580px;
    }
    .mobile .user-side {
        max-width: 90%;
    }

    /* ─── BUBBLE WRAP (assistente) ─────────────────────────────────────────
       Ocupa a largura total da coluna — a resposta é texto corrido na
       página, não um cartão contido. Sem avatar: presença mínima.
    */
    .bubble-wrap {
        position: relative;
        display: flex;
        flex-direction: column;
        align-items: flex-start;
        gap: 10px;
        min-width: 0;
        width: 100%;
        max-width: 100%;
    }
    .retry-turn { padding:5px 10px; border:1px solid var(--border); border-radius:999px; background:transparent; color:var(--txt-2); font:500 11px var(--font-body); cursor:pointer; }
    .retry-turn:hover,.retry-turn:focus-visible { color:var(--txt); border-color:var(--txt-2); outline:none; }

    /* ─── THINKING BLOCK ───────────────────────────────────────────────── */
    /* ─── THINKING · inline timeline (Slate) ──────────────────────────────
       No card wrapper: reasoning reads as part of the page, like the message
       body. A header (collapsed by default) opens a chronological timeline of
       reasoning -> tool calls -> per-step notes. All copy in English. Theme via
       design-system tokens + wash ladder, so light and dark both hold. */
    .think {
        width: 100%;
    }
    .think-head {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        padding: 6px 2px;
        background: transparent;
        border: none;
        cursor: pointer;
        text-align: left;
        font-family: var(--font-body);
        color: var(--txt-2);
        min-height: 30px;
    }
    .think-head.static {
        cursor: default;
    }
    .think-title {
        font-size: 13px;
        font-weight: 500;
        letter-spacing: 0.01em;
        color: var(--txt);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .think-title.muted {
        color: var(--txt-2);
    }
    .think-count {
        font-size: 11px;
        color: var(--txt-2);
        background: var(--w05, rgba(255, 255, 255, 0.05));
        padding: 2px 7px;
        border-radius: 6px;
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        flex-shrink: 0;
    }
    .chev {
        margin-left: auto;
        color: var(--txt-3);
        flex-shrink: 0;
        display: inline-flex;
        transition:
            transform 0.22s var(--ease-spring),
            color 0.15s var(--ease-ui);
    }
    .chev.open {
        transform: rotate(180deg);
    }
    .think-head:hover .chev {
        color: var(--txt);
    }
    .think-body {
        padding: 6px 0 2px 3px;
        animation: expand-in 0.18s var(--ease-ui);
    }
    .answer-divider {
        display: flex;
        align-items: center;
        gap: 9px;
        width: 100%;
        margin: 3px 0 2px;
        color: var(--txt-3);
        font-family: var(--font-mono, monospace);
        font-size: 10px;
        letter-spacing: 0.08em;
        text-transform: uppercase;
    }
    .answer-divider span {
        height: 1px;
        flex: 1;
        background: var(--border);
    }
    .answer-divider small { font-size: inherit; }
    @keyframes expand-in {
        from {
            opacity: 0;
            transform: translateY(-4px);
        }
        to {
            opacity: 1;
            transform: translateY(0);
        }
    }

    .timeline {
        display: flex;
        flex-direction: column;
    }
    .srow {
        display: grid;
        grid-template-columns: 14px 1fr;
        gap: 11px;
    }
    .track {
        display: flex;
        flex-direction: column;
        align-items: center;
        padding-top: 5px;
    }
    .tdot {
        width: 7px;
        height: 7px;
        border-radius: 50%;
        flex-shrink: 0;
        background: var(--w20, rgba(255, 255, 255, 0.2));
        box-shadow: 0 0 0 1.5px var(--border-hi);
        transition: box-shadow 0.25s var(--ease-ui);
    }
    .tdot.glow {
        background: var(--txt);
        animation: dot-glow 1.8s var(--ease-ui) infinite;
    }
    @keyframes dot-glow {
        0%,
        100% {
            box-shadow: 0 0 2px var(--w15, rgba(255, 255, 255, 0.15));
        }
        50% {
            box-shadow: 0 0 8px var(--w50, rgba(255, 255, 255, 0.5));
        }
    }
    .tline {
        width: 1.5px;
        flex: 1;
        min-height: 12px;
        margin: 4px 0 -3px;
        background: var(--border-hi);
    }
    .sbody {
        min-width: 0;
        padding-bottom: 14px;
    }
    .step-group-row .sbody {
        padding-bottom: 10px;
    }
    .steps-toggle {
        display: inline-flex;
        align-items: center;
        min-width: 0;
        min-height: 24px;
        padding: 2px 0;
        border: 0;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        font: 500 12px/1 var(--font-body, system-ui, sans-serif);
        letter-spacing: .01em;
        transition: color 200ms ease-out, transform 200ms ease-out;
    }
    .steps-toggle:hover,
    .steps-toggle.open {
        color: var(--txt);
    }
    .steps-toggle:focus-visible {
        outline: 2px solid var(--txt-2);
        outline-offset: 3px;
        border-radius: 4px;
    }
    .step-summary {
        max-width: 680px;
        margin: 0 0 3px;
        overflow: hidden;
        color: var(--txt-2);
        font: 500 12px/1.45 var(--font-body, system-ui, sans-serif);
        letter-spacing: .01em;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .step-result {
        max-width: 680px;
        max-height: 6.4em;
        overflow: hidden;
        color: var(--txt-2);
        font: 400 12.5px/1.55 var(--font-body, system-ui, sans-serif);
        letter-spacing: .005em;
        white-space: pre-wrap;
        overflow-wrap: anywhere;
        cursor: pointer;
        transition: color 200ms ease-out, opacity 200ms ease-out;
    }
    .step-result:hover,
    .step-result:focus-visible {
        color: var(--txt);
        opacity: .82;
        outline: none;
    }
    .step-result.expanded {
        max-height: none;
    }
    .chips {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: center;
        margin-bottom: 5px;
    }
    .chip {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        padding: 3px 9px;
        border-radius: 7px;
        background: var(--w03, rgba(255, 255, 255, 0.03));
        border: 1px solid var(--border);
        font-size: 12px;
        color: var(--txt);
        white-space: nowrap;
        font-family: var(--font-body);
    }
    .chip .cd {
        width: 5px;
        height: 5px;
        border-radius: 50%;
        background: var(--txt-2);
        flex-shrink: 0;
    }
    .chip.reason {
        font-weight: 500;
    }
    .chip.tool {
        font-family: var(--font-mono);
        font-size: 11.5px;
        cursor: default;
    }
    button.chip.tool {
        cursor: pointer;
        transition:
            background 0.15s var(--ease-ui),
            border-color 0.15s var(--ease-ui);
    }
    button.chip.tool:hover {
        border-color: var(--border-hi);
        background: var(--w05, rgba(255, 255, 255, 0.05));
    }
    button.chip.tool.active {
        background: var(--w06, rgba(255, 255, 255, 0.06));
        border-color: var(--border-hi);
    }
    .chip-caret {
        font-size: 9px;
        color: var(--txt-3);
        transition: transform 0.18s var(--ease-ui);
    }
    .chip-caret.open {
        transform: rotate(180deg);
    }
    .chip.loading {
        padding: 4px 9px;
    }
    .thought {
        max-width: 680px;
        margin: 2px 0 0;
        font-size: 13px;
        line-height: 1.55;
        color: var(--txt-2);
        cursor: pointer;
        white-space: pre-wrap;
        word-break: break-word;
    }
    .reasoning-copy {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
    }
    .reasoning-copy:not(.expanded) {
        max-height: 8.25em;
        overflow: hidden;
    }
    .reasoning-copy:focus-visible,
    .step-result:focus-visible {
        outline: 2px solid var(--border-hi);
        outline-offset: 4px;
        border-radius: 3px;
    }
    .thought.step {
        font-style: italic;
        color: var(--txt-3);
    }
    .thought .more {
        color: var(--txt);
        font-weight: 600;
    }
    .thought.live {
        cursor: default;
        white-space: pre-wrap;
        max-height: 260px;
        overflow-y: auto;
        padding-left: 10px;
        border-left: 2px solid var(--txt-3);
    }
    .thought.live::after {
        content: "▌";
        margin-left: 1px;
        color: var(--txt-2);
        animation: reasoning-caret 1s steps(1) infinite;
    }
    @keyframes reasoning-caret {
        50% {
            opacity: 0;
        }
    }
    .thought.live::-webkit-scrollbar {
        width: 2px;
    }
    .thought.live::-webkit-scrollbar-track {
        background: transparent;
    }
    .thought.live::-webkit-scrollbar-thumb {
        background: var(--w06, rgba(255, 255, 255, 0.06));
        border-radius: 2px;
    }
    .args {
        max-width: 680px;
        margin: 2px 0 2px;
        border: 1px solid var(--border);
        border-radius: 9px;
        overflow: hidden;
        background: var(--bg-elevated);
    }
    .args table {
        border-collapse: collapse;
        width: 100%;
        font-size: 12px;
    }
    .args td {
        padding: 6px 10px;
        border-top: 1px solid var(--border);
        vertical-align: top;
    }
    .args tr:first-child td {
        border-top: none;
    }
    .args .k {
        color: var(--txt-2);
        font-family: var(--font-mono);
        white-space: nowrap;
        width: 1%;
    }
    .args .v {
        color: var(--txt);
        font-family: var(--font-mono);
        word-break: break-word;
    }
    .args .trunc {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 18px;
        height: 18px;
        color: var(--txt-2);
        cursor: pointer;
        margin-left: 3px;
        border-radius: 4px;
        transition: color 200ms ease-out, background 200ms ease-out;
    }
    .args .trunc:hover,
    .args .trunc:focus-visible {
        color: var(--txt);
        background: var(--w06, rgba(255, 255, 255, 0.06));
        outline: none;
    }
    .expand-mark {
        display: block;
        transform: translateY(-2px);
        font-size: 15px;
        line-height: 1;
    }
    /* ─── USER BUBBLE ──────────────────────────────────────────────────────
       Único balão que sobra no sistema. Leve, com raio assimétrico,
       cor de fundo do design system inalterada.
    */
    .bubble {
        max-width: 580px;
        padding: 10px 15px;
        font-size: 15px;
        line-height: 1.68;
        word-break: break-word;
    }
    .mobile .bubble {
        font-size: 15px;
        padding: 9px 12px;
    }
    .user-bubble {
        background: var(--user-bg);
        border: 0.75px solid var(--user-border);
        border-radius: var(--r-lg);
        border-bottom-right-radius: 4px;
        color: var(--txt);
        max-width: 100%;
    }
    .context-trace {
        display: flex;
        flex-direction: column;
        align-items: flex-end;
        gap: 3px;
        max-width: 100%;
    }
    .context-summary {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        color: var(--txt-3);
        font: 9px var(--font-mono, monospace);
    }
    .context-toggle {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        padding: 1px 2px;
        border: 0;
        border-radius: var(--tk-radius-md, 8px);
        background: transparent;
        color: var(--txt-3);
        font: 9px var(--font-mono, monospace);
        cursor: pointer;
        opacity: .5;
        transition: opacity 200ms ease-out, color 200ms ease-out;
    }
    .context-toggle:hover, .context-toggle[aria-expanded="true"] {
        color: var(--txt-2);
        opacity: .85;
    }
    .context-toggle svg:last-child { transition: transform 200ms ease-out; }
    .context-toggle svg:last-child.open { transform: rotate(180deg); }
    .context-panel {
        width: min(440px, 100%);
        box-sizing: border-box;
        padding: 5px 0 3px 9px;
        border: 0;
        border-left: 1px solid var(--border);
        border-radius: 0;
        background: transparent;
        color: var(--txt-2);
        text-align: left;
        animation: fade-up 200ms ease-out both;
    }
    .context-meta {
        padding-bottom: 4px;
        color: var(--txt-3);
        font: 9px/1.35 var(--font-mono, monospace);
        overflow-wrap: anywhere;
    }
    .context-sources { display: grid; gap: 5px; margin-top: 4px; }
    .context-source { display: grid; gap: 1px; min-width: 0; }
    .context-source div { display: flex; justify-content: space-between; gap: 8px; align-items: baseline; }
    .context-source strong { color: var(--txt-2); font: 500 11px var(--font-body, system-ui, sans-serif); }
    .context-source span, .context-source code, .context-source small { color: var(--txt-3); font: 9px/1.3 var(--font-mono, monospace); overflow-wrap: anywhere; }
    .context-source code { white-space: normal; }

    /* Mensagem enviada durante a resposta — aguardando entrar no turno.
       Fica ABAIXO do bloco de pensamento (ver insertUserMessage em Home.svelte)
       e usa a paleta normal da bolha: é uma mensagem sua de verdade, não um
       rascunho. O rótulo "na fila" e o estilo tracejado saíram — a posição já
       comunica o estado, e o texto repetia em palavras o que a UI mostrava. */
    .user-bubble.is-queued {
        animation: queued-breathe 2.6s ease-in-out infinite;
    }
    @keyframes queued-breathe {
        0%, 100% { opacity: 0.72; }
        50%      { opacity: 1; }
    }

    /* O turno consumiu a mensagem: ela troca de lugar com o bloco de pensamento
       (que desce). O deslize curto para cima dá continuidade ao salto — sem ele
       a bolha teleporta e o olho perde de vista qual mensagem se moveu. */
    .user-bubble.just-settled {
        animation: settle-up 0.32s cubic-bezier(0.2, 0.8, 0.2, 1);
    }
    @keyframes settle-up {
        from { transform: translateY(14px); opacity: 0.6; }
        to   { transform: translateY(0);    opacity: 1; }
    }

    /* Movimento é decoração aqui: quem pediu menos animação recebe o estado
       final direto, sem perder informação nenhuma. */
    @media (prefers-reduced-motion: reduce) {
        .user-bubble.is-queued,
        .user-bubble.just-settled { animation: none; }
    }

    /* ─── ASSISTANT CONTENT ────────────────────────────────────────────────
       Sem card: sem background, sem borda, sem padding de contêiner.
       É texto ambiente na página — a resposta "é" a página, não um
       elemento dentro dela. Largura de leitura controlada por max-width
       em ch (medida tipográfica), não em px arbitrário de balão.
    */
    .assistant-content {
        width: 100%;
        max-width: 72ch;
        padding: 0;
        font-size: 1rem;
        line-height: 1.6;
        color: var(--txt);
        word-break: break-word;
        background: transparent;
        border: none;
    }
    .mobile .assistant-content {
        font-size: 0.9375rem;
        max-width: 100%;
    }
    .assistant-content.streaming {
        /* nenhuma alteração visual de "card" — apenas o cursor/dots indicam estado */
    }

    /* ─── STREAM CURSOR ────────────────────────────────────────────────── */
    :global(.stream-cursor) {
        display: inline-block;
        width: 1.5px;
        height: 1em;
        background: var(--txt);
        border-radius: 1px;
        margin-left: 2px;
        vertical-align: text-bottom;
        animation: cursor-fade 1s var(--ease-ui) infinite;
        opacity: 0.75;
    }
    @keyframes cursor-fade {
        0%,
        100% {
            opacity: 0.75;
        }
        50% {
            opacity: 0.08;
        }
    }

    :global(.table-container),
    :global(.d2-placeholder),
    :global(.markmap-placeholder) {
        margin: 10px 0;
        width: 100%;
    }

    /* ─── FILE CARD ────────────────────────────────────────────────────── */
    .file-card {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 14px;
        min-width: 240px;
        max-width: 360px;
        background: var(--surface);
        border: 0.75px solid var(--border);
        border-radius: 0.5rem;
        cursor: pointer;
        text-align: left;
        transition:
            background 0.18s var(--ease-ui),
            border-color 0.18s var(--ease-ui);
        animation: fade-up 0.25s var(--ease-ui) both;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile .file-card {
        min-width: unset;
        max-width: 100%;
    }
    .file-card:hover {
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border-color: var(--w15, rgba(255, 255, 255, 0.15));
    }
    .file-icon {
        width: 34px;
        height: 34px;
        border-radius: 8px;
        flex-shrink: 0;
        background: var(--w04, rgba(255, 255, 255, 0.04));
        border: 0.75px solid var(--border);
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--txt);
        transition: background 0.18s var(--ease-ui);
    }
    .file-card:hover .file-icon {
        background: var(--w07, rgba(255, 255, 255, 0.07));
    }
    .file-info {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        gap: 2px;
    }
    .file-name {
        font-size: 12px;
        font-weight: 500;
        color: var(--txt);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        letter-spacing: 0.005em;
    }
    .file-meta {
        font-size: 10px;
        color: var(--txt-3);
        font-family: var(--font-mono);
        letter-spacing: 0.02em;
    }
    .file-arrow {
        color: var(--txt-3);
        transition:
            color 0.18s var(--ease-ui),
            transform 0.22s var(--ease-spring);
        flex-shrink: 0;
    }
    .file-card:hover .file-arrow {
        color: var(--txt);
        transform: translateX(3px);
    }

    /* ─── MARKDOWN TYPOGRAPHY ──────────────────────────────────────────── */
    :global(.md h1),
    :global(.md h2),
    :global(.md h3),
    :global(.md h4) {
        font-family: var(--font-head);
        font-weight: 600;
        color: var(--txt);
        margin: 1.1em 0 0.4em;
        line-height: 1.25;
        letter-spacing: -0.02em;
    }
    :global(.md h1) {
        font-size: 2.25rem;
    }
    :global(.md h2) {
        font-size: 1.5rem;
    }
    :global(.md h3) {
        font-size: 1.125rem;
    }
    :global(.md p) {
        margin: 0 0 0.7em;
    }
    :global(.md p:last-child) {
        margin-bottom: 0;
    }
    :global(.md strong) {
        font-weight: 600;
        color: var(--txt);
    }
    :global(.md em) {
        font-style: italic;
        opacity: 0.78;
    }

    /* ─── CODE INLINE ──────────────────────────────────────────────────── */
    :global(.md code) {
        font-family: var(--font-mono);
        font-size: 12px;
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 5px;
        color: var(--txt);
    }

    /* ─── CODE BLOCK ───────────────────────────────────────────────────── */
    :global(.md pre) {
        background: rgba(0, 0, 0, 0.45);
        border: 0.75px solid var(--border);
        border-radius: 9px;
        padding: 13px 15px;
        overflow-x: auto;
        -webkit-overflow-scrolling: touch;
        margin: 0.8em 0;
        position: relative;
    }
    :global(.md pre code) {
        background: transparent;
        border: none;
        padding: 0;
        color: rgba(200, 200, 200, 0.72);
        font-size: 12px;
        line-height: 1.65;
        white-space: pre;
    }
    :global(.md .code-lang) {
        display: inline-block;
        font-family: var(--font-mono);
        font-size: 9px;
        letter-spacing: 0.1em;
        text-transform: uppercase;
        color: var(--txt-3);
        background: var(--w04, rgba(255, 255, 255, 0.04));
        border: 1px solid var(--border);
        border-radius: 3px;
        padding: 1px 6px 1px 5px;
        margin-bottom: 8px;
        line-height: 1.8;
    }

    /* ─── LISTS ────────────────────────────────────────────────────────── */
    :global(.md ul),
    :global(.md ol) {
        padding-left: 1.35em;
        margin: 0.4em 0 0.7em;
    }
    :global(.md li) {
        margin-bottom: 0.3em;
    }
    :global(.md a) {
        color: var(--txt);
        text-decoration: underline;
        text-underline-offset: 3px;
        text-decoration-color: var(--w25, rgba(255, 255, 255, 0.25));
        opacity: 0.85;
        transition:
            opacity 0.15s var(--ease-ui),
            text-decoration-color 0.15s var(--ease-ui);
    }
    :global(.md a:hover) {
        opacity: 1;
        text-decoration-color: var(--w60, rgba(255, 255, 255, 0.6));
    }
    :global(.md hr) {
        border: none;
        border-top: 1px solid var(--border);
        margin: 1em 0;
        opacity: 0.6;
    }
    :global(.html-placeholder) {
        display: none;
    }

    /* ─── BLOCKQUOTE ───────────────────────────────────────────────────── */
    :global(.md blockquote) {
        border-left: 1.5px solid var(--w12, rgba(255, 255, 255, 0.12));
        margin: 0.8em 0;
        padding: 6px 0 6px 14px;
        color: var(--txt-2);
        background: transparent;
        border-radius: 0;
        font-style: italic;
        opacity: 0.88;
    }
    :global(.md blockquote p) {
        margin-bottom: 0.3em;
    }
    :global(.md blockquote p:last-child) {
        margin-bottom: 0;
    }
    :global(.md blockquote blockquote) {
        margin: 0.4em 0;
        border-left-color: var(--w06, rgba(255, 255, 255, 0.06));
        opacity: 0.85;
    }

    /* ─── ADMONITIONS ──────────────────────────────────────────────────── */
    :global(.md .admonition) {
        border: 0.75px solid var(--border);
        border-left: 2.5px solid var(--txt-2);
        border-radius: 0 9px 9px 0;
        padding: 10px 14px;
        margin: 0.8em 0;
        background: var(--w015, rgba(255, 255, 255, 0.015));
    }
    :global(.md .admonition-title) {
        font-family: var(--font-mono);
        font-size: 9px;
        font-weight: 700;
        letter-spacing: 0.15em;
        text-transform: uppercase;
        margin-bottom: 6px;
        opacity: 0.95;
    }
    :global(.md .admonition-body) {
        font-size: 14px;
        line-height: 1.62;
    }
    :global(.md .admonition-body p:last-child) {
        margin-bottom: 0;
    }
    :global(.md .admonition-note) {
        border-left-color: #6ea8fe;
    }
    :global(.md .admonition-note .admonition-title) {
        color: #6ea8fe;
    }
    :global(.md .admonition-tip) {
        border-left-color: #5fd17a;
    }
    :global(.md .admonition-tip .admonition-title) {
        color: #5fd17a;
    }
    :global(.md .admonition-important) {
        border-left-color: #c79bff;
    }
    :global(.md .admonition-important .admonition-title) {
        color: #c79bff;
    }
    :global(.md .admonition-warning) {
        border-left-color: #f5c043;
    }
    :global(.md .admonition-warning .admonition-title) {
        color: #f5c043;
    }
    :global(.md .admonition-caution) {
        border-left-color: #ff6b6b;
    }
    :global(.md .admonition-caution .admonition-title) {
        color: #ff6b6b;
    }

    /* ─── TASK LIST ────────────────────────────────────────────────────── */
    :global(.md ul.task-list) {
        list-style: none;
        padding-left: 0;
    }
    :global(.md li.task-item) {
        display: flex;
        align-items: flex-start;
        gap: 7px;
        list-style: none;
        margin-bottom: 0.3em;
    }
    :global(.md .task-checkbox) {
        width: 14px;
        height: 14px;
        border-radius: 3px;
        flex-shrink: 0;
        border: 0.75px solid var(--border-hi);
        margin-top: 2px;
        display: flex;
        align-items: center;
        justify-content: center;
        color: var(--txt);
        background: var(--w015, rgba(255, 255, 255, 0.015));
        transition:
            background 0.15s var(--ease-ui),
            border-color 0.15s var(--ease-ui);
    }
    :global(.md .task-checkbox.checked) {
        background: var(--w10, rgba(255, 255, 255, 0.1));
        border-color: var(--w25, rgba(255, 255, 255, 0.25));
    }
    :global(.md .task-text) {
        flex: 1;
    }
    :global(.md li.task-item:has(.task-checkbox.checked) .task-text) {
        opacity: 0.5;
        text-decoration: line-through;
    }
    :global(.md img) {
        max-width: 100%;
        border-radius: 9px;
        margin: 0.5em 0;
        border: 0.75px solid var(--border);
        display: block;
    }
    :global(.md table) {
        width: 100%;
        border-collapse: collapse;
        margin: 0.7em 0;
        font-size: 13px;
    }
    :global(.md th),
    :global(.md td) {
        padding: 7px 9px;
        border: 1px solid var(--border);
        text-align: left;
        vertical-align: top;
    }
    :global(.md th) {
        background: var(--surface);
        color: var(--txt);
        font-weight: 600;
    }

    /* ─── FOOTNOTES ────────────────────────────────────────────────────── */
    :global(.md .footnote-ref a) {
        text-decoration: none;
        color: var(--txt);
        opacity: 0.65;
        font-size: 10px;
        padding: 0 1px;
        transition: opacity 0.15s var(--ease-ui);
    }
    :global(.md .footnote-ref a:hover) {
        opacity: 1;
    }
    :global(.md .footnotes) {
        margin-top: 16px;
    }
    :global(.md .footnotes hr) {
        margin-bottom: 9px;
    }
    :global(.md .footnotes-list) {
        font-size: 12px;
        color: var(--txt-3);
        padding-left: 1.4em;
        display: flex;
        flex-direction: column;
        gap: 4px;
    }
    :global(.md .footnote-back) {
        text-decoration: none;
        color: var(--txt-3);
        margin-left: 4px;
        transition: color 0.15s var(--ease-ui);
    }
    :global(.md .footnote-back:hover) {
        color: var(--txt);
    }

    .pending-text {
        opacity: 0.45;
        transition: opacity 0.35s var(--ease-ui);
    }

    /* ─── COPY BUTTON ────────────────────────────────────────────────────
       Sem mais bubble para ancorar — agora fica como um pequeno botão
       de texto abaixo da resposta (estilo "ação ambiente"), não mais
       sobreposto no canto de um card.
    */
    /* Rodapé de identificação do modelo — presente, nunca protagonista. */
    .model-tag {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 4px;
        font-family: var(--font-mono);
        font-size: 10px;
        letter-spacing: 0.02em;
        color: var(--txt-3);
        opacity: 0.55;
        transition: opacity 0.15s;
        cursor: default;
        max-width: 100%;
    }
    .model-tag:hover {
        opacity: 0.95;
    }
    .model-dot {
        width: 4px;
        height: 4px;
        border-radius: 50%;
        background: currentColor;
        flex-shrink: 0;
    }
    .model-name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .model-cost {
        font-variant-numeric: tabular-nums;
        color: var(--txt-2);
        white-space: nowrap;
    }
    .message-time {
        font-variant-numeric: tabular-nums;
        white-space: nowrap;
        opacity: .55;
    }

    .copy-btn {
        position: static;
        margin-top: 2px;
        width: 26px;
        height: 26px;
        border-radius: 6px;
        border: 0.75px solid transparent;
        background: transparent;
        color: var(--txt-3);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0.45;
        transition:
            opacity 0.18s var(--ease-ui),
            background 0.18s var(--ease-ui),
            border-color 0.18s var(--ease-ui),
            color 0.18s var(--ease-ui),
            transform 0.15s var(--ease-spring);
        z-index: 2;
        padding: 0;
        -webkit-tap-highlight-color: transparent;
    }
    .message-actions {
        display: inline-flex;
        align-items: center;
        gap: 2px;
        margin-top: 2px;
    }
    .feedback-btn {
        width: 26px;
        height: 26px;
        padding: 0;
        border: 0.75px solid transparent;
        border-radius: 6px;
        background: transparent;
        color: var(--txt-3);
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        opacity: 0.45;
        transition: transform 200ms ease-out, opacity 200ms ease-out, background 200ms ease-out, border-color 200ms ease-out, color 200ms ease-out;
    }
    .feedback-btn:hover, .feedback-btn.active {
        opacity: 1;
        color: var(--txt);
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border-color: var(--border);
    }
    .feedback-btn:active { transform: scale(0.9); }
    .feedback-panel {
        display: grid;
        gap: 8px;
        max-width: 360px;
        margin-top: 5px;
        padding: 10px;
        border: 1px solid var(--border);
        border-radius: var(--tk-radius-md, 8px);
        background: var(--surface);
        color: var(--txt-2);
        font: 12px var(--font-body, system-ui, sans-serif);
    }
    .feedback-panel label { color: var(--txt); font-weight: 500; }
    .feedback-panel select, .feedback-panel textarea {
        width: 100%;
        box-sizing: border-box;
        border: 1px solid var(--border-hi);
        border-radius: 6px;
        padding: 7px 8px;
        background: var(--bg-elevated);
        color: var(--txt);
        font: inherit;
    }
    .feedback-panel textarea { min-height: 54px; resize: vertical; }
    .feedback-panel-actions { display: flex; justify-content: flex-end; gap: 7px; }
    .feedback-panel-actions button {
        border: 1px solid var(--border-hi);
        border-radius: 6px;
        padding: 5px 8px;
        background: transparent;
        color: var(--txt-2);
        font: inherit;
        cursor: pointer;
    }
    .feedback-panel-actions button[type="submit"] { background: var(--accent, var(--txt)); color: var(--tk-on-accent, var(--bg)); }
    .feedback-panel-actions button:disabled { cursor: not-allowed; opacity: .45; }
    .copy-btn:hover {
        opacity: 0.9;
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border-color: var(--border);
        color: var(--txt);
    }
    .copy-btn:active {
        transform: scale(0.9);
        opacity: 1;
    }
    .copy-btn.copied {
        opacity: 1;
        background: var(--w05, rgba(255, 255, 255, 0.05));
        border-color: var(--border);
        color: var(--txt);
    }
    .copy-tooltip {
        position: absolute;
        bottom: calc(100% + 5px);
        left: 50%;
        transform: translateX(-50%);
        font-size: 10px;
        font-family: var(--font-mono);
        letter-spacing: 0.04em;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        color: var(--txt);
        padding: 3px 8px;
        border-radius: 4px;
        white-space: nowrap;
        pointer-events: none;
        animation: fade-up 0.14s var(--ease-ui) both;
    }
    @media (hover: none) and (pointer: coarse) {
        .copy-btn {
            opacity: 0.6;
            width: 32px;
            height: 32px;
        }
        .copy-btn svg {
            width: 14px;
            height: 14px;
        }
    }

    .embedded-component-wrap {
        position: relative;
    }

    /* ── Card de permissão (claude-cli interativo) ─────────────────────── */
    .perm-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
        margin: 8px 0;
    }
    .perm-card {
        border: 1px solid rgba(180, 140, 40, 0.45);
        background: rgba(210, 160, 40, 0.08);
        border-radius: 10px;
        padding: 10px 12px;
        font-size: 13px;
    }
    .perm-card.allow {
        border-color: rgba(60, 170, 90, 0.45);
        background: rgba(60, 170, 90, 0.08);
    }
    .perm-card.deny {
        border-color: rgba(200, 70, 70, 0.45);
        background: rgba(200, 70, 70, 0.08);
        opacity: 0.85;
    }
    .perm-head {
        display: flex;
        align-items: center;
        gap: 6px;
    }
    .perm-title {
        opacity: 0.9;
    }
    .perm-input {
        display: block;
        margin: 6px 0 0;
        padding: 5px 8px;
        background: rgba(0, 0, 0, 0.18);
        border-radius: 6px;
        font-size: 12px;
        word-break: break-all;
        white-space: pre-wrap;
    }
    .perm-actions {
        display: flex;
        gap: 8px;
        margin-top: 10px;
    }
    .perm-btn {
        border: none;
        border-radius: 7px;
        padding: 6px 14px;
        font-size: 12.5px;
        font-weight: 600;
        cursor: pointer;
    }
    .perm-btn.allow {
        background: #2e9e57;
        color: #fff;
    }
    .perm-btn.deny {
        background: transparent;
        color: #c74646;
        border: 1px solid rgba(200, 70, 70, 0.5);
    }
    .perm-btn:hover {
        filter: brightness(1.08);
    }
    .perm-verdict {
        margin-top: 8px;
        font-weight: 600;
        font-size: 12.5px;
    }
    .perm-verdict.allow {
        color: #2e9e57;
    }
    .perm-verdict.deny {
        color: #c74646;
    }
</style>
