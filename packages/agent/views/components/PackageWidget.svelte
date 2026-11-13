<script>
    // PackageWidget — renderer genérico para widgets contribuídos por PACOTES.
    // Renderiza a view do pacote num <iframe> e passa o conteúdo do bloco via
    // location.hash (#data=<base64(json)>). O iframe pode:
    //   • reportar altura:  parent.postMessage({source:"agent", type:"widget:height", detail:<px>}, "*")
    //   • abrir outro app:  parent.postMessage({source:"agent", type:"open:app", detail:"pkg"}, "*")
    // (o open:app é tratado pela ponte global do bus.js).
    import { createEventDispatcher, onMount } from "svelte";

    export let url;              // URL da view do pacote (vinda do registry/propMap)
    export let source = "";      // conteúdo do bloco markdown
    export let title = "widget"; // usado como iframe title (a11y)
    export let flat = false;     // sem caixa/borda — usado no Sidebar (rail é sempre flat)
    // edit=true põe a view em modo de configuração: passamos `mode:"edit"` no
    // payload (hash) e o pacote decide renderizar seu "Widget de Edição do
    // Widget" (ex.: "Escolha o modelo" em Tasks) em vez do widget normal. O
    // pacote persiste a própria config; ao sair da edição o menu recarrega o
    // widget já configurado (o `key` no Sidebar remonta o iframe).
    export let edit = false;

    const dispatch = createEventDispatcher();
    let iframeEl;
    // No Sidebar (flat) o conteúdo costuma ser bem mais baixo que o padrão
    // usado nos widgets de chat — começar menor evita sobrar espaço em
    // branco até a primeira medição (widget:height) chegar.
    let height = flat ? 60 : 220;

    $: src = buildSrc(url, source, edit);

    function buildSrc(u, s, isEdit) {
        if (!u) return "about:blank";
        try {
            const payload = btoa(
                unescape(encodeURIComponent(JSON.stringify(
                    isEdit ? { source: s, mode: "edit" } : { source: s },
                ))),
            );
            const sep = u.includes("#") ? "&" : "#";
            return `${u}${sep}data=${payload}`;
        } catch {
            return u;
        }
    }

    function onMessage(ev) {
        const msg = ev?.data;
        if (!msg || typeof msg !== "object" || !["agent", "aurora"].includes(msg.source)) return;
        // Selections are accepted only from this same-origin widget/session.
        if (["widget:selection", "widget:state"].includes(msg.type) && ev.source === iframeEl?.contentWindow
            && ev.origin === window.location.origin && msg.detail?.sessionId === source) {
            dispatch(msg.type === "widget:selection" ? "selection" : "state", msg.detail);
        }
        if (msg.type === "widget:height" && ev.source === iframeEl?.contentWindow) {
            const h = Number(msg.detail);
            if (Number.isFinite(h) && h > 0) height = Math.min(h, 2000);
        }
    }

    // Cleanup no return do onMount (só cliente): no SSR o Svelte roda onDestroy
    // ao fim do render e `window` não existe no servidor.
    onMount(() => {
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    });
</script>

<!-- allow-modals no sandbox: sem ele o navegador bloqueia confirm()/alert()
     do conteúdo embutido — e o confirm() devolve false na hora, sem exibir
     nada. Toda ação que pede confirmação vira um clique que "não faz nada".
     allow-downloads preserva o atributo download dos mini-apps, como Junta PDF. -->
<div class="pkg-widget" class:flat style="height:{height}px">
    <iframe
        bind:this={iframeEl}
        {src}
        {title}
        scrolling="no"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
    ></iframe>
</div>

<style>
    .pkg-widget {
        width: 100%;
        border: 1px solid var(--w12, rgba(255, 255, 255, 0.12));
        border-radius: 12px;
        overflow: hidden;
        background: var(--panel, rgba(0, 0, 0, 0.15));
        transition: height 0.2s ease;
    }
    .pkg-widget:not(.flat) {
        margin: 4px 0;
    }
    .pkg-widget.flat {
        border: none;
        border-radius: 0;
        background: transparent;
    }
    .pkg-widget iframe {
        width: 100%;
        height: 100%;
        border: 0;
        display: block;
    }
</style>
