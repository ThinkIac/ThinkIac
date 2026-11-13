<script>
    // Faixa de opt-in de notificações, acoplada logo acima do InputBar (estilo
    // "complemento" com contraste, tipo Claude Code). Só aparece dentro do app
    // nativo — detectado pela presença do canal JS `window.FlutterBridge` (o
    // mesmo sinal usado em Apps.svelte). O prop `appId` NÃO serve de gatilho:
    // ele se perde no query após o login e nem sempre chega ao Home; usá-lo pra
    // decidir a visibilidade fazia o card nunca aparecer. No navegador puro
    // (sem FlutterBridge) a faixa nunca aparece.
    import { onMount } from "svelte";
    import { slide } from "svelte/transition";

    export let appId = undefined;

    const APPID_KEY = "thinkiac_app_id";

    let nativeShell = false;
    let busy = false;

    // Visibilidade guiada por ESTADO real (não mais por um flag "done" único):
    //   • perm          — estado completo do Android, reportado pelo
    //                     shell nativo (window.__thinkiacNotifPerm); "" = ainda
    //                     não sabemos. Numa WebView o web não enxerga a
    //                     permissão sozinho, então o main.dart injeta isso.
    //   • dismissed     — "Agora não" esconde só nesta sessão (reaparece ao
    //                     reabrir o app enquanto faltar canal ou permissão).
    let perm = "";
    // Só consideramos a permissão na visibilidade DEPOIS que o shell nativo a
    // reportar ao menos uma vez. Sem isso, um APK antigo (que não reporta
    // permissão) deixaria o card preso "sempre visível"; com o guard, ele cai
    // graciosamente no comportamento por-canal (Parte A) até o APK novo chegar.
    let permReported = false;

    // O appId (= topic do ntfy do device) só é usado pra registrar o canal.
    // Como o prop pode não chegar, resolvemos de várias fontes.
    function resolveAppId() {
        if (appId) return appId;
        if (typeof window === "undefined") return "";
        try {
            const q = new URLSearchParams(window.location.search).get("appId");
            if (q) return q;
        } catch {}
        if (window.__thinkiacAppId) return window.__thinkiacAppId;
        try {
            const s = localStorage.getItem(APPID_KEY);
            if (s) return s;
        } catch {}
        return "";
    }

    function readPerm() {
        try {
            if (window.__thinkiacNotifPerm) {
                perm = window.__thinkiacNotifPerm;
                permReported = true;
            }
        } catch {}
    }

    onMount(() => {
        nativeShell = typeof window !== "undefined" && !!window.FlutterBridge;
        // Persiste o appId assim que o virmos, pra sobreviver a navegações que
        // droparem o ?appId= da URL.
        const id = resolveAppId();
        if (id) {
            try {
                localStorage.setItem(APPID_KEY, id);
            } catch {}
        }
        if (!nativeShell) return;

        // Estado inicial: lê a permissão já injetada (se o shell reportou antes
        // de montarmos) e escuta futuras atualizações; pede uma leitura fresca;
        // e checa se o canal do device já existe.
        readPerm();
        window.addEventListener("thinkiac:notif-perm", readPerm);
        try {
            window.FlutterBridge?.postMessage("check-notif-perm");
        } catch {}
        return () => window.removeEventListener("thinkiac:notif-perm", readPerm);
    });

    // Aparece até o Android confirmar permissão e serviço ativos.
    $: visible =
        nativeShell &&
        (!permReported || perm !== "active");

    async function ativar() {
        if (busy) return;
        busy = true;
        // Pede ao shell nativo pra abrir as telas de permissão de
        //    notificação + uso em background (foreground service). Sem o shell
        //    nativo (FlutterBridge ausente) isso é um no-op silencioso.
        try {
            window.FlutterBridge?.postMessage("enable-notifications");
        } catch {}
        // O Flutter só responde "active" depois que permissão e serviço
        // estiverem ativos. O card não depende de um pacote HTTP opcional.
        try {
            window.FlutterBridge?.postMessage("check-notif-perm");
        } catch {}
        busy = false;
    }
</script>

{#if visible}
    <div class="notify-optin" role="region" aria-label="Notifications" transition:slide={{ duration: 180 }}>
        <span class="icon" aria-hidden="true">
            <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
                <path
                    d="M10 2.5a4.5 4.5 0 0 0-4.5 4.5c0 3.2-1 4.6-1.6 5.3-.3.3-.1.9.4.9h11.4c.5 0 .7-.6.4-.9-.6-.7-1.6-2.1-1.6-5.3A4.5 4.5 0 0 0 10 2.5ZM8.4 16a1.7 1.7 0 0 0 3.2 0"
                    stroke="currentColor"
                    stroke-width="1.4"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                />
            </svg>
        </span>
        <div class="copy">
            <strong>Turn on notifications?</strong>
            <span>We'll ping you when something is ready — even with the app closed.</span>
        </div>
        <button class="activate" on:click={ativar} disabled={busy}>
            {busy ? "Enabling…" : "Enable"}
        </button>
    </div>
{/if}

<style>
    /* Cartão independente do composer: a borda e os cantos completos evitam
       que a confirmação pareça uma extensão do InputBar. */
    .notify-optin {
        position: relative;
        display: flex;
        align-items: center;
        gap: 10px;
        margin: 0 8px 4px;
        padding: 10px 12px;
        border: 1px solid var(--border-hi);
        border-radius: var(--r-md);
        background: var(--surface);
        color: var(--txt);
        font-family: var(--font-body);
    }
    .icon {
        flex: 0 0 auto;
        display: grid;
        place-items: center;
        width: 28px;
        height: 28px;
        border-radius: 8px;
        background: var(--accent-dim);
        color: var(--txt);
    }
    .copy {
        flex: 1;
        min-width: 0;
        display: flex;
        flex-direction: column;
        line-height: 1.25;
    }
    .copy strong {
        font-size: 13px;
        font-weight: 600;
        letter-spacing: -0.01em;
    }
    .copy span {
        margin-top: 2px;
        font-size: 11.5px;
        color: var(--txt-2);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
    }
    .activate {
        flex: 0 0 auto;
        height: 30px;
        padding: 0 14px;
        border: 0;
        border-radius: 8px;
        background: var(--txt);
        color: var(--surface);
        font: 600 12px var(--font-body);
        cursor: pointer;
        transition:
            filter 0.15s ease,
            transform 0.15s ease;
    }
    .activate:hover:not(:disabled) {
        filter: brightness(1.08);
    }
    .activate:active:not(:disabled) {
        transform: scale(0.97);
    }
    .activate:disabled {
        opacity: 0.6;
        cursor: default;
    }
    .activate:focus-visible,
    .notify-optin:focus-visible {
        outline: 2px solid var(--txt);
        outline-offset: 2px;
    }
    @media (max-width: 480px) {
        .notify-optin {
            gap: 8px;
            padding: 9px 10px 10px;
        }
        .icon {
            display: none;
        }
        .copy span {
            display: none;
        }
    }
    @media (prefers-reduced-motion: reduce) {
        .activate,
        .activate:active:not(:disabled) {
            transform: none;
        }
    }
</style>
