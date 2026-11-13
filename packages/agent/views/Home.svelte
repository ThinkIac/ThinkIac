<script>
    import { retryTurnInput } from './lib/retry-turn.js';
    import { onMount, tick } from "svelte";
    import { FILE_MANAGER_PREVIEW_EVENT, filePreviewUrl } from "../../file-manager/views/lib/protocol.js";

    import Sidebar from "./Sidebar.svelte";
    import MessageList from "./MessageList.svelte";
    import Canvas from "./Canvas.svelte";
    import SessionTabs from "./SessionTabs.svelte";

    import StructuredInput from "./components/StructuredInput.svelte";
    import SigmaLoader from "./components/SigmaLoader.svelte";
    import ActivitySlot from "./components/ActivitySlot.svelte";
    import InputBar from "./InputBar2.svelte";
    import NotifyOptIn from "./components/NotifyOptIn.svelte";

    import { api } from "./api";
    import {
        $ as busEmit,
        on as busOn,
        emitLocal as busEmitLocal,
        setServerForwarder,
        createGestureRouter,
        createIframeGestureBridge,
        installNativeGestureBridge,
        installEdgeSwipeDetector,
    } from "./lib/bus.js";
    import { bootstrapPackageWidgets } from "./lib/widget_bootstrap.js";
    import { bootstrapMessageActions } from "./lib/message_actions.js";
    import { bootstrapMenuItems } from "./lib/menu_bootstrap.js";
    import { bootstrapBackgroundViews, publishBackgroundContext, disposeBackgroundViews } from "./lib/background_bootstrap.js";
    import { createNewTopicWorkspace } from "./lib/new_topic.js";
    import { closeAllChatTabs, closeChatTab } from "./lib/chat_tabs.js";
    import { closeAllAppTabs } from "./lib/app_tabs.js";
    import { copyMessageTiming } from "./lib/message_time.js";
    import { hasPackage } from "./lib/optional_packages.js";
    import { adjacentTabId, desktopShortcutAction, isEditableShortcutTarget, isTextEditingShortcut } from "./lib/desktop_shortcuts.js";
    import {
        clearComposerDraft,
        loadComposerDraft,
        saveComposerDraft,
    } from "./lib/composer_drafts.js";
    import * as chatSocket from "./chatSocket.js";

    import {
        saveSessionState,
        restoreSessionState,
        clearSessionState,
    } from "./persistence.js";
    import { applyThemeToDocument, getTheme, setTheme, THEME_KEY } from "./theme.js";
    import { registerProfileScope } from "./lib/profiles_bootstrap.js";

    // ── GET params ───────────────────────────────────────────────────
    export let open; // "chat" | "app" | "result" — deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
    export let session; // sessionId para open=chat
    export let app; // id do app (getActiveApps/getPackageViews) para open=app
    // open=result: um job de pacote terminou. Se `file` foi produzido e o
    // File Manager está instalado, abre o app de arquivos com o arquivo
    // selecionado; senão abre o próprio app do pacote (`pkg`) na tela de
    // resultado. Usado pela notificação de "pronto" do cnpj-search.
    export let pkg; // nome do pacote de origem (ex.: "cnpj-scraper")
    export let file; // caminho relativo do resultado (ex.: "uploads/companies/x.csv")
    // appId é o id de instalação do device (mesmo valor em toda navegação
    // dentro do app nativo, não só em deep-links) — usado só pra detectar
    // "estou rodando dentro do app nativo" (ver uso no safe-area abaixo).
    export let appId;
    // O Desktop instancia o chat no canvas como widget nativo. A lógica de
    // sessão, WebSocket, streaming e composer permanece exatamente a mesma;
    // somente os elementos de navegação do shell são omitidos.
    export let desktopWidget = false;

    // ── Tema (black default / white) ─────────────────────────────────
    let theme = "dark";
    let ntfyAvailable = false;

    async function refreshOptionalPackages() {
        try {
            const apps = await api("/apps/list", "GET", null, "aura-system");
            ntfyAvailable = hasPackage(apps, "ntfy");
        } catch {
            ntfyAvailable = false;
        }
    }

    function handleToggleTheme() {
        theme = theme === "dark" ? "light" : "dark";
        setTheme(theme);
        anunciarTema();
    }

    // outros componentes (ex: Apps.svelte, para variante de ícone por tema)
    // não têm acesso a este `theme` local — avisa via window event em vez de
    // introduzir um store global só pra isso.
    function anunciarTema() {
        window.dispatchEvent(new CustomEvent("think:theme-changed", { detail: theme }));
    }

    // O tema é um escopo de perfil de configuração: cada perfil carrega o
    // próprio. Trocar de perfil reescreve a chave e chama este hydrate, que é
    // quem repinta a UI (a variável reativa do tema vive aqui) e avisa os
    // iframes. Registrado no corpo do módulo, junto com os outros escopos.
    registerProfileScope({
        key: THEME_KEY,
        hydrate() {
            theme = getTheme();
            anunciarTema();
        },
    });

    // ── Loading screen ──────────────────────────────────────────────
    let showLoading = true;

    // ── Offline / reconnect ─────────────────────────────────────────
    let isOnline = true;
    let wasOffline = false;
    let reconnecting = false;
    let reconnectTimer = null;

    function processAssistantMessage(msg) {
        if (msg.role === "assistant" && msg.content) {
            const match = msg.content.match(/```thinkiac\s*([\s\S]+?)\s*```/);
            if (match) {
                try {
                    const cleanJson = match[1].replace(/\u00a0/g, " ").trim();
                    msg._structuredData = JSON.parse(cleanJson);
                    // Remove o bloco do conteúdo visual da mensagem imediatamente
                    msg.content = msg.content.replace(match[0], "").trim();
                } catch (err) {
                    console.error(
                        "❌ Erro ao processar JSON de 'thinkiac':",
                        err,
                    );
                    msg._structuredData = null;
                }
            }
            // A IA também pode anexar arquivos: o marcador vira anexo
            // renderizado no lugar do texto cru.
            const refs = extractAttachmentRefs(msg.content);
            if (refs.attachments.length) {
                msg.content = refs.content;
                msg.attachments = mergeAttachments(
                    msg.attachments,
                    refs.attachments,
                );
            }
        }
        return msg;
    }

    function handleOnline() {
        isOnline = true;
        reconnecting = false;
        if (reconnectTimer) {
            clearInterval(reconnectTimer);
            reconnectTimer = null;
        }
        if (wasOffline) {
            wasOffline = false;
            // Pequeno delay para o servidor estabilizar
            setTimeout(() => {
                loadSystem();
            }, 800);
        }
    }

    // ── Estado do Componente Estruturado ───────────────────────────
    let structuredProps = null; // Inicializa oculto por padrão

    // Reatividade: Monitora o histórico e reage à última mensagem terminada
    $: lastMessage =
        history && history.length > 0 ? history[history.length - 1] : null;

    // Derivação direta: Se a última mensagem tiver dados estruturados, exibe o input correspondente
    $: structuredProps =
        lastMessage &&
        lastMessage.role === "assistant" &&
        !lastMessage.streaming
            ? lastMessage._structuredData
                ? Array.isArray(lastMessage._structuredData)
                    ? lastMessage._structuredData
                    : [lastMessage._structuredData]
                : null
            : null;

    function onEscape() {
        if (lastMessage) {
            lastMessage._structuredData = null;
            history = [...history]; // Força o Svelte a atualizar a UI e reverter para a InputBar normal
        }
    }

    // A LLM retorna um bloco JSON? Ative o componente:
    function handleLLMResponse(response) {
        if (response.structuredInput) {
            structuredProps = response.structuredInput;
        }
    }

    async function discardResolvedGovernanceCard(sid) {
        const message = history?.[history.length - 1];
        const steps = Array.isArray(message?._structuredData)
            ? message._structuredData
            : message?._structuredData ? [message._structuredData] : [];
        const decisionId = steps.find((step) => step?.governanceDecisionId)?.governanceDecisionId;
        if (!decisionId) return;
        try {
            const response = await fetch(`/governance/confirmations/pending?sessionId=${encodeURIComponent(sid)}`);
            const result = await response.json();
            const pending = result?.data ?? result;
            if (response.ok && Array.isArray(pending) && !pending.some((row) => row?.id === decisionId)) {
                message._structuredData = null;
                history = [...history];
                if (sessionCache[sid]) sessionCache[sid] = [...history];
            }
        } catch {
            // Falha fechada: sem confirmar o estado, preserva o card.
        }
    }

    function handleOffline() {
        isOnline = false;
        wasOffline = true;
        reconnecting = true;
        startReconnectLoop();
        fullSaveSessionState();
    }

    // ── Persistência de sessão ────────────────────────────────────────
    function fullSaveSessionState() {
        saveSessionState({
            tabs,
            appTabs,
            activeTab,
            sessionId,
            sessionCache,
            unreadMap,
            isMobile,
        });
    }

    function handleVisibilityChange() {
        if (document.hidden) fullSaveSessionState();
    }

    function fullRestoreSessionState() {
        const state = restoreSessionState();
        if (!state) return false;
        try {
            if (state.tabs && state.tabs.length > 0) {
                tabs = state.tabs;
            }
            if (state.appTabs) appTabs = state.appTabs;
            if (state.activeTab) activeTab = state.activeTab;
            if (state.sessionId) sessionId = state.sessionId;
            if (state.sessionCache) sessionCache = state.sessionCache;
            if (state.unreadMap) unreadMap = state.unreadMap;
            if (state.isMobile !== undefined) isMobile = state.isMobile;
            return true;
        } catch (e) {
            console.warn("[Agent] Falha ao restaurar estado:", e.message);
            return false;
        }
    }

    function startReconnectLoop() {
        if (reconnectTimer) return;
        reconnectTimer = setInterval(async () => {
            try {
                const res = await fetch("/agent/provider", {
                    method: "HEAD",
                    cache: "no-store",
                });
                if (res.ok) {
                    handleOnline();
                }
            } catch {
                /* ainda offline */
            }
        }, 4000);
    }

    // ── Canvas ──────────────────────────────────────────────────────
    let canvasOpen = false;
    let canvasHtml = "";

    function handleOpenCanvas(e) {
        canvasHtml = e.detail.html;
        canvasOpen = true;
    }

    // ── Chat ────────────────────────────────────────────────────────
    let message = "";
    const initialId = generateSessionId();
    let sessionId = initialId;
    let history = [];
    let system = { provider: "—", model: "—", connections: [] };
    let listRef;

    let sessionCache = {};
    // Incrementado a cada troca: uma resposta HTTP de uma conversa anterior
    // jamais pode sobrescrever a conversa que o usuário já selecionou.
    let sessionActivation = 0;

    function historyPath(sid) {
        return `/sessions/${encodeURIComponent(sid)}/history?limit=all`;
    }
    let composerSessionId = "";
    // Trocar de conversa salva o texto anterior e restaura apenas o rascunho
    // da sessão que passou a ocupar o composer.
    $: if (
        typeof window !== "undefined" &&
        sessionId &&
        sessionId !== composerSessionId
    ) {
        if (composerSessionId) saveComposerDraft(composerSessionId, message);
        message = loadComposerDraft(sessionId);
        composerSessionId = sessionId;
    }
    // A escrita é persistida conforme muda, inclusive antes de reload/fechamento.
    $: if (
        typeof window !== "undefined" &&
        composerSessionId &&
        composerSessionId === sessionId
    ) {
        saveComposerDraft(composerSessionId, message);
    }
    // Cursor composto: seq só é comparável dentro do mesmo epoch. Isso evita
    // descartar um turno novo quando o backend reinicia ou limpa o buffer.
    let cursorMap = {};
    let reconcileGeneration = {};

    function generateSessionId() {
        const rand = Math.random().toString(36).slice(2, 10);
        const ts = Date.now().toString(36).slice(-4);
        return `orbit-${rand}${ts}`;
    }

    async function loadSystem() {
        const [p, o] = await Promise.all([
            api("/provider"),
            api("/oauth/status"),
        ]);
        if (p)
            system = {
                ...system,
                provider: p.provider || "—",
                model: p.model || "—",
            };
        if (o?.providers)
            system = { ...system, connections: Object.entries(o.providers) };
    }

    function contentToString(raw) {
        if (!raw) return "";
        if (typeof raw === "string") return raw;
        if (Array.isArray(raw)) {
            return raw
                .filter((b) => b && b.type === "text" && b.text)
                .map((b) => String(b.text))
                .join("\n")
                .trim();
        }
        if (typeof raw === "object" && raw.text) return String(raw.text);
        return "";
    }

    // ── Anexos no texto ─────────────────────────────────────────────
    // O histórico persistido só guarda o texto enviado ao LLM: o base64 do
    // upload se perde. Ao reabrir uma sessão antiga, reconstruímos os anexos a
    // partir dos marcadores do próprio texto e servimos o arquivo por
    // /agent/attachment?path=… — o mesmo padrão que a IA pode emitir para
    // anexar um arquivo que ela gerou.
    const ATTACH_RE =
        /\[Attached reference:\s*type=([^;\]]*);\s*path=([^;\]]*);\s*mime=([^;\]]*);\s*name=([^\]]*)\]/g;
    // Formato legado usado antes do marcador completo.
    const IMAGE_PATH_RE = /\[Image Path:\s*([^\]]+)\]/g;

    function attachmentUrl(p) {
        return `/agent/attachment?path=${encodeURIComponent(p)}`;
    }

    function attachmentFromRef(type, filePath, mime, name) {
        const mimetype = (mime || "").trim() || "application/octet-stream";
        const clean = (filePath || "").trim();
        return {
            name: (name || "").trim() || clean.split("/").pop() || "arquivo",
            path: clean,
            mimetype,
            isImage:
                type === "image" || mimetype.startsWith("image/"),
            isText: false,
            base64: null,
            textContent: null,
            url: attachmentUrl(clean),
            fromHistory: true,
        };
    }

    // Extrai os marcadores de anexo do texto e devolve { content, attachments }
    // com o texto já limpo (o marcador é ruído para o usuário).
    function extractAttachmentRefs(content) {
        const text = String(content ?? "");
        if (!text.includes("[Attached reference:") && !text.includes("[Image Path:"))
            return { content: text, attachments: [] };

        const attachments = [];
        let out = text.replace(ATTACH_RE, (_, type, p, mime, name) => {
            attachments.push(
                attachmentFromRef(type.trim(), p, mime, name),
            );
            return "";
        });
        out = out.replace(IMAGE_PATH_RE, (_, p) => {
            attachments.push(attachmentFromRef("image", p, "", ""));
            return "";
        });
        return { content: out.replace(/\n{3,}/g, "\n\n").trim(), attachments };
    }

    // Anexos vindos do raw (upload recém-feito, com base64) têm prioridade;
    // os do texto só entram se o mesmo path ainda não estiver presente.
    function mergeAttachments(rawAtts, refAtts) {
        const merged = [...(rawAtts ?? [])];
        const seen = new Set(merged.map((a) => a?.path).filter(Boolean));
        for (const a of refAtts) {
            if (a.path && seen.has(a.path)) continue;
            if (a.path) seen.add(a.path);
            merged.push(a);
        }
        return merged;
    }

    function mergeAssistantGroup(items) {
        const steps = [];
        const reasoningParts = [];
        let allReasoningText = null;
        let lastContent = "";
        // Modelo do último turno do grupo: é ele que assina a resposta visível.
        let model = null, provider = null;
        for (const item of items) {
            const m = item.raw;
            const content = item.content;
            lastContent = content;
            if (m.model) {
                model = m.model;
                provider = m.provider ?? null;
            }
            const toolCalls = m.tool_calls ?? [];
            if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    const name = tc.function?.name || tc.name || "tool";
                    const args =
                        tc.function?.arguments ??
                        tc.arguments ??
                        tc.args ??
                        tc.input ??
                        null;
                    steps.push({
                        label: name,
                        reasoning: content || null,
                        args,
                        result: tc.result ?? tc.output ?? null,
                    });
                }
            }
            if (toolCalls.length > 0 && content.trim()) {
                reasoningParts.push(content);
            }
            const rc = m.reasoning_content ?? m.reasoning ?? null;
            if (rc) {
                allReasoningText = allReasoningText
                    ? allReasoningText + " " + rc
                    : rc;
            }
        }
        const msg = {
            role: "assistant",
            content: lastContent,
            attachments: [],
            streaming: false,
            steps: steps,
            allReasoning:
                allReasoningText ||
                (reasoningParts.length > 0 ? reasoningParts.join(" ") : null),
            thinkingExpanded: false,
            model,
            provider,
            ...copyMessageTiming(items[items.length - 1]?.raw),
        };
        return processAssistantMessage(msg);
    }

    function sanitizeHistoryMessages(raw) {
        if (!Array.isArray(raw)) return [];
        // Passo 1: intercalar user/assistant em ordem
        const interleaved = [];
        for (const m of raw) {
            const role = m.role || (m.is_user ? "user" : "assistant");
            if (role !== "user" && role !== "assistant") continue;
            const content = contentToString(
                m.content ?? m.message ?? m.text ?? "",
            );
            if (
                role === "assistant" &&
                !content.trim() &&
                !m.steps?.length &&
                (!Array.isArray(m.tool_calls) || m.tool_calls.length === 0)
            )
                continue;
            if (role === "user" && !content.trim() && !m.attachments?.length)
                continue;
            interleaved.push({ raw: m, role, content });
        }
        // Passo 2: agrupar assistants consecutivos
        const merged = [];
        let assistantGroup = [];
        function flushGroup() {
            if (assistantGroup.length === 0) return;
            merged.push(mergeAssistantGroup(assistantGroup));
            assistantGroup = [];
        }
        for (const item of interleaved) {
            if (item.role === "user") {
                flushGroup();
                const refs = extractAttachmentRefs(item.content);
                merged.push({
                    role: "user",
                    content: refs.content,
                    attachments: mergeAttachments(
                        item.raw.attachments,
                        refs.attachments,
                    ),
                    inputTrace: item.raw.inputTrace ?? null,
                    streaming: false,
                    steps: [],
                    allReasoning: null,
                    thinkingExpanded: false,
                    ...copyMessageTiming(item.raw),
                });
            } else {
                assistantGroup.push(item);
            }
        }
        flushGroup();
        return merged;
    }

    // ── Mobile state ────────────────────────────────────────────────
    let isMobile = false;
    // Menu de borda aberto no mobile: 'left' (docks+sessões) | 'right' (apps) | null
    let mobilePanel = null;
    let shellEl;
    const iframeRefs = {};
    let gestureOffs = [];

    function openLeft() { mobilePanel = "left"; }
    function openRight() { mobilePanel = "right"; }
    function closePanel() { mobilePanel = null; }

    // O sistema é o fallback de menor prioridade: um app ativo que declarar
    // `gesture:register` recebe a chance de consumir antes deste handler.
    function handleSystemSwipe(gesture) {
        if (!isMobile || gesture.type !== "swipe") return { handled: false };

        // Uma gaveta aberta fecha no gesto que a empurra de volta para a borda.
        if (mobilePanel === "left" && gesture.direction === "left") {
            closePanel();
            return { handled: true };
        }
        if (mobilePanel === "right" && gesture.direction === "right") {
            closePanel();
            return { handled: true };
        }

        // Sem gaveta: somente uma borda física pode revelar o painel oposto.
        if (!mobilePanel && gesture.fromEdge === "left" && gesture.direction === "right") {
            openLeft();
            return { handled: true };
        }
        if (!mobilePanel && gesture.fromEdge === "right" && gesture.direction === "left") {
            openRight();
            return { handled: true };
        }
        return { handled: false };
    }

    function setupGestureProtocol() {
        const router = createGestureRouter();
        const iframeBridge = createIframeGestureBridge({
            getActiveFrame: () => activeIsApp ? iframeRefs[activeTab] : null,
        });

        // Apps em iframe só participam depois de opt-in; Chat usa diretamente
        // o fallback abaixo, exatamente com a mesma semântica `handled`.
        gestureOffs.push(router.register((gesture) => iframeBridge.dispatch(gesture), { priority: 100 }));
        gestureOffs.push(router.register(handleSystemSwipe, { priority: 0 }));
        window.addEventListener("message", iframeBridge.handleMessage);
        gestureOffs.push(() => window.removeEventListener("message", iframeBridge.handleMessage));
        gestureOffs.push(installNativeGestureBridge((gesture) => router.dispatch(gesture)));
        gestureOffs.push(installEdgeSwipeDetector(shellEl, (gesture) => router.dispatch(gesture), () => isMobile));
    }

    // A configuração do menu virou um MODO DE EDIÇÃO INLINE no próprio Sidebar/
    // painéis (Reforma na Configuração dos Menus) — a engrenagem alterna o
    // store `menuEditMode` dentro do Sidebar, sem modal aqui.

    // Toque no título volta ao chat quando um app está em tela cheia
    function mobileHome() {
        if (activeIsApp) {
            activeIsApp = false;
            activeTab = sessionId;
        }
    }

    function checkMobile() {
        isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (!isMobile) mobilePanel = null;
        tick().then(() => {
            showLoading = false;
        });
    }

    // ── Workspace tabs ───────────────────────────────────────────────
    let tabs = [{ sessionId: initialId, name: "Nova Missão", pinned: false }];
    let activeTab = initialId;
    let loadingMap = {};
    let unreadMap = {};
    let refreshTrigger = 0;
    let sidebarCollapsed = false;
    let rightSidebarCollapsed = true;
    let appReloadKeys = {};

    function markChatRead(sid) {
        if (!unreadMap[sid]) return;
        unreadMap = { ...unreadMap, [sid]: false };
    }

    function markChatUnread(sid) {
        if (sid === activeTab && !activeIsApp) return;
        unreadMap = { ...unreadMap, [sid]: true };
    }

    async function loadWorkspace() {
        if (tabs.length > 0) {
            await activateSession(tabs[0].sessionId);
        }
    }

    async function activateSession(sid, prefetchedHistory = null) {
        const activation = ++sessionActivation;
        // Abrir a conversa também consome seus avisos informativos. A emissão
        // local fecha o toast imediatamente; a mensagem WS persiste a leitura.
        busEmitLocal("ntfy:session-read", { sessionId: sid });
        chatSocket.send({
            type: "bus:emit",
            event: "ntfy:session-read",
            detail: { sessionId: sid },
        });
        if (sessionCache[sid]?.length > 0) {
            sessionId = sid;
            history = sessionCache[sid].map((m) => ({
                ...m,
                thinkingExpanded: m.thinkingExpanded ?? false,
            }));
            await discardResolvedGovernanceCard(sid);
            await tick();
            await listRef?.scrollBottom(true);
            // Cache pode estar defasado se a sessão segue respondendo
            reconcileSession(sid);
            return;
        }
        // Mantém a View atual montada enquanto a nova conversa é lida. O
        // snapshot novo substitui o anterior de uma vez, sem um frame vazio.
        sessionId = sid;
        const data = prefetchedHistory ?? await api(historyPath(sid), "GET");
        if (activation !== sessionActivation || sessionId !== sid) return;
        const loadedHistory = sanitizeHistoryMessages(data || []);

        // O usuário pode enviar enquanto esta leitura ainda está em voo,
        // especialmente no primeiro carregamento do Runtime local. Nesse
        // intervalo `send()` grava o eco otimista em sessionCache. Nunca deixe
        // uma resposta de histórico anterior ao envio substituir essa cópia:
        // ela é a única representação da mensagem até o evento user_message.
        const liveHistory = sessionCache[sid];
        if (liveHistory?.some((item) => item?._localEchoContent)) {
            history = liveHistory;
            await tick();
            await listRef?.scrollBottom(true);
            reconcileSession(sid);
            return;
        }

        history = loadedHistory;
        await discardResolvedGovernanceCard(sid);
        // Resposta vazia também pode ser uma falha transitória do servidor.
        // Não a eterniza no cache; a próxima abertura tenta reidratar de novo.
        if (loadedHistory.length > 0) sessionCache[sid] = loadedHistory;
        else delete sessionCache[sid];
        await tick();
        await listRef?.scrollBottom(true);
        // Se a sessão ainda está respondendo no servidor, reata o stream
        reconcileSession(sid);
    }

    // ── Tab event handlers ───────────────────────────────────────────
    async function handleSelectTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        if (sessionId) sessionCache[sessionId] = [...history];
        const isApp = appTabs.some((t) => t.id === sid);
        activeTab = sid;
        activeIsApp = isApp;
        if (!isApp) {
            markChatRead(sid);
            fullSaveSessionState();
            await activateSession(sid);
        } else {
            fullSaveSessionState();
        }
        if (isMobile) closePanel();
    }

    export async function handleNewTab() {
        const newId = generateSessionId();
        const next = createNewTopicWorkspace(newId, {
            tabs,
            appTabs,
            loadingMap,
            unreadMap,
        });
        tabs = next.tabs;
        appTabs = next.appTabs;
        activeTab = next.activeTab;
        sessionId = next.sessionId;
        history = next.history;
        activeIsApp = next.activeIsApp;
        loadingMap = next.loadingMap;
        unreadMap = next.unreadMap;
        refreshTrigger++;
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    async function handleNewSpecialistSession(event) {
        const specialistId = event?.detail?.specialistId;
        if (!specialistId) return;
        const newId = generateSessionId();
        try {
            const response = await fetch("/specialists/session", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: newId, specialist_id: specialistId }),
            });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
        } catch (error) {
            console.error("Erro ao criar conversa do especialista:", error);
            return;
        }

        const next = createNewTopicWorkspace(newId, {
            tabs,
            appTabs,
            loadingMap,
            unreadMap,
        });
        tabs = next.tabs;
        appTabs = next.appTabs;
        activeTab = next.activeTab;
        sessionId = next.sessionId;
        history = next.history;
        activeIsApp = next.activeIsApp;
        loadingMap = next.loadingMap;
        unreadMap = next.unreadMap;
        refreshTrigger++;
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    function handleRenameTab(e) {
        const payload = typeof e === "object" && e?.detail ? e.detail : e;
        const { sessionId: sid, name } = payload;
        tabs = tabs.map((t) => (t.sessionId === sid ? { ...t, name } : t));
        fullSaveSessionState();
    }

    function handleTogglePin(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        tabs = tabs.map((t) =>
            t.sessionId === sid ? { ...t, pinned: !t.pinned } : t,
        );
        fullSaveSessionState();
    }

    async function handleCloseTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        const isApp = appTabs.find((t) => t.id === sid);
        if (isApp) {
            appTabs = appTabs.filter((t) => t.id !== sid);
            if (activeTab === sid) {
                activeTab = sessionId;
                activeIsApp = false;
            }
            fullSaveSessionState();
            return;
        }
        // Fechar a aba NÃO cancela o turno: a geração segue no servidor e a
        // sessão reata via reconcileSession quando for reaberta.
        loadingMap = { ...loadingMap, [sid]: false };
        unreadMap = { ...unreadMap, [sid]: false };
        const next = closeChatTab(sid, { tabs, activeTab, sessionId, history, activeIsApp });
        tabs = next.tabs;
        activeTab = next.activeTab;
        sessionId = next.sessionId;
        history = next.history;
        activeIsApp = next.activeIsApp;
        delete sessionCache[sid];
        fullSaveSessionState();
        if (next.sessionId && next.sessionId !== sid) await activateSession(next.sessionId);
        refreshTrigger++;
    }

    function reloadApp(id, recreate = false) {
        const frame = iframeRefs[id];
        if (recreate) {
            appReloadKeys = { ...appReloadKeys, [id]: (appReloadKeys[id] || 0) + 1 };
        } else if (frame) {
            appLoadingMap = { ...appLoadingMap, [id]: true };
            frame.src = frame.src;
        }
    }

    async function refreshChat(sid, recreate = false) {
        if (!sid) return;
        if (recreate) delete sessionCache[sid];
        if (sid === sessionId) await activateSession(sid);
        else reconcileSession(sid);
    }

    async function refreshActive(recreate = false) {
        if (activeIsApp) reloadApp(activeTab, recreate);
        else await refreshChat(activeTab, recreate);
    }

    async function refreshAllTabs() {
        for (const tab of appTabs) reloadApp(tab.id, false);
        for (const tab of tabs) await refreshChat(tab.sessionId, false);
    }

    async function handleDesktopShortcut(event) {
        if (event.isComposing) return;
        if (event.key === "Escape" && !isMobile) {
            if (canvasOpen) canvasOpen = false;
            else if (!sidebarCollapsed) sidebarCollapsed = true;
            else if (!rightSidebarCollapsed) rightSidebarCollapsed = true;
            else return;
            event.preventDefault();
            return;
        }

        const action = desktopShortcutAction(event, { isMobile });
        if (!action) return;
        if (isEditableShortcutTarget(event.target) && isTextEditingShortcut(event, action)) return;
        event.preventDefault();

        const ordered = allTabs;
        if (action.type === "select-index") {
            const id = ordered[action.index]?.sessionId;
            if (id) await handleSelectTab(id);
        } else if (action.type === "next-tab" || action.type === "previous-tab") {
            const id = adjacentTabId(ordered, activeTab, action.type === "next-tab" ? 1 : -1);
            if (id) await handleSelectTab(id);
        } else if (action.type === "close-active") {
            if (activeTab) await handleCloseTab(activeTab);
        } else if (action.type === "close-all") {
            handleCloseAllApps();
            handleCloseAllChats();
        } else if (action.type === "toggle-sidebar") {
            sidebarCollapsed = !sidebarCollapsed;
        } else if (action.type === "refresh-active") {
            await refreshActive(false);
        } else if (action.type === "reopen-active") {
            await refreshActive(true);
        } else if (action.type === "refresh-all") {
            await refreshAllTabs();
        } else if (action.type === "recover-runtime") {
            busEmit("open:app", "process-manager");
        }
    }

    function handleCloseAllChats() {
        const next = closeAllChatTabs({ tabs, activeTab, sessionId, history, activeIsApp, loadingMap, unreadMap });
        const retainedIds = new Set(next.tabs.map((tab) => tab.sessionId));
        const closedIds = tabs.filter((tab) => !retainedIds.has(tab.sessionId)).map((tab) => tab.sessionId);
        tabs = next.tabs;
        activeTab = next.activeTab;
        sessionId = next.sessionId;
        history = next.history;
        activeIsApp = next.activeIsApp;
        loadingMap = next.loadingMap;
        unreadMap = next.unreadMap;
        for (const sid of closedIds) delete sessionCache[sid];
        refreshTrigger++;
        fullSaveSessionState();
    }

    function updateSessionHistory(sid, updater) {
        const cached = sessionCache[sid] || [];
        const updated = updater(cached);
        sessionCache[sid] = updated;
        if (sessionId === sid) history = updated;
    }

    // ── Stop ─────────────────────────────────────────────────────────
    // Aprovar/negar um pedido nativo de Codex/Claude após confirmação HTTP.
    // O evento permission_resolved também reconcilia as outras abas.
    async function handleResolvePermission(e) {
        const { request_id, decision } = e.detail ?? {};
        if (!request_id) return;
        const target = e.detail?.session_id || sessionId;
        const result = await api("/permission/resolve", "POST", {
            request_id, session_id: target, decision,
        });
        updateSessionHistory(target, (hist) =>
            hist.map((m) =>
                m.pendingPermissions?.some((p) => p.request_id === request_id)
                    ? {
                          ...m,
                          pendingPermissions: m.pendingPermissions.map((p) =>
                              p.request_id === request_id
                                  ? { ...p, status: result?.ok ? decision : p.status,
                                      error: result?.ok ? null : result?.error || "Não foi possível registrar a decisão. Tente novamente." }
                                  : p,
                          ),
                      }
                    : m,
            ),
        );
    }

    async function handleMessageFeedback(e) {
        const { assistantOrdinal, feedback } = e.detail ?? {};
        if (!Number.isInteger(assistantOrdinal) || !feedback) return;
        const result = await api(`/sessions/${sessionId}/feedback`, "POST", {
            assistant_ordinal: assistantOrdinal,
            ...feedback,
        });
        if (!result?.success) return;
        updateSessionHistory(sessionId, (hist) => {
            let ordinal = -1;
            return hist.map((item) => {
                if (item.role !== "assistant" || !String(item.content ?? "").trim()) return item;
                ordinal += 1;
                return ordinal === assistantOrdinal
                    ? { ...item, feedback: result.feedback }
                    : item;
            });
        });
    }

    async function handleStop(sid) {
        const target = sid || sessionId;
        const result = await api("/chat/cancel", "POST", { session_id: target });
        if (!result?.success) return;
        updateSessionHistory(target, (hist) => {
            // Mensagens ainda na fila não serão processadas (o servidor
            // limpa a fila no cancel) — remove para não enganar o usuário
            const filtered = hist.filter((m) => !m.queued);
            return filtered;
        });
    }

    async function retryTimedOutTurn(sid, index) {
        const target = sid || sessionId;
        const hist = sessionCache[target] || [];
        const input = retryTurnInput(hist, index);
        if (!input || loadingMap[target]) return;
        if (target !== sessionId) await activateSession(target);
        await send({ detail: input });
    }

    // ── Pipeline de eventos de chat (WS ao vivo + replay do reconnect) ──
    // Todas as mutações de renderização de um turno passam por aqui, venham
    // do WS ou do replay do buffer — a aba que enviou e as demais abas da
    // mesma sessão renderizam pelo mesmo caminho.
    function ensureStreamingAssistant(hist) {
        const last = hist[hist.length - 1];
        if (last?.role === "assistant" && last.streaming) return hist;
        return [
            ...hist,
            {
                role: "assistant",
                content: "",
                streaming: true,
                steps: [],
                allReasoning: null,
                thinkingExpanded: false,
                pendingPermissions: [],
            },
        ];
    }

    // Posição da mensagem de usuário em relação à resposta em andamento.
    //
    // Uma mensagem JÁ ACEITA no turno pertence ao passado da conversa: entra
    // ANTES da bolha em streaming, senão apareceria depois de uma resposta que
    // ela ajudou a produzir.
    //
    // Uma mensagem EM FILA é o contrário — ainda não foi lida pelo modelo, é o
    // próximo turno. Ela vai DEPOIS do bloco de pensamento, no fim da lista, que
    // é onde o olho espera a última coisa que você digitou. Quando o turno a
    // consome (queued: false), ela sobe para o lugar cronológico e o bloco de
    // pensamento desce — a troca de lugar que o usuário vê acontecer.
    function insertUserMessage(hist, msg) {
        const last = hist[hist.length - 1];
        if (!msg.queued && last?.role === "assistant" && last.streaming) {
            return [...hist.slice(0, -1), msg, last];
        }
        return [...hist, msg];
    }

    // Mensagem em fila foi aceita: além de perder o `queued`, ela troca de lugar
    // com a bolha em streaming (que estava acima dela).
    function settleQueuedMessage(hist, i) {
        const settled = { ...hist[i], queued: false, justSettled: true };
        const prev = hist[i - 1];
        if (i === hist.length - 1 && prev?.role === "assistant" && prev.streaming) {
            return [...hist.slice(0, i - 1), settled, prev];
        }
        return hist.map((x, j) => (j === i ? settled : x));
    }

    function applyChatEvent(sid, event, data, seq, epoch = null) {
        if (seq != null) {
            const incomingEpoch = epoch || cursorMap[sid]?.epoch || "legacy";
            const cursor = cursorMap[sid];
            if (cursor?.epoch === incomingEpoch && cursor.seq >= seq) return;
            cursorMap[sid] = { epoch: incomingEpoch, seq };
        }

        if (event === "start") {
            loadingMap = { ...loadingMap, [sid]: true };
            updateSessionHistory(sid, ensureStreamingAssistant);
        } else if (event === "user_message") {
            // Confirmação de mensagem enviada: consome o eco otimista local,
            // desmarca queued, ou anexa (mensagem vinda de outra aba/replay)
            updateSessionHistory(sid, (hist) => {
                for (let i = hist.length - 1; i >= 0; i--) {
                    const m = hist[i];
                    if (m.role !== "user") continue;
                    if (m._localEchoContent === data.text) {
                        return hist.map((x, j) => {
                            if (j !== i) return x;
                            const { _localEchoContent, queued, ...rest } = x;
                            return rest;
                        });
                    }
                    if (m.queued && m.content === data.text) {
                        return settleQueuedMessage(hist, i);
                    }
                    if (m.content === data.text) return hist; // já renderizada
                }
                const refs = extractAttachmentRefs(data.text);
                return insertUserMessage(hist, {
                    role: "user",
                    content: refs.content,
                    attachments: refs.attachments,
                    metadata: data.metadata,
                });
            });
        } else if (event === "input_trace") {
            // A proveniência só fica pronta depois que o backend compõe o
            // prompt. Enriquece o eco já exibido, sem criar outra mensagem.
            updateSessionHistory(sid, (hist) => {
                for (let i = hist.length - 1; i >= 0; i--) {
                    const m = hist[i];
                    if (m.role !== "user") continue;
                    if (m.content === data.text || m._localEchoContent === data.text) {
                        return hist.map((item, j) => j === i
                            ? { ...item, inputTrace: data.inputTrace ?? null }
                            : item);
                    }
                }
                return hist;
            });
        } else if (event === "queued") {
            updateSessionHistory(sid, (hist) => {
                const echoed = hist.some(
                    (m) =>
                        m.role === "user" &&
                        (m._localEchoContent === data.text ||
                            (m.queued && m.content === data.text)),
                );
                if (echoed) return hist;
                const refs = extractAttachmentRefs(data.text);
                return insertUserMessage(hist, {
                    role: "user",
                    content: refs.content,
                    attachments: refs.attachments,
                    queued: true,
                });
            });
        } else if (event === "token") {
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? { ...m, content: (m.content ?? "") + (data.text ?? "") }
                        : m,
                );
            });
            if (sid === sessionId) listRef?.scrollBottom();
        } else if (event === "reasoning") {
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? {
                              ...m,
                              allReasoning:
                                  (m.allReasoning ?? "") + (data.text ?? ""),
                              thinkingExpanded: m.thinkingExpanded ?? false,
                          }
                        : m,
                );
            });
            // Reasoning streama token a token — acompanha o scroll como o texto
            // (condicional: só desce se o usuário estiver ancorado no fim).
            if (sid === sessionId) listRef?.scrollBottom();
        } else if (event === "model") {
            // Identificador do modelo que respondeu este turno. Fica na bolha
            // assistant em streaming; ao trocar de modelo no meio (chain de
            // fallback), o último a falar é o que a bolha mostra.
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? {
                              ...m,
                              model: data.model ?? m.model ?? null,
                              provider: data.provider ?? m.provider ?? null,
                          }
                        : m,
                );
            });
        } else if (event === "usage") {
            // Custo/tokens acumulados até esta iteração — atualiza a bolha
            // assistant em streaming ao vivo, sem esperar o done.
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? { ...m, usage: data.usage ?? m.usage ?? null }
                        : m,
                );
            });
        } else if (event === "permission_request") {
            // O provider claude-cli (modo interativo) quer usar uma ferramenta —
            // anexa um card de aprovação na bolha assistant em streaming.
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? {
                              ...m,
                              pendingPermissions: [
                                  ...(m.pendingPermissions ?? []),
                                  {
                                      request_id: data.request_id,
                                      tool_name: data.tool_name,
                                      tool_input: data.tool_input ?? {},
                                      status: "pending",
                                  },
                              ],
                          }
                        : m,
                );
            });
            if (sid === sessionId) listRef?.scrollBottom();
        } else if (event === "permission_resolved") {
            // Decisão chegou (deste ou de outro cliente) — atualiza o card.
            updateSessionHistory(sid, (hist) =>
                hist.map((m) =>
                    m.pendingPermissions?.some(
                        (p) => p.request_id === data.request_id,
                    )
                        ? {
                              ...m,
                              pendingPermissions: m.pendingPermissions.map((p) =>
                                  p.request_id === data.request_id
                                      ? { ...p, status: data.decision }
                                      : p,
                              ),
                          }
                        : m,
                ),
            );
        } else if (event === "step") {
            // O reasoning de cada step fica só nele mesmo (step.reasoning,
            // exibido inline na timeline) — não entra mais em allReasoning.
            // Antes entrava nos dois lugares: como allReasoning é a fase de
            // raciocínio que vem ANTES dos steps (chega primeiro, renderizada
            // acima na UI), acumular reasoning de step ali fazia esse bloco
            // "de cima" continuar mudando depois que os steps (embaixo) já
            // tinham aparecido — quebrava a leitura de timeline (cima→baixo,
            // cronológica) que o painel deve transmitir.
            if (data.result !== undefined) {
                updateSessionHistory(sid, (hist) => {
                    const h = ensureStreamingAssistant(hist);
                    const idx = h.length - 1;
                    return h.map((m, i) => {
                        if (i !== idx || !m.steps?.length) return m;
                        const steps = [...m.steps];
                        steps[steps.length - 1] = {
                            ...steps[steps.length - 1],
                            result: data.result,
                        };
                        return { ...m, steps };
                    });
                });
                if (sid === sessionId) listRef?.scrollBottom();
                return;
            }
            const newStep = {
                label: data.label ?? "",
                reasoning: data.reasoning ?? null,
                iteration: data.iteration ?? null,
                // args da tool p/ a tabela do timeline — aceita qualquer um dos
                // formatos que os providers emitem (padroniza no frontend).
                args:
                    data.args ??
                    data.input ??
                    data.tool_input ??
                    data.arguments ??
                    null,
                result: data.result ?? data.output ?? null,
            };
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx ? { ...m, steps: [...m.steps, newStep] } : m,
                );
            });
            if (sid === sessionId) listRef?.scrollBottom();
        } else if (event === "done") {
            loadingMap = { ...loadingMap, [sid]: false };
            markChatUnread(sid);
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) => {
                    if (i !== idx) return m;
                    return processAssistantMessage({
                        ...m,
                        content: data.response ?? "",
                        streaming: false,
                        justCompleted: true,
                        thinkingExpanded: false,
                        usage: data.usage ?? null,
                        createdAt: data.timestamp ?? m.createdAt ?? null,
                    });
                });
            });
            if (sid === sessionId) {
                listRef?.scrollBottom();
            }
        } else if (event === "error") {
            loadingMap = { ...loadingMap, [sid]: false };
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) =>
                    i === idx
                        ? {
                              ...m,
                              content: data.error,
                              streaming: false,
                              thinkingExpanded: false,
                          }
                        : m,
                );
            });
        } else if (event === "timeout") {
            loadingMap = { ...loadingMap, [sid]: false };
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) => i === idx ? { ...m, content: "", streaming: false, timedOut: true, thinkingExpanded: false } : m);
            });
        }
        // 'commit' é ignorado ao vivo — serve ao slicing do replay no servidor
    }

    // ── Reconexão de sessão ──────────────────────────────────────────
    // Reata uma sessão possivelmente em andamento: se o agente ainda está
    // respondendo, recarrega o histórico persistido (cobre tudo até o último
    // commit) e replaya do buffer apenas o estado parcial não-persistido; o
    // WS continua ao vivo dali em diante.
    async function reconcileSession(sid) {
        if (!sid) return;
        const generation = (reconcileGeneration[sid] || 0) + 1;
        reconcileGeneration[sid] = generation;
        const status = await api(`/sessions/${sid}/status`, "GET");
        if (reconcileGeneration[sid] !== generation) return;
        if (!status) return; // servidor inacessível — não mexe no estado

        const cached = sessionCache[sid];
        // Uma mensagem enviada localmente ainda pode não existir no snapshot
        // persistido quando o socket reconecta. Ela é a nossa única cópia até
        // o evento `user_message` chegar, portanto nunca pode ser substituída
        // por um histórico vazio ou atrasado.
        const hasLocalEcho = cached?.some((item) => item?._localEchoContent);
        const staleStreaming =
            cached?.length && cached[cached.length - 1]?.streaming;

        if (!status.active) {
            // Turno terminou (ou servidor reiniciou) enquanto estávamos fora:
            // se o cache tem bolha presa em streaming, recarrega do disco.
            if ((staleStreaming || loadingMap[sid]) && !hasLocalEcho) {
                loadingMap = { ...loadingMap, [sid]: false };
                const data = await api(historyPath(sid), "GET");
                if (reconcileGeneration[sid] !== generation) return;
                const refreshed = sanitizeHistoryMessages(data || []);
                if (refreshed.length > 0) sessionCache[sid] = refreshed;
                markChatUnread(sid);
                if (sid === sessionId) {
                    history = sessionCache[sid] || history;
                    await tick();
                    await listRef?.scrollBottom(true);
                }
            }
            return;
        }

        // Sessão ativa no servidor
        if (cursorMap[sid] == null) {
            // Sem estado ao vivo (página recém-aberta): o cache local pode
            // conter tokens antigos que o replay repetiria — parte do
            // histórico do disco, que cobre exatamente até o último commit.
            // `activateSession` já carrega o histórico antes de chamar esta
            // função. Preserve o cache quando ele contém o eco otimista: o
            // replay abaixo confirma/deduplica a mensagem. Recarregar aqui
            // criava a corrida em que a mensagem aparecia e logo sumia.
            if (!cached?.length) {
                const data = await api(historyPath(sid), "GET");
                sessionCache[sid] = sanitizeHistoryMessages(data || []);
                if (sid === sessionId) history = sessionCache[sid];
            }
        }

        loadingMap = { ...loadingMap, [sid]: true };
        const r = await api("/chat/stream/reconnect", "POST", {
            session_id: sid,
            epoch: cursorMap[sid]?.epoch ?? null,
            last_event_id: cursorMap[sid]?.seq ?? null,
        });
        if (reconcileGeneration[sid] !== generation) return;
        if (r?.cursor_mismatch) {
            const data = await api(historyPath(sid), "GET");
            if (reconcileGeneration[sid] !== generation) return;
            const refreshed = sanitizeHistoryMessages(data || []);
            if (refreshed.length > 0) sessionCache[sid] = refreshed;
            if (sid === sessionId) history = sessionCache[sid] || history;
        }
        for (const ev of r?.events ?? []) {
            applyChatEvent(sid, ev.event, ev.data, Number(ev.id), ev.epoch || r.epoch);
        }
        if (!r?.active && !r?.done && !r?.error) {
            loadingMap = { ...loadingMap, [sid]: false };
        }
        if (sid === sessionId) {
            await tick();
            await listRef?.scrollBottom(true);
        }
    }

    // ── Envio (não-bloqueante) ───────────────────────────────────────
    // POST /chat/send retorna imediatamente ({accepted} ou {queued}); os
    // tokens/steps/done chegam pelo WS via applyChatEvent. Enviar durante uma
    // resposta em andamento enfileira no servidor (estilo Claude) em vez de
    // bloquear o input.
    async function send(e) {
        const detail = e?.detail ?? e;
        const text =
            typeof detail === "object"
                ? detail.text ?? ""
                : String(detail ?? "");
        const attachments =
            typeof detail === "object" ? detail.attachments ?? [] : [];

        const targetSessionId = sessionId;

        if (text.trim() === "/clear") {
            await handleClearSession(targetSessionId);
            message = "";
            clearComposerDraft(targetSessionId);
            return;
        }

        if (!text && attachments.length === 0) return;

        const busy = !!loadingMap[targetSessionId];

        tabs = tabs.map((t) => {
            if (t.sessionId === targetSessionId && t.name === "Nova Missão") {
                const preview =
                    text.length > 30 ? text.slice(0, 30) + "…" : text;
                return { ...t, name: preview || "Arquivo" };
            }
            return t;
        });

        let llmMessageContent = text;
        if (attachments.length > 0) {
            const attachmentParts = attachments
                .map((a) => {
                    const type = a.isImage
                        ? "image"
                        : a.mimetype?.startsWith("video/")
                          ? "video"
                          : a.mimetype?.startsWith("audio/")
                            ? "audio"
                            : "file";
                    const reference = `\n[Attached reference: type=${type}; path=${a.path}; mime=${a.mimetype ?? "application/octet-stream"}; name=${a.name}]\n`;
                    if (a.isText && a.textContent)
                        return `\n\`\`\`\n// Path: ${a.path}\n${a.textContent}\n\`\`\`\n`;
                    if (a.ocrText)
                        return `\n[OCR automático: ${a.name}]\n${a.ocrText}\n[/OCR automático]\n`;
                    return reference;
                })
                .join("");
            llmMessageContent = text
                ? `${text}\n${attachmentParts}`
                : attachmentParts;
        }

        // Eco otimista: _localEchoContent permite ao pipeline de eventos
        // reconhecer a confirmação (user_message/queued) sem duplicar a bolha
        const userMsg = {
            role: "user",
            content: text,
            attachments,
            metadata: detail?.metadata,
            _localEchoContent: llmMessageContent,
            ...(busy ? { queued: true } : {}),
        };
        updateSessionHistory(targetSessionId, (hist) =>
            insertUserMessage(hist, userMsg),
        );
        await listRef?.scrollBottom(true);

        if (!busy) {
            loadingMap = { ...loadingMap, [targetSessionId]: true };
            updateSessionHistory(targetSessionId, ensureStreamingAssistant);
        }

        const r = await api("/chat/send", "POST", {
            message: llmMessageContent,
            session_id: targetSessionId,
            settings: detail?.settings,
            metadata: detail?.metadata,
        });

        if (!r?.accepted && !r?.queued && !r?.forwarded) {
            // Falha de rede ou rejeição HTTP: não trate um JSON de erro como
            // confirmação. Mantém a mensagem visível e apresenta a causa.
            loadingMap = { ...loadingMap, [targetSessionId]: false };
            updateSessionHistory(targetSessionId, (hist) => {
                const idx = hist.length - 1;
                const last = hist[idx];
                if (last?.role === "assistant" && last.streaming) {
                    return hist.map((m, i) =>
                        i === idx
                            ? {
                                  ...m,
                                  content:
                                      `Erro: ${r?.error || "não foi possível enviar a mensagem (falha de rede)."}`,
                                  streaming: false,
                                  thinkingExpanded: false,
                              }
                            : m,
                    );
                }
                return hist;
            });
            return;
        }

        clearComposerDraft(targetSessionId);
        if (sessionId === targetSessionId) message = "";

        if (r.forwarded) {
            // Mensagem era resposta a uma pergunta pendente (ask_user) — não
            // inicia turno novo; limpa o estado de fila/eco do input
            updateSessionHistory(targetSessionId, (hist) =>
                hist.map((m) => {
                    if (m._localEchoContent === llmMessageContent) {
                        const { _localEchoContent, queued, ...rest } = m;
                        return rest;
                    }
                    return m;
                }),
            );
        }
        // r.accepted / r.queued: tokens e confirmações chegam via WS
    }

    async function handleSelectSession(e) {
        const { sessionId: newId, history: newHistory } = e.detail;
        if (sessionCache[sessionId]) sessionCache[sessionId] = [...history];
        const existing = tabs.find((t) => t.sessionId === newId);
        if (!existing) {
            tabs = [
                ...tabs,
                { sessionId: newId, name: "Nova Missão", pinned: false },
            ];
        }
        activeTab = newId;
        activeIsApp = false;
        fullSaveSessionState();
        await activateSession(newId, newHistory);
        if (isMobile) closePanel();
    }

    async function handleSessionDelete(e) {
        const payload = e?.detail ?? e;
        const sid =
            typeof payload === "string"
                ? payload
                : payload?.sessionId ?? payload;
        tabs = tabs.filter((t) => t.sessionId !== sid);
        appTabs = appTabs.filter((t) => t.id !== sid);
        delete sessionCache[sid];
        if (activeTab === sid) {
            const fallback = tabs[0]?.sessionId;
            activeTab = fallback;
            activeIsApp = false;
            fullSaveSessionState();
            await activateSession(fallback);
            return;
        }
        fullSaveSessionState();
    }

    async function handleClearSession(sid) {
        const target = sid || sessionId;
        await api(`/sessions/${target}/clear`, "GET");
        delete sessionCache[target];
        delete cursorMap[target];
        reconcileGeneration[target] = (reconcileGeneration[target] || 0) + 1;
        loadingMap = { ...loadingMap, [target]: false };
        if (target === sessionId) {
            history = [];
            await tick();
        }
        refreshTrigger++;
    }

    // ── App tabs ─────────────────────────────────────────────────────
    let appTabs = [];
    let activeIsApp = false;
    $: {
        const current = activeIsApp ? appTabs.find((tab) => tab.id === activeTab) : null;
        publishBackgroundContext(activeIsApp
            ? { category: "app", contextId: current?.id || "unknown-app", contextLabel: current?.name || current?.label || "App" }
            : { category: "chat", contextId: "chat", contextLabel: "Chat" });
    }
    let appLoadingMap = {};

    $: allTabs = [
        ...tabs.map((t) => ({ ...t, type: "chat" })),
        ...appTabs.map((t) => ({ ...t, type: "app", sessionId: t.id })),
    ];

    function handleOpenApp(e) {
        const app = e.detail;
        const existing = appTabs.find((t) => t.id === app.id);
        if (existing) {
            activeTab = app.id;
            activeIsApp = true;
            fullSaveSessionState();
            if (isMobile) closePanel();
            return;
        }
        const newAppTab = { ...app, type: "app" };
        appTabs = [...appTabs, newAppTab];
        activeTab = app.id;
        activeIsApp = true;
        appLoadingMap = { ...appLoadingMap, [app.id]: true };
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    // ── Deep-link (notificação push — ver packages/ntfy/AGENT.md) ────
    // Abre (criando a aba se preciso) a sessão de chat de um sessionId que
    // pode nem estar entre as abas já abertas neste device.
    async function abrirChatPorDeepLink(sid) {
        if (!sid) return;
        const existing = tabs.find((t) => t.sessionId === sid);
        if (!existing) {
            tabs = [
                ...tabs,
                { sessionId: sid, name: "Nova Missão", pinned: false },
            ];
        }
        activeTab = sid;
        activeIsApp = false;
        fullSaveSessionState();
        await activateSession(sid);
        if (isMobile) closePanel();
    }

    // Resolve o app pelo id (mesma fonte que alimenta Apps.svelte/Sidebar:
    // getActiveApps()/getPackageViews()) e reusa handleOpenApp para abrir a
    // aba. Se o id for desconhecido, não faz nada (a Home abre normal).
    async function abrirAppPorDeepLink(appTargetId) {
        if (!appTargetId) return;
        const existing = appTabs.find((t) => t.id === appTargetId);
        if (existing) {
            handleOpenApp({ detail: existing });
            return;
        }
        const apps = await api("/apps/list", "GET", null, "aura-system");
        const found = Array.isArray(apps)
            ? apps.find((a) => a.id === appTargetId)
            : null;
        if (!found) {
            console.warn(`[deep-link] app "${appTargetId}" não encontrado`);
            return;
        }
        handleOpenApp({ detail: found });
    }

    // open=result: abre o resultado de um job de pacote. Se há `file` e o File
    // Manager está instalado, abre-o com o arquivo selecionado; senão cai pro
    // app do próprio pacote (`pkg`) na sua tela de resultado.
    async function abrirResultadoPorDeepLink({ pkg: sourcePkg, file: resultFile }) {
        const apps = await api("/apps/list", "GET", null, "aura-system");
        const list = Array.isArray(apps) ? apps : [];
        const fileApp = resultFile
            ? list.find((a) => a?.url?.includes("/view/file-manager/"))
            : null;
        if (fileApp) {
            const parts = resultFile.split("/");
            const name = parts.pop();
            const folder = parts.join("/");
            const sep = fileApp.url.includes("?") ? "&" : "?";
            const url = `${fileApp.url}${sep}path=${encodeURIComponent(folder)}&select=${encodeURIComponent(name)}`;
            const id = `open:${url}`;
            const existing = appTabs.find((t) => t.id === id);
            if (existing) return handleOpenApp({ detail: existing });
            return handleOpenApp({ detail: { id, name: fileApp.name || "Files", url, icon: fileApp.icon } });
        }
        // Fallback: abre o app do pacote de origem (mostra sua tela de resultado).
        const pkgApp = sourcePkg
            ? list.find((a) => a?.url?.includes(`/view/${sourcePkg}/`))
            : null;
        if (pkgApp) return handleOpenApp({ detail: pkgApp });
        console.warn(`[deep-link] open=result: nem file-manager nem "${sourcePkg}" encontrados`);
    }

    // ── Bus de UI: open:app / open:iframe / open:canvas (ver views/lib/bus.js) ──
    // Permite que qualquer widget/app dispare `$("open:app", pkg)` para um
    // app abrir outro, `$("open:iframe", { url, title })` para abrir uma
    // aba iframe arbitrária (o título vira o nome da aba), ou
    // `$("open:canvas", { html })` para abrir o Canvas de verdade com HTML.
    async function abrirAppPorPacote(pkg) {
        if (!pkg) return;
        // pkg pode ser o nome do pacote, o id do app, ou a própria url.
        const existing = appTabs.find(
            (t) => t.id === pkg || t.name === pkg || t.url === pkg,
        );
        if (existing) return handleOpenApp({ detail: existing });
        const apps = await api("/apps/list", "GET", null, "aura-system");
        const list = Array.isArray(apps) ? apps : [];
        const target = String(pkg).toLowerCase();
        const found =
            list.find((a) => a.id === pkg || a.url === pkg) ||
            list.find((a) => a?.url?.includes(`/view/${pkg}/`)) ||
            list.find((a) => (a.name || "").toLowerCase() === target);
        if (!found) {
            console.warn(`[bus] open:app: "${pkg}" não encontrado`);
            return;
        }
        handleOpenApp({ detail: found });
    }

    function abrirIframe(d = {}) {
        const { url, title } = d;
        if (!url) return;
        const id = `iframe:${url}`;
        const existing = appTabs.find((t) => t.id === id);
        if (existing) return handleOpenApp({ detail: existing });
        handleOpenApp({ detail: { id, name: title || "App", url } });
    }

    // Abre um arquivo como aba de App real — bridge do File Manager "Abrir em…".
    // `d = { pkg?, url, title?, path? }`. A `url` já traz o path num query param,
    // que a camada de views entrega como `export let` da página do App (ex.
    // /view/code-editor/Embed?path=foo.js → `export let path`).
    async function abrirAppComPath(d = {}) {
        const { pkg, url, title } = d;
        if (!url) return;
        const id = `open:${url}`; // url inclui o path → uma aba por arquivo
        const existing = appTabs.find((t) => t.id === id);
        if (existing) return handleOpenApp({ detail: existing });
        // Tenta herdar nome/ícone do App a partir de /apps/list (mesma fonte de
        // abrirAppPorPacote); se não achar, usa só o título do opener.
        let name = title || "App";
        let icon;
        try {
            const apps = await api("/apps/list", "GET", null, "aura-system");
            const list = Array.isArray(apps) ? apps : [];
            const found = pkg
                ? list.find((a) => a?.url?.includes(`/view/${pkg}/`))
                : null;
            if (found) {
                name = title || found.name || name;
                icon = found.icon;
            }
        } catch {
            /* segue sem ícone/nome do catálogo */
        }
        handleOpenApp({ detail: { id, name, url, icon } });
    }

    function abrirPreviewNoFileManager(detail = {}) {
        const url = filePreviewUrl(detail);
        if (!url) return;
        return abrirAppComPath({ pkg: "file-manager", url, title: detail.title || detail.name || "Preview" });
    }

    let busOffs = [];
    function setupWidgetBus() {
        bootstrapPackageWidgets();
        bootstrapMessageActions();
        refreshOptionalPackages();
        // Ponte front→back: eventos logos:/think: (ou {server:true}) viajam
        // pelo WS e viram dispatchEvent no backend.
        setServerForwarder((event, detail) =>
            chatSocket.send({ type: "bus:emit", event, detail }),
        );
        busOffs.push(busOn("open:app", (pkg) => abrirAppPorPacote(pkg)));
        busOffs.push(busOn("agent:deep-link", (target) => {
            if (target?.type === "chat") return abrirChatPorDeepLink(target.session);
            if (target?.type === "app") return abrirAppPorDeepLink(target.app);
            if (target?.type === "result") return abrirResultadoPorDeepLink(target);
        }));
        busOffs.push(busOn("open:iframe", (d) => abrirIframe(d)));
        busOffs.push(busOn("open:with", (d) => abrirAppComPath(d)));
        busOffs.push(busOn(FILE_MANAGER_PREVIEW_EVENT, (d) => abrirPreviewNoFileManager(d)));
        // Permite que um package (rodando em iframe) abra o Canvas de verdade
        // via parent.postMessage({source:"agent", type:"open:canvas", detail:{html}}),
        // mesmo caminho que MessageList usa internamente (handleOpenCanvas).
        busOffs.push(busOn("open:canvas", (d) => handleOpenCanvas({ detail: d || {} })));
        busOffs.push(busOn("message-actions:refresh", () => bootstrapMessageActions()));
        // Keep the legacy Agent host aligned with Shell: a nested menu widget
        // delegates governance notifications to the Desktop's native overlay.
        busOffs.push(busOn("notifications:activate", (notification) => {
            if (window.parent === window) return;
            window.parent.postMessage({
                source: "thinkiac-shell",
                type: "notifications:activate",
                detail: notification,
            }, window.location.origin);
        }));
        busOffs.push(busOn("structured-input:resolved", (detail) => {
            if (!detail?.text || detail.sessionId !== sessionId) return;
            send({ detail: { text: detail.text } });
        }));
        // Observabilidade da volta (back→front): loga o pong da demo.
        busOffs.push(
            busOn("logos:pong", (d) => console.log("[bus] logos:pong", d)),
        );
    }

    // ── Windows: handlers vindos do Sidebar / Windows ────────────────
    function handleSelectApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        activeTab = id;
        activeIsApp = true;
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    function handleCloseApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        appTabs = appTabs.filter((t) => t.id !== id);
        if (activeTab === id) {
            activeTab = sessionId;
            activeIsApp = false;
        }
        fullSaveSessionState();
    }

    function handleCloseAllApps() {
        const next = closeAllAppTabs({ appTabs, activeTab, activeIsApp, sessionId });
        appTabs = next.appTabs;
        activeTab = next.activeTab;
        activeIsApp = next.activeIsApp;
        fullSaveSessionState();
    }

    function handleSelectChat(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        handleSelectTab(id);
    }

    function handleCloseChat(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        handleCloseTab(id);
    }

    // ── Nome da sessão ativa ─────────────────────────────────────────
    $: activeTabName = (() => {
        if (activeIsApp)
            return appTabs.find((t) => t.id === activeTab)?.name ?? "App";
        return tabs.find((t) => t.sessionId === activeTab)?.name ?? "Chat";
    })();

    $: chatTabsForWindows = tabs.map((t) => ({ ...t, type: "chat" }));

    async function onStructuredSend(e) {
        const handlerStep = structuredProps?.find((step) => step?.submitEvent);
        const detail = e?.detail ?? {};
        if (!handlerStep) {
            send(e);
            detail.acknowledge?.();
            return;
        }
        // A confirmação de governança não pode depender de um evento WS sem
        // confirmação de entrega. A rota responde com o estado persistido e o
        // próprio serviço agenda a retomada segura da tool aprovada.
        if (handlerStep.governanceDecisionId) {
            const approved = detail.responses?.[structuredProps.indexOf(handlerStep)] === handlerStep.confirmLabel;
            try {
                const response = await fetch('/governance/confirmations/resolve', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, decisionId: handlerStep.governanceDecisionId, approved }),
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || result?.success === false || !(result?.data?.status || result?.status)) {
                    throw new Error(result?.error || `Não foi possível registrar a aprovação (HTTP ${response.status}).`);
                }
                if (lastMessage) {
                    lastMessage._structuredData = null;
                    history = [...history];
                    sessionCache[sessionId] = [...history];
                }
                detail.acknowledge?.();
            } catch (error) {
                detail.reject?.(error?.message);
            }
            return;
        }
        busEmit(handlerStep.submitEvent, {
            sessionId, submissionId: `${sessionId}:${Date.now()}`,
            responseEvent: handlerStep.responseEvent, steps: structuredProps,
            responses: detail.responses, text: detail.text,
        });
        detail.acknowledge?.();
    }

    // Mantém a subscrição WS sincronizada com as abas de chat abertas
    $: chatSocket.subscribe(tabs.map((t) => t.sessionId));
    $: if (chatSocket.isReady()) {
        chatSocket.setUiState({
            activeChatSessionId: activeIsApp ? null : sessionId,
        });
    }

    function createUiSnapshot() {
        const elements = [...document.querySelectorAll("button, a, input, textarea, [role='button']")]
            .slice(0, 120)
            .map((el, index) => ({
                index,
                tag: el.tagName.toLowerCase(),
                label: (el.getAttribute("aria-label") || el.getAttribute("title") || el.textContent || "")
                    .trim().replace(/\s+/g, " ").slice(0, 120),
                disabled: !!el.disabled,
            }))
            .filter((el) => el.label);
        return {
            route: `${window.location.pathname}${window.location.search}`,
            activeChatSessionId: activeIsApp ? null : sessionId,
            elements,
            updatedAt: new Date().toISOString(),
        };
    }

    onMount(() => {
        theme = getTheme();

        bootstrapBackgroundViews().then(() => publishBackgroundContext({ category: "chat", contextId: "chat", contextLabel: "Chat" }));

        // ── Canal WS de eventos de chat ──
        chatSocket.on((msg) => {
            if (msg.type === "chat:event") {
                applyChatEvent(msg.session_id, msg.event, msg.data, msg.seq, msg.epoch);
            } else if (msg.type === "sessions:updated") {
                refreshTrigger++;
            } else if (msg.type === "bus:event") {
                // Evento vindo do backend → re-emite no bus local (sem
                // reencaminhar, para não criar loop).
                busEmitLocal(msg.event, msg.detail);
            }
        });
        // A cada (re)abertura do socket, reconcilia as sessões abertas —
        // cobre tanto o primeiro load (sessão pode estar respondendo desde
        // antes do refresh) quanto quedas de conexão no meio do stream.
        chatSocket.onReopen(() => {
            chatSocket.subscribe(tabs.map((t) => t.sessionId));
            chatSocket.setUiState({
                activeChatSessionId: activeIsApp ? null : sessionId,
            });
            for (const t of tabs) reconcileSession(t.sessionId);
        });
        chatSocket.onCommand((command) => {
            if (command?.type === "navigate" && typeof command.path === "string" && command.path.startsWith("/") && !command.path.startsWith("//")) {
                window.location.assign(command.path);
            } else if (command?.type === "request-snapshot") {
                chatSocket.sendSnapshot(createUiSnapshot());
            }
        });
        chatSocket.connect();

        // Registra widgets contribuídos por pacotes e liga o bus de UI.
        setupWidgetBus();
        // Descobre itens de menu contribuídos por pacotes (manifest.menu).
        bootstrapMenuItems();

        // Tentar restaurar estado antes de carregar o workspace
        const restored = fullRestoreSessionState();
        if (restored && tabs.length > 0) {
            // Se restaurou, ativar a sessão restaurada
            if (activeIsApp) {
                // App tabs são mantidas, não ativa sessão de chat
            } else {
                // Ativar a sessão restaurada
                activateSession(sessionId).catch(() => {});
            }
        }
        loadSystem();
        if (!restored || !tabs.length) {
            loadWorkspace();
        }

        // Deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
        // — tem prioridade sobre a sessão restaurada/padrão acima.
        if (open === "chat" && session) {
            abrirChatPorDeepLink(session);
        } else if (open === "app" && app) {
            abrirAppPorDeepLink(app);
        } else if (open === "result") {
            abrirResultadoPorDeepLink({ pkg, file });
        }

        checkMobile();
        setupGestureProtocol();

        window.addEventListener("resize", checkMobile);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // ── Eventos de persistência ──
        window.addEventListener("beforeunload", fullSaveSessionState);
        document.addEventListener("visibilitychange", handleVisibilityChange);
        // Salvar periodicamente
        const persistInterval = setInterval(fullSaveSessionState, 30000);

        // Verifica estado inicial
        if (!navigator.onLine) {
            handleOffline();
        }

        return () => {
            disposeBackgroundViews();
            for (const off of busOffs) off?.();
            busOffs = [];
            for (const off of gestureOffs) off?.();
            gestureOffs = [];
            window.removeEventListener("resize", checkMobile);
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("beforeunload", fullSaveSessionState);
            document.removeEventListener("visibilitychange", handleVisibilityChange);
            if (reconnectTimer) clearInterval(reconnectTimer);
            if (persistInterval) clearInterval(persistInterval);
        };
    });
</script>

<!--
    Safe-area: no browser/PWA usa env(); dentro do app nativo (?appId=) o
    WebView já vem envolto por SafeArea no Flutter, então zeramos aqui pra não
    contar o inset duas vezes (padding-top/​bottom fantasma). A var cascateia
    pro componente filho (Sidebar).
-->
<svelte:window on:keydown={handleDesktopShortcut} />
<div
    class="shell"
    class:desktop-widget={desktopWidget}
    bind:this={shellEl}
    data-theme={theme}
    style="--safe-top: {appId ? '0px' : 'env(safe-area-inset-top)'}; --safe-bottom: {appId ? '0px' : 'env(safe-area-inset-bottom)'};"
>
    <!-- Loading screen -->
    {#if showLoading}
        <div class="loading-screen">
            <SigmaLoader size={64} />
        </div>
    {/if}

    <!-- Offline / reconnect toast -->
    {#if !isOnline}
        <div class="offline-toast" role="status" aria-live="polite">
            <div class="offline-shimmer"></div>
            <span class="offline-text">Reconectando…</span>
            <div class="offline-dot-row">
                <span class="off-dot"></span>
                <span class="off-dot"></span>
                <span class="off-dot"></span>
            </div>
        </div>
    {/if}

    <div class="bg-layer" aria-hidden="true">
        <div class="bg-noise"></div>
    </div>

    <!-- Sidebar -->
    {#if !desktopWidget}
        <Sidebar
            {system}
            {sessionId}
            {tabs}
            {isMobile}
            {mobilePanel}
            {theme}
            {refreshTrigger}
            {appTabs}
            chatTabs={chatTabsForWindows}
            {activeTab}
            {activeIsApp}
            {loadingMap}
            {unreadMap}
            bind:collapsed={sidebarCollapsed}
            bind:rightCollapsed={rightSidebarCollapsed}
            on:selectSession={handleSelectSession}
            on:clear={handleNewTab}
            on:openApp={handleOpenApp}
            on:deleteSession={handleSessionDelete}
            on:close={closePanel}
            on:selectApp={handleSelectApp}
            on:closeApp={handleCloseApp}
            on:closeAllApps={handleCloseAllApps}
            on:selectChat={handleSelectChat}
            on:closeChat={handleCloseChat}
            on:closeAllChats={handleCloseAllChats}
            on:togglePin={handleTogglePin}
            on:toggleTheme={handleToggleTheme}
        />
    {/if}

    <div class="main-area" class:push-left={isMobile && mobilePanel === 'left'} class:push-right={isMobile && mobilePanel === 'right'}>
        {#if !desktopWidget && isMobile && mobilePanel}
            <!-- Gaveta empurra o conteúdo em vez de escurecê-lo com um véu —
                 este botão invisível cobre o conteúdo deslocado e fecha a
                 gaveta ao tocar nele, como tocar a borda exposta de uma
                 gaveta física. -->
            <button
                class="push-catcher"
                on:click={closePanel}
                aria-label="Fechar gaveta"
            ></button>
        {/if}
        <!-- Tab bar desktop -->
        {#if !desktopWidget && !isMobile}
            <SessionTabs
                tabs={allTabs}
                {appTabs}
                {activeTab}
                {loadingMap}
                {theme}
                isMobile={false}
                rightSidebarOpen={!rightSidebarCollapsed}
                rightSidebarWidth={244}
                on:selectTab={handleSelectTab}
                on:newTab={handleNewTab}
                on:renameTab={handleRenameTab}
                on:togglePin={handleTogglePin}
                on:closeTab={handleCloseTab}
            />
        {/if}

        <!-- Top bar mobile: esquerda = docks/sessões · direita = apps -->
        {#if !desktopWidget && isMobile}
            <div class="mobile-topbar">
                <button
                    class="mtb-btn"
                    on:click={openLeft}
                    aria-label="Docks e sessões"
                >
                    <svg viewBox="0 0 16 16" fill="none" width="17" height="17">
                        <path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
                    </svg>
                </button>

                <button
                    class="mtb-title"
                    class:is-app={activeIsApp}
                    on:click={mobileHome}
                    title={activeTabName}
                >
                    {#if activeIsApp}
                        <svg viewBox="0 0 16 16" fill="none" width="14" height="14" class="mtb-back">
                            <path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>
                        </svg>
                    {/if}
                    <span class="mtb-title-text">{activeTabName}</span>
                </button>

                <button
                    class="mtb-btn"
                    on:click={openRight}
                    aria-label="Apps"
                >
                    <svg viewBox="0 0 20 20" fill="none" width="17" height="17">
                        <rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
                        <rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
                        <rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
                        <rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/>
                    </svg>
                </button>
            </div>
        {/if}

        <div class="tab-content">
            <div class="chat-panel" class:hidden={activeIsApp}>
                <MessageList
                    {history}
                    {isMobile}
                    sessionId={activeTab}
                    loading={loadingMap[activeTab] ?? false}
                    bind:this={listRef}
                    on:openCanvas={handleOpenCanvas}
                    on:resolvePermission={handleResolvePermission}
                    on:messageFeedback={handleMessageFeedback}
                    on:retry={(e) => retryTimedOutTurn(e.detail.sessionId, e.detail.index)}
                    on:useSuggestion={(e) => (message = e.detail)}
                />

                <ActivitySlot sessionId={activeTab} on:openSession={(e) => abrirChatPorDeepLink(e.detail)}>
                </ActivitySlot>

                {#if structuredProps}
                    <StructuredInput
                        steps={structuredProps}
                        on:send={onStructuredSend}
                        on:escape={onEscape}
                    />
                {:else}
                    <NotifyOptIn {appId} />
                    <InputBar
                        bind:value={message}
                        {isMobile}
                        loading={loadingMap[activeTab] ?? false}
                        sessionId={activeTab}
                        disabled={!isOnline}
                        on:send={send}
                        on:stop={(e) => handleStop(e?.detail)}
                        on:newSpecialistSession={handleNewSpecialistSession}
                    />
                {/if}
            </div>

            {#each appTabs as tab (tab.id)}
                <div class="iframe-panel" class:hidden={activeTab !== tab.id}>
                    {#if appLoadingMap[tab.id]}
                        <div class="app-loader">
                            <SigmaLoader size={32} color="#fff" />
                        </div>
                    {/if}
                    {#key appReloadKeys[tab.id] || 0}
                        <iframe
                            bind:this={iframeRefs[tab.id]}
                            src={tab.url}
                            title={tab.name}
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals allow-downloads"
                            allowfullscreen
                            on:load={() => {
                                try {
                                    applyThemeToDocument(iframeRefs[tab.id]?.contentDocument);
                                } catch {
                                    // URLs externas podem ser cross-origin e não são tematizáveis.
                                }
                                appLoadingMap = {
                                    ...appLoadingMap,
                                    [tab.id]: false,
                                };
                            }}
                        ></iframe>
                    {/key}
                </div>
            {/each}
        </div>

    </div>

    <Canvas
        html={canvasHtml}
        open={canvasOpen}
        on:close={() => (canvasOpen = false)}
    />

</div>

<style>
    .widget-panel-toggle {
        position: fixed;
        bottom: 1.25rem;
        right: 1.25rem;
        z-index: 55;
        width: 2.5rem;
        height: 2.5rem;
        border-radius: 9999px;
        border: 1px solid var(--border);
        background: var(--surface-2);
        color: var(--txt-2);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: color 0.15s, border-color 0.15s;
    }
    .widget-panel-toggle:hover {
        color: var(--txt);
        border-color: var(--border-strong);
    }

    /* ── Top bar mobile ── */
    .mobile-topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        padding: var(--safe-top, env(safe-area-inset-top)) 10px 0;
        position: relative;
        z-index: 10;
        border-bottom: 1px solid var(--border);
        background: transparent;
    }
    .mtb-btn {
        width: 40px;
        height: 40px;
        display: flex;
        align-items: center;
        justify-content: center;
        border-radius: 12px;
        border: 1px solid transparent;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        flex-shrink: 0;
        -webkit-tap-highlight-color: transparent;
        transition: background 0.15s, color 0.15s, border-color 0.15s;
    }
    .mtb-btn:active {
        background: var(--w06);
        color: var(--txt);
        border-color: var(--border);
        transform: scale(0.93);
    }
    .mtb-title {
        flex: 1;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        padding: 0 6px;
        background: transparent;
        border: none;
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        font-weight: 600;
        letter-spacing: 0.01em;
        cursor: default;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title.is-app {
        cursor: pointer;
    }
    .mtb-back {
        flex-shrink: 0;
        color: var(--txt-2);
    }
    .mtb-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }

    @media (max-width: 767px) {
        .widget-panel-toggle {
            display: none;
        }
    }

    :global(*),
    :global(*::before),
    :global(*::after) {
        box-sizing: border-box;
        margin: 0;
        padding: 0;
    }
    :global(body) {
        overflow: hidden;
        height: 100%;
        height: -webkit-fill-available;
    }
    :global(html) {
        height: 100%;
        height: -webkit-fill-available;
    }

    /* Rolagem global compacta, usando o contraste do tema. Os seletores que
       já escondem barras continuam mais específicos e preservam esse gesto. */
    :global(.shell),
    :global(.shell :where(*)) {
        scrollbar-width: thin;
        scrollbar-color: color-mix(in srgb, var(--txt) 14%, transparent) transparent;
    }
    :global(.shell ::-webkit-scrollbar) {
        width: 6px;
        height: 6px;
    }
    :global(.shell ::-webkit-scrollbar-track) {
        background: transparent;
    }
    :global(.shell ::-webkit-scrollbar-thumb) {
        border-radius: 999px;
        background: color-mix(in srgb, var(--txt) 14%, transparent);
    }
    :global(.shell ::-webkit-scrollbar-thumb:hover) {
        background: color-mix(in srgb, var(--txt) 30%, transparent);
    }

    .shell {
        --bg: #111111;
        --surface: #111111;
        --surface-2: #181818;
        --bg-elevated: #151515;
        --border: rgba(255, 255, 255, 0.07);
        --border-hi: rgba(255, 255, 255, 0.14);
        --border-strong: rgba(255, 255, 255, 0.22);
        --txt: #f5f5f5;
        --txt-2: #888888;
        --txt-3: rgba(136, 136, 136, 0.45);
        --accent: #ffffff;
        --accent-dim: rgba(255, 255, 255, 0.06);
        --accent-2: #ffffff;
        --overlay-1: rgba(255, 255, 255, 0.03);
        --overlay-2: rgba(255, 255, 255, 0.06);
        --overlay-3: rgba(255, 255, 255, 0.1);
        --agent-bg: var(--bg);
        --agent-surface: var(--surface);
        --agent-surface2: var(--surface-2);
        --agent-border: var(--border);
        --agent-border-hi: var(--border-hi);
        --agent-text: var(--txt);
        --agent-muted: var(--txt-2);
        --agent-muted2: var(--txt-3);
        --agent-teal: #ffffff;
        --agent-violet: #cccccc;
        --agent-pink: #aaaaaa;
        --agent-glow: rgba(255, 255, 255, 0.06);
        --agent-dim: rgba(255, 255, 255, 0.04);
        --btn-bg: rgba(255, 255, 255, 0.06);
        --btn-hover: rgba(255, 255, 255, 0.11);
        --user-bg: rgba(255, 255, 255, 0.05);
        --user-border: rgba(255, 255, 255, 0.1);
        --bot-bg: #111111;

        /* Generic white/black-wash opacity tokens for Sidebar/Apps/Sessions/
           InputBar2/SessionTabs — same values as Tailwind's white/[X]
           arbitrary opacities used throughout those components, but
           theme-reactive: white wash in dark mode, black wash in light. */
        --w01: rgba(255, 255, 255, 0.01);
        --w015: rgba(255, 255, 255, 0.015);
        --w018: rgba(255, 255, 255, 0.018);
        --w02: rgba(255, 255, 255, 0.02);
        --w025: rgba(255, 255, 255, 0.025);
        --w03: rgba(255, 255, 255, 0.03);
        --w04: rgba(255, 255, 255, 0.04);
        --w045: rgba(255, 255, 255, 0.045);
        --w05: rgba(255, 255, 255, 0.05);
        --w06: rgba(255, 255, 255, 0.06);
        --w07: rgba(255, 255, 255, 0.07);
        --w08: rgba(255, 255, 255, 0.08);
        --w09: rgba(255, 255, 255, 0.09);
        --w10: rgba(255, 255, 255, 0.1);
        --w12: rgba(255, 255, 255, 0.12);
        --w13: rgba(255, 255, 255, 0.13);
        --w14: rgba(255, 255, 255, 0.14);
        --w15: rgba(255, 255, 255, 0.15);
        --w18: rgba(255, 255, 255, 0.18);
        --w20: rgba(255, 255, 255, 0.2);
        --w22: rgba(255, 255, 255, 0.22);
        --w25: rgba(255, 255, 255, 0.25);
        --w30: rgba(255, 255, 255, 0.3);
        --w35: rgba(255, 255, 255, 0.35);
        --w40: rgba(255, 255, 255, 0.4);
        --w45: rgba(255, 255, 255, 0.45);
        --w50: rgba(255, 255, 255, 0.5);
        --w60: rgba(255, 255, 255, 0.6);
        --w70: rgba(255, 255, 255, 0.7);
        --w75: rgba(255, 255, 255, 0.75);
        --w80: rgba(255, 255, 255, 0.8);
        --w85: rgba(255, 255, 255, 0.85);
        --w90: rgba(255, 255, 255, 0.9);

        --r-lg: 14px;
        --r-md: 8px;
        /* Referenced throughout Sidebar.svelte as var(--radius-md/lg) — alias
           to the existing --r-* tokens instead of duplicating the value. */
        --radius-md: var(--r-md);
        --radius-lg: var(--r-lg);
        /* --tk-radius-* aliases — referenced by MenuList (New Topic) and
           InputBar2; same values as --radius-*, kept under the --tk-* name
           for consistency with the app-level design system. */
        --tk-radius-md: var(--r-md);
        --tk-radius-lg: var(--r-lg);

        /* Rail — Sidebar + mobile drawers. Always the "darker part" relative
           to the content, independent of the light/dark toggle: near-black
           here, white-with-border in the light variant below (a flat
           charcoal read as an unwanted dark smudge in light mode — white +
           border is what actually reads as "darker part" without being
           jarring). Object elevation ("Slate": soft double shadow, no
           gradient/sheen, lift on hover) lives on dock icons / session rows
           / new-topic, never on the rail container itself.  */
        --rail-bg: #0a0b0c;
        --rail-surface: #1c1d20;
        --rail-flat: rgba(255, 255, 255, 0.03);
        --rail-flat-hover: rgba(255, 255, 255, 0.055);
        --rail-border: rgba(255, 255, 255, 0.06);
        --rail-border-hi: rgba(255, 255, 255, 0.14);
        --rail-txt: #f0f1f3;
        --rail-txt-2: #8b8e96;
        --rail-txt-3: rgba(139, 142, 150, 0.5);
        --rail-shadow-rest: 0 4px 14px -6px rgba(0, 0, 0, 0.55), 0 12px 26px -16px rgba(0, 0, 0, 0.45);
        --rail-shadow-hover: 0 8px 20px -8px rgba(0, 0, 0, 0.6), 0 16px 32px -18px rgba(0, 0, 0, 0.5);
        --rail-active: rgba(255, 255, 255, 0.07);
        --rail-active-ring: rgba(255, 255, 255, 0.16);
        --rail-emphasis: rgba(255, 255, 255, 0.09);
        --push-shadow: rgba(0, 0, 0, 0.4);

        /* Content-area floating objects (InputBar, tabs, chips) — softer
           than the rail shadow since the content ground is never as dark. */
        --shadow-soft: 0 4px 14px -6px rgba(0, 0, 0, 0.5), 0 12px 28px -16px rgba(0, 0, 0, 0.4);
        --shadow-soft-hover: 0 8px 20px -8px rgba(0, 0, 0, 0.55), 0 18px 36px -18px rgba(0, 0, 0, 0.45);

        --font-head: "DM Sans", system-ui, sans-serif;
        --font-body: "DM Sans", system-ui, sans-serif;
        --font-mono: "DM Mono", "Courier New", monospace;

        /* Bootstrap 5 loads globally (other packages use its components);
           every one of its utility classes is !important, and some share a
           name with a Tailwind utility used here (border, rounded, shadow*).
           Bootstrap reads its own color/radius/shadow through these vars, so
           pointing them at Agent's tokens reclaims those classes without
           touching every occurrence in the markup below. */
        --bs-border-color: var(--border);
        --bs-border-width: 1px;
        --bs-border-style: solid;
        --bs-border-radius: 0.25rem;
        --bs-box-shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
        --bs-box-shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
        --bs-box-shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);

        display: flex;
        height: 100vh;
        height: 100dvh;
        background: var(--bg);
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        position: relative;
        overflow: hidden;
    }
    .shell.desktop-widget {
        height: 100%;
        min-height: 0;
    }

    /* Light variant — same token names, DESIGN.md palette (soft neutrals,
       never pure black/white). Everything under .shell reads these through
       var(), so this is the only place a new theme needs color values. */
    .shell[data-theme="light"] {
        --bg: #fafafa;
        --surface: #ffffff;
        --surface-2: #f0f0f0;
        --bg-elevated: #ffffff;
        --border: rgba(0, 0, 0, 0.08);
        --border-hi: rgba(0, 0, 0, 0.14);
        --border-strong: rgba(0, 0, 0, 0.22);
        --txt: #1a1a1a;
        --txt-2: #6b6b6b;
        --txt-3: rgba(107, 107, 107, 0.55);
        --accent: #1a1a1a;
        --accent-dim: rgba(0, 0, 0, 0.06);
        --accent-2: #1a1a1a;
        --overlay-1: rgba(0, 0, 0, 0.03);
        --overlay-2: rgba(0, 0, 0, 0.06);
        --overlay-3: rgba(0, 0, 0, 0.1);
        --agent-teal: #1a1a1a;
        --agent-violet: #444444;
        --agent-pink: #666666;
        --agent-glow: rgba(0, 0, 0, 0.06);
        --agent-dim: rgba(0, 0, 0, 0.04);
        --btn-bg: rgba(0, 0, 0, 0.05);
        --btn-hover: rgba(0, 0, 0, 0.09);
        --user-bg: rgba(0, 0, 0, 0.04);
        --user-border: rgba(0, 0, 0, 0.08);
        --bot-bg: #ffffff;

        --w01: rgba(0, 0, 0, 0.01);
        --w015: rgba(0, 0, 0, 0.015);
        --w018: rgba(0, 0, 0, 0.018);
        --w02: rgba(0, 0, 0, 0.02);
        --w025: rgba(0, 0, 0, 0.025);
        --w03: rgba(0, 0, 0, 0.03);
        --w04: rgba(0, 0, 0, 0.04);
        --w045: rgba(0, 0, 0, 0.045);
        --w05: rgba(0, 0, 0, 0.05);
        --w06: rgba(0, 0, 0, 0.06);
        --w07: rgba(0, 0, 0, 0.07);
        --w08: rgba(0, 0, 0, 0.08);
        --w09: rgba(0, 0, 0, 0.09);
        --w10: rgba(0, 0, 0, 0.1);
        --w12: rgba(0, 0, 0, 0.12);
        --w13: rgba(0, 0, 0, 0.13);
        --w14: rgba(0, 0, 0, 0.14);
        --w15: rgba(0, 0, 0, 0.15);
        --w18: rgba(0, 0, 0, 0.18);
        --w20: rgba(0, 0, 0, 0.2);
        --w22: rgba(0, 0, 0, 0.22);
        --w25: rgba(0, 0, 0, 0.25);
        --w30: rgba(0, 0, 0, 0.3);
        --w35: rgba(0, 0, 0, 0.35);
        --w40: rgba(0, 0, 0, 0.4);
        --w45: rgba(0, 0, 0, 0.45);
        --w50: rgba(0, 0, 0, 0.5);
        --w60: rgba(0, 0, 0, 0.6);
        --w70: rgba(0, 0, 0, 0.7);
        --w75: rgba(0, 0, 0, 0.75);
        --w80: rgba(0, 0, 0, 0.8);
        --w85: rgba(0, 0, 0, 0.85);
        --w90: rgba(0, 0, 0, 0.9);

        /* Rail in light theme is white — same family as the content, not a
           dark smudge — separated only by a hairline border. See the dark
           block above for why this isn't a fixed color across themes. */
        --rail-bg: #ffffff;
        --rail-surface: #f5f6f7;
        --rail-flat: rgba(16, 17, 20, 0.025);
        --rail-flat-hover: rgba(16, 17, 20, 0.045);
        --rail-border: rgba(16, 17, 20, 0.08);
        --rail-border-hi: rgba(16, 17, 20, 0.15);
        --rail-txt: #14151a;
        --rail-txt-2: #63666d;
        --rail-txt-3: rgba(99, 102, 109, 0.55);
        --rail-shadow-rest: 0 4px 14px -6px rgba(20, 20, 26, 0.10), 0 12px 26px -16px rgba(20, 20, 26, 0.08);
        --rail-shadow-hover: 0 8px 20px -8px rgba(20, 20, 26, 0.14), 0 16px 32px -18px rgba(20, 20, 26, 0.10);
        --rail-active: rgba(16, 17, 20, 0.05);
        --rail-active-ring: rgba(16, 17, 20, 0.14);
        --rail-emphasis: rgba(16, 17, 20, 0.055);
        --push-shadow: rgba(20, 20, 26, 0.14);

        --shadow-soft: 0 4px 14px -6px rgba(20, 20, 26, 0.10), 0 12px 26px -16px rgba(20, 20, 26, 0.08);
        --shadow-soft-hover: 0 8px 20px -8px rgba(20, 20, 26, 0.14), 0 16px 32px -18px rgba(20, 20, 26, 0.10);
    }

    /* The Σ mark — Agent's brand chip, used in Sidebar's header, the
       Agent entry in Apps.svelte's grid, and the Agent tab in
       SessionTabs.svelte. Global (not scoped) since it's applied from
       several sibling components. Fixed black/white regardless of theme —
       it's identity, not themed UI — with a very rounded square and a
       glyph sized down from the box to read as generously padded. */
    :global(.shell .sigma-mark) {
        background: #050505;
        color: #ffffff;
        font-family: "Ubuntu", -apple-system, "Segoe UI", sans-serif;
        border-radius: 30%;
        box-shadow: var(--rail-shadow-rest);
        transition: transform 0.18s cubic-bezier(0.2, 0.8, 0.2, 1), box-shadow 0.18s ease;
    }
    :global(.shell .sigma-mark:hover) { transform: translateY(-2px); box-shadow: var(--rail-shadow-hover); }

    /* Bootstrap's spacing utilities (p-, m-, gap- variants) hardcode rem
       values with !important instead of reading a var, and their 0-5 scale
       collides by name with Tailwind's, so the border/shadow var-bridge
       above can't reach them — each colliding class needs its Tailwind
       value restored directly, scoped under .shell so nothing outside
       Agent is touched. */
    :global(.shell .p-0) { padding: 0 !important; }
    :global(.shell .p-1) { padding: 0.25rem !important; }
    :global(.shell .p-2) { padding: 0.5rem !important; }
    :global(.shell .p-3) { padding: 0.75rem !important; }
    :global(.shell .p-4) { padding: 1rem !important; }
    :global(.shell .p-5) { padding: 1.25rem !important; }

    :global(.shell .px-0) { padding-inline: 0 !important; }
    :global(.shell .px-1) { padding-inline: 0.25rem !important; }
    :global(.shell .px-2) { padding-inline: 0.5rem !important; }
    :global(.shell .px-3) { padding-inline: 0.75rem !important; }
    :global(.shell .px-4) { padding-inline: 1rem !important; }
    :global(.shell .px-5) { padding-inline: 1.25rem !important; }

    :global(.shell .py-0) { padding-block: 0 !important; }
    :global(.shell .py-1) { padding-block: 0.25rem !important; }
    :global(.shell .py-2) { padding-block: 0.5rem !important; }
    :global(.shell .py-3) { padding-block: 0.75rem !important; }
    :global(.shell .py-4) { padding-block: 1rem !important; }
    :global(.shell .py-5) { padding-block: 1.25rem !important; }

    :global(.shell .pt-0) { padding-top: 0 !important; }
    :global(.shell .pt-1) { padding-top: 0.25rem !important; }
    :global(.shell .pt-2) { padding-top: 0.5rem !important; }
    :global(.shell .pt-3) { padding-top: 0.75rem !important; }
    :global(.shell .pt-4) { padding-top: 1rem !important; }
    :global(.shell .pt-5) { padding-top: 1.25rem !important; }

    :global(.shell .pb-0) { padding-bottom: 0 !important; }
    :global(.shell .pb-1) { padding-bottom: 0.25rem !important; }
    :global(.shell .pb-2) { padding-bottom: 0.5rem !important; }
    :global(.shell .pb-3) { padding-bottom: 0.75rem !important; }
    :global(.shell .pb-4) { padding-bottom: 1rem !important; }
    :global(.shell .pb-5) { padding-bottom: 1.25rem !important; }

    :global(.shell .m-0) { margin: 0 !important; }
    :global(.shell .m-1) { margin: 0.25rem !important; }
    :global(.shell .m-2) { margin: 0.5rem !important; }
    :global(.shell .m-3) { margin: 0.75rem !important; }
    :global(.shell .m-4) { margin: 1rem !important; }
    :global(.shell .m-5) { margin: 1.25rem !important; }

    :global(.shell .mx-0) { margin-inline: 0 !important; }
    :global(.shell .mx-1) { margin-inline: 0.25rem !important; }
    :global(.shell .mx-2) { margin-inline: 0.5rem !important; }
    :global(.shell .mx-3) { margin-inline: 0.75rem !important; }
    :global(.shell .mx-4) { margin-inline: 1rem !important; }
    :global(.shell .mx-5) { margin-inline: 1.25rem !important; }

    :global(.shell .my-0) { margin-block: 0 !important; }
    :global(.shell .my-1) { margin-block: 0.25rem !important; }
    :global(.shell .my-2) { margin-block: 0.5rem !important; }
    :global(.shell .my-3) { margin-block: 0.75rem !important; }
    :global(.shell .my-4) { margin-block: 1rem !important; }
    :global(.shell .my-5) { margin-block: 1.25rem !important; }

    :global(.shell .mt-0) { margin-top: 0 !important; }
    :global(.shell .mt-1) { margin-top: 0.25rem !important; }
    :global(.shell .mt-2) { margin-top: 0.5rem !important; }
    :global(.shell .mt-3) { margin-top: 0.75rem !important; }
    :global(.shell .mt-4) { margin-top: 1rem !important; }
    :global(.shell .mt-5) { margin-top: 1.25rem !important; }

    :global(.shell .mb-0) { margin-bottom: 0 !important; }
    :global(.shell .mb-1) { margin-bottom: 0.25rem !important; }
    :global(.shell .mb-2) { margin-bottom: 0.5rem !important; }
    :global(.shell .mb-3) { margin-bottom: 0.75rem !important; }
    :global(.shell .mb-4) { margin-bottom: 1rem !important; }
    :global(.shell .mb-5) { margin-bottom: 1.25rem !important; }

    :global(.shell .gap-0) { gap: 0 !important; }
    :global(.shell .gap-1) { gap: 0.25rem !important; }
    :global(.shell .gap-2) { gap: 0.5rem !important; }
    :global(.shell .gap-3) { gap: 0.75rem !important; }
    :global(.shell .gap-4) { gap: 1rem !important; }
    :global(.shell .gap-5) { gap: 1.25rem !important; }

    /* ── Loading ── */
    .loading-screen {
        position: fixed;
        inset: 0;
        z-index: 9999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        background: var(--bg);
        color: var(--txt);
        font-family: var(--font-body);
    }
    @keyframes shimmer {
        0% { transform: translateX(-100%); }
        100% { transform: translateX(100%); }
    }

    /* ── Offline toast ── */
    .offline-toast {
        position: fixed;
        top: 16px;
        left: 50%;
        transform: translateX(-50%);
        z-index: 9000;
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 9px 18px;
        background: var(--bg-elevated);
        border: 1px solid var(--border);
        border-radius: 24px;
        backdrop-filter: blur(12px);
        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
        animation: toast-in 0.25s cubic-bezier(0.4, 0, 0.2, 1);
        white-space: nowrap;
    }
    @keyframes toast-in {
        from {
            opacity: 0;
            transform: translateX(-50%) translateY(-10px);
        }
        to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
        }
    }
    .offline-shimmer {
        width: 40px;
        height: 3px;
        border-radius: 2px;
        background: var(--overlay-1);
        overflow: hidden;
        flex-shrink: 0;
        position: relative;
    }
    .offline-shimmer::after {
        content: "";
        position: absolute;
        inset: 0;
        background: linear-gradient(90deg, transparent 0%, var(--overlay-2) 50%, transparent 100%);
        animation: shimmer 1.6s ease-in-out infinite;
    }
    .offline-text {
        font-family: var(--font-mono);
        font-size: 11px;
        color: var(--txt-2);
        letter-spacing: 0.06em;
    }
    .offline-dot-row {
        display: flex;
        gap: 3px;
        align-items: center;
    }
    .off-dot {
        width: 3px;
        height: 3px;
        border-radius: 50%;
        background: var(--w30, rgba(255, 255, 255, 0.3));
        animation: off-pulse 1.4s ease-in-out infinite;
    }
    .off-dot:nth-child(2) {
        animation-delay: 0.18s;
    }
    .off-dot:nth-child(3) {
        animation-delay: 0.36s;
    }
    @keyframes off-pulse {
        0%,
        80%,
        100% {
            opacity: 0.15;
            transform: scale(0.8);
        }
        40% {
            opacity: 0.85;
            transform: scale(1.1);
        }
    }

    /* ── Background ── */
    .bg-layer {
        position: absolute;
        inset: 0;
        pointer-events: none;
        z-index: 0;
    }
    .bg-noise {
        position: absolute;
        inset: 0;
        opacity: 0.025;
        background-image: url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
        background-size: 128px 128px;
    }

    /* ── Main ── */
    .main-area {
        position: relative;
        z-index: 20;
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
        min-width: 0;
        background: var(--bg);
        transform: translateX(0);
        transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.32s cubic-bezier(0.32, 0.72, 0, 1);
    }
    .shell.desktop-widget .main-area { height: 100%; }
    /* Push mechanic — the mobile Sidebar panels (Sidebar.svelte, z-index 10)
       sit behind .main-area at rest; opening one shifts the content by
       exactly the panel's own width so the panel is revealed underneath,
       not overlaid with a scrim. */
    .main-area.push-left {
        transform: translateX(min(86vw, 340px));
        box-shadow: -14px 0 28px -16px var(--push-shadow);
    }
    .main-area.push-right {
        transform: translateX(calc(-1 * min(92vw, 400px)));
        box-shadow: 14px 0 28px -16px var(--push-shadow);
    }
    .push-catcher {
        position: absolute;
        inset: 0;
        z-index: 30;
        border: none;
        background: transparent;
        cursor: default;
        padding: 0;
    }
    .tab-content {
        flex: 1;
        position: relative;
        overflow: hidden;
    }
    .chat-panel {
        position: absolute;
        inset: 0;
        display: flex;
        flex-direction: column;
        transition: opacity 0.15s;
    }
    .chat-panel.hidden {
        opacity: 0;
        pointer-events: none;
    }
    .iframe-panel {
        position: absolute;
        inset: 0;
        transition: opacity 0.15s;
    }
    .iframe-panel.hidden {
        opacity: 0;
        pointer-events: none;
    }
    .iframe-panel iframe {
        display: block;
        width: 100%;
        height: 100%;
        border: none;
        /* Transparente (era #fff): apps temáticos pintam o próprio fundo full-bleed;
           branco fixo causava flash branco no load e gutters brancos em views
           centralizadas. */
        background: transparent;
    }

    .app-loader {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        align-items: center;
        justify-content: center;
        background: var(--bg);
    }
</style>
