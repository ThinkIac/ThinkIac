<script>
    import { onMount } from "svelte";
    import { api } from "../api";
    import { emitLocal as busEmitLocal, on as busOn } from "../lib/bus.js";
    import { resolveNotificationDeepLink } from "../lib/deep_link.js";

    // Fallback para notificações gravadas antes do campo dismissAfterMs existir.
    const AUTO_DISMISS_MS = 7000;
    let items = [];
    let toast = null;
    let closeTimer = null;
    let paused = false;
    let sources = [];
    let answer = "";
    let sending = false;
    let promptInput = null;
    let remainingMs = null;
    let startedAt = 0;

    $: unreadCount = items.length;
    $: interaction = toast?.interaction || null;
    $: dismissMs = dismissMsFor(toast);

    // Função, e não variável reativa: scheduleClose() roda dentro do mesmo
    // bloco síncrono que troca o toast, quando um `$:` ainda traria o valor
    // da notificação anterior.
    function dismissMsFor(notification) {
        // Uma pergunta não some sozinha, senão a resposta se perde no tempo.
        if (!notification || notification.interaction) return null;
        return notification.dismissAfterMs ?? AUTO_DISMISS_MS;
    }

    function setToast(notification) {
        toast = notification;
        paused = false;
        answer = "";
        sending = false;
        remainingMs = null;
        scheduleClose();
        if (notification?.interaction?.type === "prompt") {
            setTimeout(() => promptInput?.focus(), 60);
        }
    }

    function closeToast() {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        remainingMs = null;
        toast = null;
    }

    function scheduleClose() {
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        if (paused) return;
        const ms = remainingMs ?? dismissMsFor(toast);
        if (!ms) return;
        remainingMs = ms;
        startedAt = Date.now();
        closeTimer = setTimeout(closeToast, ms);
    }

    function pauseToast() {
        if (!window.matchMedia("(hover: hover)").matches) return;
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = null;
        // A barra é CSS e congela onde está; o timer precisa retomar pelo
        // tempo que sobrou, senão o toast some fora de hora com a barra cheia.
        if (remainingMs != null) remainingMs = Math.max(0, remainingMs - (Date.now() - startedAt));
        paused = true;
    }

    function resumeToast() {
        if (paused) {
            paused = false;
            scheduleClose();
        }
    }

    async function remove(notification) {
        if (!notification?.id) return;
        await api(`/inbox/${encodeURIComponent(notification.id)}`, "DELETE", null, "ntfy");
        items = items.filter((item) => item.id !== notification.id);
        if (toast?.id === notification.id) closeToast();
    }

    async function respond(action) {
        if (!toast || sending) return;
        const notification = toast;
        const value = action === "submit" ? answer.trim() : null;
        if (action === "submit" && !value) {
            promptInput?.focus();
            return;
        }

        sending = true;
        try {
            await api(
                `/inbox/${encodeURIComponent(notification.id)}/respond`,
                "POST",
                { action, value },
                "ntfy",
            );
            items = items.filter((item) => item.id !== notification.id);
            if (toast?.id === notification.id) closeToast();
        } catch (error) {
            sending = false;
            console.warn("[ntfy] resposta não registrada:", error?.message || error);
        }
    }

    function onPromptKey(event) {
        if (event.key === "Enter") {
            event.preventDefault();
            respond("submit");
        } else if (event.key === "Escape") {
            event.preventDefault();
            respond("cancel");
        }
    }

    async function activate(notification) {
        // O corpo do card só navega quando a notificação não espera resposta.
        if (notification?.interaction) return;
        const target = resolveNotificationDeepLink(notification?.click, window.location.origin);
        if (!target) return;

        // Só consome a notificação depois de reconhecer um destino. Deep-links
        // internos percorrem o bus e, portanto, preservam a shell e as abas.
        await remove(notification);
        if (target.type === "external") {
            window.open(target.href, "_blank", "noopener,noreferrer");
            return;
        }
        busEmitLocal("agent:deep-link", target);
    }

    async function clearAll() {
        await api("/inbox", "DELETE", null, "ntfy");
        items = [];
        closeToast();
    }

    async function receive(payload) {
        if (!payload?.message && !payload?.body) return;
        const result = await api("/inbox", "POST", payload, "ntfy");
        const notification = result?.notification;
        if (!notification) return;
        items = [notification, ...items.filter((item) => item.id !== notification.id)]
            .sort((a, b) => b.receivedAt - a.receivedAt);
        setToast(notification);
    }

    function subscribe(channel) {
        const base = String(channel?.url || "https://ntfy.sh").replace(/\/+$/, "");
        const topic = encodeURIComponent(channel?.topic || "");
        if (!topic || typeof EventSource === "undefined") return;
        const source = new EventSource(`${base}/${topic}/sse`);
        source.onmessage = (event) => {
            try {
                const payload = JSON.parse(event.data);
                if (payload.event === "message") receive(payload);
            } catch {
                // Ignora keep-alives e mensagens SSE que não sejam JSON ntfy.
            }
        };
        sources.push(source);
    }

    function notificationSessionId(notification) {
        if (!notification?.click) return null;
        try {
            const url = new URL(notification.click, window.location.origin);
            if (url.searchParams.get("open") !== "chat") return null;
            return url.searchParams.get("session");
        } catch {
            return null;
        }
    }

    function consumeSessionNotifications({ sessionId } = {}) {
        if (!sessionId) return;
        items = items.filter((item) =>
            item.interaction || notificationSessionId(item) !== sessionId,
        );
        if (!toast?.interaction && notificationSessionId(toast) === sessionId) closeToast();
    }

    onMount(() => {
        const offSessionRead = busOn("ntfy:session-read", consumeSessionNotifications);
        let disposed = false;

        Promise.all([
            api("/inbox", "GET", null, "ntfy"),
            api("/channels", "GET", null, "ntfy"),
        ]).then(([saved, channels]) => {
            if (disposed) return;
            items = Array.isArray(saved) ? saved : [];
            for (const channel of Array.isArray(channels) ? channels : []) subscribe(channel);
        });

        return () => {
            disposed = true;
            if (closeTimer) clearTimeout(closeTimer);
            sources.forEach((source) => source.close());
            sources = [];
            offSessionRead();
        };
    });
</script>

<div class="ntfy-root" aria-live="polite">
    {#if toast}
        <article
            class="toast"
            class:interactive={interaction}
            on:mouseenter={pauseToast}
            on:mouseleave={resumeToast}
            on:click={() => activate(toast)}
            role={interaction ? "alertdialog" : "status"}
            aria-label={interaction ? toast.title : undefined}
            tabindex="0"
        >
            <div class="toast-head">
                <div class="toast-icon"><svg viewBox="0 0 20 20" fill="none" width="17" height="17" aria-hidden="true"><path d="M10 2.5v9m0 3.5h.01M3.6 16.5h12.8c.8 0 1.3-.87.9-1.56L10.9 3.8a1.04 1.04 0 0 0-1.8 0L2.7 14.94c-.4.69.1 1.56.9 1.56Z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></div>
                <div class="toast-copy"><strong>{toast.title}</strong><p class:wrap={interaction}>{toast.message}</p></div>
                <button class="dismiss" on:click|stopPropagation={() => (interaction ? respond("cancel") : remove(toast))} aria-label={interaction ? "Cancelar" : "Dispensar notificação"}><svg viewBox="0 0 16 16" fill="none" width="15" height="15"><path d="m4 4 8 8m0-8-8 8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
            </div>

            {#if interaction?.type === "prompt"}
                <div class="toast-form">
                    <input
                        bind:this={promptInput}
                        bind:value={answer}
                        on:keydown={onPromptKey}
                        placeholder="Sua resposta"
                        disabled={sending}
                        aria-label="Resposta"
                    />
                    <div class="toast-actions">
                        <button class="ghost" on:click={() => respond("cancel")} disabled={sending}>Cancelar</button>
                        <button class="primary" on:click={() => respond("submit")} disabled={sending || !answer.trim()}>Enviar</button>
                    </div>
                </div>
            {:else if interaction?.type === "confirm"}
                <div class="toast-actions">
                    <button class="ghost" on:click={() => respond("cancel")} disabled={sending}>Cancelar</button>
                    <button class="primary" on:click={() => respond("confirm")} disabled={sending}>Confirmar</button>
                </div>
            {:else if dismissMs}
                {#key toast.id}
                    <div class="timebar" aria-hidden="true">
                        <span style="animation-duration: {dismissMs}ms" class:paused></span>
                    </div>
                {/key}
            {/if}
        </article>
    {/if}

</div>

<style>
    .ntfy-root { position: fixed; z-index: 200; top: 0; right: 0; color: var(--txt); font-family: var(--font-body); pointer-events: none; }
    .toast { position: fixed; top: calc(var(--safe-top, 0px) + 60px); right: 18px; width: min(360px, calc(100vw - 36px)); padding: 13px 13px 0; border: 1px solid var(--border-hi); border-radius: var(--r-lg); background: var(--bg-elevated); box-shadow: 0 2px 8px rgba(0,0,0,.08); cursor: pointer; pointer-events: auto; overflow: hidden; animation: enter 240ms ease-out both; }
    .toast.interactive { cursor: default; padding-bottom: 13px; }
    .toast-head { display: flex; gap: 11px; align-items: flex-start; }
    .toast-icon { flex: 0 0 31px; height: 31px; display: grid; place-items: center; border-radius: 9px; background: var(--accent-dim); color: var(--txt); }
    .toast-copy { min-width: 0; flex: 1; padding-top: 1px; } .toast-copy strong, .inbox-item strong { display: block; font-size: 13px; font-weight: 600; line-height: 1.25; } .toast-copy p, .inbox-item p { margin: 3px 0 0; color: var(--txt-2); font-size: 12px; line-height: 1.35; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
    .toast-copy p.wrap { white-space: normal; overflow: visible; }
    .dismiss, .inbox-item button { flex: 0 0 auto; display: grid; place-items: center; width: 26px; height: 26px; border: 0; border-radius: 7px; background: transparent; color: var(--txt-2); cursor: pointer; } .dismiss:hover, .inbox-item button:hover { background: var(--overlay-2); color: var(--txt); }

    /* ── Resposta (confirm / prompt) ── */
    .toast-form { margin-top: 11px; }
    .toast-form input { width: 100%; padding: 8px 10px; border: 1px solid var(--border-hi); border-radius: var(--r-md, 9px); background: var(--bg); color: var(--txt); font: inherit; font-size: 13px; }
    .toast-form input:focus { outline: none; border-color: var(--accent); }
    .toast-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 10px; }
    .toast-actions button { padding: 7px 14px; border-radius: var(--r-md, 9px); border: 1px solid transparent; font: inherit; font-size: 12.5px; font-weight: 600; cursor: pointer; }
    .toast-actions button:disabled { opacity: .5; cursor: default; }
    .toast-actions .ghost { border-color: var(--border-hi); background: transparent; color: var(--txt-2); }
    .toast-actions .ghost:hover:not(:disabled) { background: var(--overlay-2); color: var(--txt); }
    .toast-actions .primary { background: var(--accent); color: var(--accent-txt, #fff); }
    .toast-actions .primary:hover:not(:disabled) { filter: brightness(1.07); }

    /* ── Barra de tempo ── */
    .timebar { margin: 11px -13px 0; height: 3px; background: var(--overlay-2); }
    /* transform-origin à direita: a barra se consome da esquerda para a direita. */
    .timebar span { display: block; height: 100%; background: var(--accent); transform-origin: right; animation-name: drain; animation-timing-function: linear; animation-fill-mode: forwards; }
    .timebar span.paused { animation-play-state: paused; }
    @keyframes drain { from { transform: scaleX(1); } to { transform: scaleX(0); } }

    @keyframes enter { from { opacity: 0; transform: translateY(-8px) scale(.985); } to { opacity: 1; transform: translateY(0) scale(1); } }
    @media (prefers-reduced-motion: reduce) { .toast { animation: none; } .timebar span { animation-duration: 0s !important; transform: scaleX(1); } }
    @media (max-width: 767px) { .toast { top: calc(var(--safe-top, 0px) + 55px); right: 12px; width: calc(100vw - 24px); border-radius: 16px; padding: 14px 14px 0; } .toast.interactive { padding-bottom: 14px; } .timebar { margin: 12px -14px 0; } }
</style>
