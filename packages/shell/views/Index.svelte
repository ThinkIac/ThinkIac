<script>
    import { retryTurnInput } from './lib/retry-turn.js';
    import { onMount, tick } from "svelte";
    import Dialogs from "../../ui-dialogs/views/components/Dialogs.svelte";
    import ModalSheet from "../../ui-dialogs/views/components/ModalSheet.svelte";
    import { FILE_MANAGER_PREVIEW_EVENT, filePreviewUrl } from "../../file-manager/views/lib/protocol.js";

    import Sidebar from "./Sidebar.svelte";
    import MessageList from "./MessageList.svelte";
    import Canvas from "./Canvas.svelte";
    import SessionTabs from "./SessionTabs.svelte";

    import StructuredInput from "./components/StructuredInput.svelte";
    import SigmaLoader from "./components/SigmaLoader.svelte";
    import GlobalLoading from "./components/GlobalLoading.svelte";
    import ActivitySlot from "./components/ActivitySlot.svelte";
    import InputBar from "./InputBar.svelte";
    import NotifyOptIn from "./components/NotifyOptIn.svelte";
    import NtfyInbox from "./components/NtfyInbox.svelte";

    import { api } from "./api";
    import {
        historyStateWithMobileDestination,
        mobileDestinationFromHistoryState,
    } from "./lib/mobile_browser_history.js";
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
    import { headerActionMessage, headerActionsForView } from "./lib/header_actions.js";
    import { bootstrapBackgroundViews, publishBackgroundContext, disposeBackgroundViews } from "./lib/background_bootstrap.js";
    import { createNewTopicWorkspace } from "./lib/new_topic.js";
    import { closeAllChatTabs, closeChatTab } from "./lib/chat_tabs.js";
    import { createSessionActivationGuard } from "./lib/session_activation.js";
    import { closeAllAppTabs } from "./lib/app_tabs.js";
    import { moveTab, normalizeTabOrder } from "./lib/tab_groups.js";
    import { copyMessageTiming } from "./lib/message_time.js";
    import { adjacentTabId, desktopShortcutAction, isEditableShortcutTarget, isTextEditingShortcut } from "./lib/desktop_shortcuts.js";
    import { isHostedByDesktop } from "./lib/desktop-host.js";
    import { installShellControlBridge } from "./lib/shell-control-bridge.js";
    import {
        clearComposerDraft,
        loadComposerDraft,
        saveComposerDraft,
    } from "./lib/composer_drafts.js";
    import * as agentRuntime from "./agents/runtime.js";
    import {
        DEFAULT_AGENT_ID,
        getAgentCatalog,
        readSessionAgent,
        writeSessionAgent,
    } from "./agents/catalog.js";

    import {
        saveSessionState,
        restoreSessionState,
        clearSessionState,
    } from "./persistence.js";
    import { applyThemeToDocument, getTheme, setTheme, THEME_KEY } from "./theme.js";
    import { registerProfileScope } from "./lib/profiles_bootstrap.js";
    import { extractStructuredInput } from "./lib/structured_input.js";

    // ── GET params ───────────────────────────────────────────────────
    export let open; // "chat" | "app" | "result" | "path" — deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
    export let session; // sessionId para open=chat
    export let listen; // "1" solicita ditado nativo após a Shell montar
    export let app; // id do app (getActiveApps/getPackageViews) para open=app
    export let url; // caminho interno para open=path
    export let title; // rótulo opcional para open=path
    // open=result: um job de pacote terminou. Se `file` foi produzido e o
    // File Manager está instalado, abre o app de arquivos com o arquivo
    // selecionado; senão abre o próprio app do pacote (`pkg`) na tela de
    // resultado. Usado pela notificação de "pronto" do cnpj-search.
    export let pkg; // nome do pacote de origem (ex.: "cnpj-scraper")
    export let file; // caminho relativo do resultado (ex.: "uploads/companies/x.csv")
    // appId identifica a instalação e não representa geometria da tela.
    export let appId;
    // Mensagem entregue pelo compositor leve do Desktop quando o Shell ainda
    // não existia. Se já havia uma janela, ela chega por postMessage abaixo.
    export let handoff;
    export let desktopSession;
    export let agentId;
    // Coordenada persistente atribuída pelo Desktop. Sem ela, o Shell segue
    // standalone e usa a chave histórica, para não quebrar quem o abre direto.
    export let workspaceId;
    export let shellId;
    export let surface;
    $: floatingShell = surface === "floating-shell";

    // ── Tema (black default / white) ─────────────────────────────────
    let theme = "dark";
    let desktopHost = false;
    let nativeApp = false;
    let shellDesktopControl = null;
    let shellControlApps = [];
    $: shellScope = workspaceId && shellId ? { workspaceId, shellId } : null;
    const agentCatalog = getAgentCatalog();
    let activeAgentId = DEFAULT_AGENT_ID;

    $: activeAgent = agentCatalog.find((agent) => agent.id === activeAgentId)
        ?? agentCatalog.find((agent) => agent.id === DEFAULT_AGENT_ID);

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
    // A Shell já é entregue renderizada pelo servidor. Não pode iniciar com
    // uma camada que captura toques e depender da hidratação para removê-la:
    // no Runtime local, uma falha ou atraso de JavaScript deixava o chat
    // permanentemente cinza e inutilizável. Carregamentos próprios dos
    // conteúdos continuam tendo seus indicadores específicos.
    // Cobre a primeira hidratação com o mesmo Sigma usado durante um restart.
    // É removido no primeiro frame útil, antes que qualquer interação comece.
    let showLoading = true;
    let globalLoading = { active: false, id: null };
    let globalLoadingTimer = null;
    // O cabeçalho mobile continua montado quando recolhido. Isso preserva seu
    // estado e permite que os controles de tela cheia revelem a mesma superfície.
    let mobileHeaderCollapsed = false;

    // O app Android usa este canal apenas como confirmação opcional de que a
    // hidratação terminou. Fora da WebView, não há bridge e a Shell segue
    // completamente independente dela.
    function postEdgeStatus(payload) {
        try {
            const bridge = window.ThinkiacEdge;
            if (bridge && typeof bridge.postMessage === "function") {
                bridge.postMessage(JSON.stringify(payload));
            }
        } catch {
            // A bridge nativa nunca pode impedir a Shell de iniciar.
        }
    }

    function reportEdgeError(event) {
        postEdgeStatus({
            type: "error",
            message: event?.message || "Unidentified JavaScript error.",
        });
    }

    function reportEdgeRejection(event) {
        const reason = event?.reason;
        postEdgeStatus({
            type: "error",
            message: reason?.message || String(reason || "Promise rejeitada sem detalhe."),
        });
    }

    // ── Offline / reconnect ─────────────────────────────────────────
    let isOnline = true;
    let wasOffline = false;
    let reconnecting = false;
    let reconnectTimer = null;

    function setGlobalLoading(detail = {}) {
        const active = detail?.active !== false;
        if (!active && detail?.id && globalLoading.id && detail.id !== globalLoading.id) return;
        if (globalLoadingTimer) {
            clearTimeout(globalLoadingTimer);
            globalLoadingTimer = null;
        }
        globalLoading = active
            ? { active: true, id: typeof detail.id === "string" ? detail.id : "global" }
            : { active: false, id: null };
        if (active) {
            globalLoadingTimer = setTimeout(() => {
                globalLoading = { active: false, id: null };
                globalLoadingTimer = null;
            }, 120000);
        }
    }

    function processAssistantMessage(msg) {
        if (msg.role === "assistant" && msg.content) {
            const structured = extractStructuredInput(msg.content);
            msg._structuredData = structured.steps;
            msg.content = structured.content;
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
        const source = sessionCache[sid] || [];
        const message = source[source.length - 1];
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
                const current = sessionCache[sid] || [];
                const index = current.indexOf(message);
                if (index < 0) return;
                const updated = current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, _structuredData: null }
                    : item);
                sessionCache[sid] = updated;
                if (!activeIsApp && sessionId === sid) history = updated;
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
        const state = {
            tabs,
            appTabs,
            activeTab,
            sessionId,
            sessionCache,
            unreadMap,
            activeIsApp,
            tabOrder,
            mobileNavigation,
        };
        // O servidor é a fonte de verdade do histórico. Nunca o coloque no
        // snapshot: uma conversa pode carregar anexos, resultados de tools e
        // cards estruturados, multiplicando o uso de localStorage em cada
        // janela aberta. O cache em memória continua deixando a troca de abas
        // instantânea; após recarregar, activateSession busca o histórico.
        delete state.sessionCache;
        saveSessionState(state, shellScope);
    }

    function fullRestoreSessionState() {
        const state = restoreSessionState(shellScope);
        if (!state) return false;
        try {
            if (state.tabs && state.tabs.length > 0) {
                tabs = state.tabs;
            }
            if (state.appTabs) appTabs = state.appTabs;
            if (state.activeTab) activeTab = state.activeTab;
            if (state.sessionId) sessionId = state.sessionId;
            // Snapshots antigos podem conter megabytes de histórico. Não os
            // reidratamos: o backend já é canônico e evita um parse custoso no
            // boot. A próxima gravação substitui o snapshot antigo e o reduz.
            if (state.unreadMap) unreadMap = state.unreadMap;
            if (state.activeIsApp !== undefined) activeIsApp = state.activeIsApp;
            if (Array.isArray(state.mobileNavigation)) mobileNavigation = state.mobileNavigation;
            const persistedTabs = [...tabs, ...appTabs.map((tab) => ({ sessionId: tab.id }))];
            tabOrder = normalizeTabOrder(state.tabOrder, persistedTabs);
            return true;
        } catch (e) {
            console.warn("[Shell] Failed to restore state:", e.message);
            return false;
        }
    }

    function startReconnectLoop() {
        if (reconnectTimer) return;
        reconnectTimer = setInterval(async () => {
            try {
                const res = await agentRuntime.request("/provider", {
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
    // Administrado em System > Sessões. Sem preferência, o ID segue aleatório.
    let sessionPreferences = { idPrefix: "", defaultModel: null };
    const initialId = generateSessionId();
    let sessionId = initialId;
    let history = [];
    let system = { provider: "—", model: "—", connections: [] };
    let listRef;
    let composerStage;
    let composerDockHeight = 122;

    function measureComposerDock() {
        if (!composerStage) return;
        // O espaço extra evita a última mensagem encostar na sombra e cobre
        // menus/seleções que aumentam a barra depois da hidratação.
        composerDockHeight = Math.max(122, Math.ceil(composerStage.getBoundingClientRect().height + 16));
    }

    let sessionCache = {};
    let recentSessions = [];
    let recentSessionsLoading = false;
    let recentSessionsRequested = false;
    let recentSessionsVisibleCount = 5;
    const RECENT_SESSIONS_BATCH_SIZE = 5;

    $: visibleRecentSessions = recentSessions.slice(0, recentSessionsVisibleCount);

    function recentSessionLabel(session) {
        return session?.title || session?.summary || "Untitled conversation";
    }

    function recentSessionMeta(session) {
        const timestamp = session?.updated_at || session?.created_at;
        if (!timestamp) return "Conversation";
        const date = new Date(timestamp);
        if (Number.isNaN(date.getTime())) return "Conversation";
        const elapsed = Date.now() - date.getTime();
        if (elapsed < 60_000) return "just now";
        if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m ago`;
        if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h ago`;
        return date.toLocaleDateString(undefined, { day: "2-digit", month: "short" });
    }

    async function loadRecentSessions() {
        recentSessionsLoading = true;
        try {
            const response = await agentRuntime.requestForAgent(activeAgentId, "/sessions/list");
            const result = await response.json();
            const sessions = result?.data ?? result;
            recentSessions = Array.isArray(sessions)
                ? sessions.filter((item) => item?.id && item.id !== initialId)
                : [];
            recentSessionsVisibleCount = RECENT_SESSIONS_BATCH_SIZE;
        } catch {
            recentSessions = [];
        } finally {
            recentSessionsLoading = false;
        }
    }

    function maybeLoadRecentSessions() {
        if (recentSessionsRequested) return;
        recentSessionsRequested = true;
        loadRecentSessions();
    }

    function loadMoreRecentSessions() {
        if (recentSessionsVisibleCount >= recentSessions.length) return;
        recentSessionsVisibleCount = Math.min(
            recentSessionsVisibleCount + RECENT_SESSIONS_BATCH_SIZE,
            recentSessions.length,
        );
    }

    function handleRecentSessionsScroll(event) {
        const list = event.currentTarget;
        if (list.scrollTop + list.clientHeight >= list.scrollHeight - 12) {
            loadMoreRecentSessions();
        }
    }

    function recentSessionInfiniteScroll(node) {
        if (typeof IntersectionObserver === "undefined") return;
        const sentinel = node.querySelector(".recent-sessions-sentinel");
        if (!sentinel) return;
        const observer = new IntersectionObserver((entries) => {
            if (entries.some((entry) => entry.isIntersecting)) loadMoreRecentSessions();
        }, { root: node, threshold: 0.1 });
        observer.observe(sentinel);
        return { destroy: () => observer.disconnect() };
    }

    async function openRecentSession(sid) {
        if (!sid) return;
        recordMobileNavigation({ kind: "chat", id: sid });
        if (sessionId) sessionCache[sessionId] = [...history];
        const existing = tabs.find((tab) => tab.sessionId === sid);
        if (!existing) {
            const session = recentSessions.find((item) => item.id === sid);
            tabs = [...tabs, {
                sessionId: sid,
                name: recentSessionLabel(session),
                pinned: false,
            }];
        }
        activeTab = sid;
        activeIsApp = false;
        sessionId = sid;
        markChatRead(sid);
        fullSaveSessionState();
        await activateSession(sid);
    }

    function historyPath(sid, all = false) {
        const limit = all || !isMobile ? "all" : 100;
        return `/sessions/${encodeURIComponent(sid)}/history?limit=${limit}`;
    }

    let historyTruncated = false;
    let loadingFullHistory = false;

    async function loadFullHistory() {
        if (loadingFullHistory || !historyTruncated) return;
        const sid = sessionId;
        const agentId = readSessionAgent(localStorage, sid);
        loadingFullHistory = true;
        try {
            const data = await apiForAgent(agentId, historyPath(sid, true), "GET");
            if (sid !== sessionId || !Array.isArray(data)) return;
            const fullHistory = sanitizeHistoryMessages(data);
            sessionCache[sid] = fullHistory;
            history = fullHistory;
            historyTruncated = false;
            await tick();
            await listRef?.scrollBottom(true);
        } finally {
            loadingFullHistory = false;
        }
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
    const sessionActivation = createSessionActivationGuard();

    function generateSessionId() {
        const rand = Math.random().toString(36).slice(2, 10);
        const ts = Date.now().toString(36).slice(-4);
        const randomId = `${rand}${ts}`;
        const prefix = String(sessionPreferences?.idPrefix || "").trim().toLowerCase();
        return /^[a-z][a-z0-9_-]{0,24}$/.test(prefix) ? `${prefix}-${randomId}` : randomId;
    }

    async function loadSessionPreferences() {
        try {
            const response = await agentRuntime.request("/system/view");
            const payload = await response.json();
            const state = payload?.state ?? payload?.data?.state;
            if (response.ok && state) sessionPreferences = {
                idPrefix: state.idPrefix || "",
                defaultModel: state.defaultModel || null,
            };
        } catch {
            // Compatível com runtimes que ainda não oferecem a surface.
        }
    }

    async function applyDefaultModelToNewSession(id) {
        if (!sessionPreferences?.defaultModel) return;
        try {
            await agentRuntime.request("/session/model", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ session_id: id, model: sessionPreferences.defaultModel }),
            });
        } catch (error) {
            console.warn("Could not apply the session default model", error);
        }
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
    // O adapter resolve a rota de anexos do agente ativo.
    // anexar um arquivo que ela gerou.
    const ATTACH_RE =
        /\[Attached reference:\s*type=([^;\]]*);\s*path=([^;\]]*);\s*mime=([^;\]]*);\s*name=([^\]]*)\]/g;
    // Formato legado usado antes do marcador completo.
    const IMAGE_PATH_RE = /\[Image Path:\s*([^\]]+)\]/g;

    function attachmentUrl(p) {
        return agentRuntime.resourceUrl(`/attachment?path=${encodeURIComponent(p)}`);
    }

    function attachmentFromRef(type, filePath, mime, name) {
        const mimetype = (mime || "").trim() || "application/octet-stream";
        const clean = (filePath || "").trim();
        return {
            name: (name || "").trim() || clean.split("/").pop() || "file",
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
    // O SSR não conhece o viewport. Em telas mobile, a guarda CSS abaixo
    // evita que a árvore desktop inicial apareça antes de `checkMobile()`
    // trocar para a árvore correta durante a hidratação.
    let layoutReady = false;
    // Menu de borda aberto no mobile: 'left' (docks+sessões) | 'right' (apps) | null
    let mobilePanel = null;
    // Histórico de navegação é deliberadamente diferente da ordem das abas:
    // A → B → app → A deve voltar por essa sequência, não pela posição da aba.
    let mobileNavigation = [];
    let mobileForwardNavigation = [];
    let canGoBackMobile = false;
    let canGoForwardMobile = false;
    let chatMenuOpen = false;
    let chatMenuMessage = "";
    let chatMenuMessageTimer;
    let chatRefreshing = false;
    let chatInfoOpen = false;
    let bagSheetOpen = false;
    let bagStatus = null;
    let bagLoading = false;
    let bagError = "";
    let chatFeatureAvailability = { artifacts: false, bags: false };
    let shellEl;
    const iframeRefs = {};
    let gestureOffs = [];

    function openLeft() { mobilePanel = mobilePanel === "left" ? null : "left"; }
    function openRight() { mobilePanel = mobilePanel === "right" ? null : "right"; }
    function closePanel() { mobilePanel = null; }
    function dismissMobileMenus() { chatMenuOpen = false; appMenuOpen = false; }

    function currentMobileDestination() {
        if (!activeTab) return null;
        return activeIsApp ? { kind: "app", id: activeTab } : { kind: "chat", id: activeTab };
    }

    function isMobileDestinationAvailable(destination) {
        if (!destination?.id) return false;
        return destination.kind === "app"
            ? appTabs.some((tab) => tab.id === destination.id)
            : tabs.some((tab) => tab.sessionId === destination.id);
    }

    function recordMobileNavigation(next) {
        if (!isMobile || !next?.id) return;
        const current = currentMobileDestination();
        if (!current || (current.kind === next.kind && current.id === next.id)) return;
        mobileNavigation = [...mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        mobileForwardNavigation = [];
        // O Android/WebView só conhece history.pushState. Espelhar cada troca
        // interna faz o botão físico voltar para a aba anterior, sem sair do
        // Shell ou recarregar a página.
        window.history.pushState(
            historyStateWithMobileDestination(window.history.state, next),
            "",
            window.location.href,
        );
    }

    function replaceMobileBrowserHistoryEntry() {
        if (!isMobile) return;
        const current = currentMobileDestination();
        if (!current) return;
        window.history.replaceState(
            historyStateWithMobileDestination(window.history.state, current),
            "",
            window.location.href,
        );
    }

    async function handleMobileBrowserBack(event) {
        if (!isMobile) return;
        const destination = mobileDestinationFromHistoryState(event.state);
        if (!destination || !isMobileDestinationAvailable(destination)) return;
        const current = currentMobileDestination();
        if (current?.kind === destination.kind && current.id === destination.id) return;

        const isSameDestination = (entry) => entry?.kind === destination.kind && entry.id === destination.id;
        // Mantém os botões do Header coerentes depois do gesto/botão físico.
        // Uma volta consome o último item da pilha anterior; um avanço consome
        // o da pilha seguinte. O navegador já decidiu a direção para nós.
        if (isSameDestination(mobileNavigation[mobileNavigation.length - 1])) {
            mobileNavigation = mobileNavigation.slice(0, -1);
            if (current) mobileForwardNavigation = [...mobileForwardNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        } else if (isSameDestination(mobileForwardNavigation[mobileForwardNavigation.length - 1])) {
            mobileForwardNavigation = mobileForwardNavigation.slice(0, -1);
            if (current) mobileNavigation = [...mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        }

        // popstate já moveu o cursor do navegador. Não chamamos
        // recordMobileNavigation aqui, pois isso criaria uma nova entrada e
        // quebraria o avançar nativo.
        dismissMobileMenus();
        closePanel();
        await activateMobileDestination(destination);
    }

    $: canGoBackMobile = mobileNavigation.some(isMobileDestinationAvailable);
    $: canGoForwardMobile = mobileForwardNavigation.some(isMobileDestinationAvailable);

    async function activateMobileDestination(destination) {
        if (!destination || !isMobileDestinationAvailable(destination)) return;
        activeTab = destination.id;
        activeIsApp = destination.kind === "app";
        if (destination.kind === "chat") sessionId = destination.id;
        fullSaveSessionState();
        if (destination.kind === "chat") await activateSession(destination.id);
    }

    async function goBackMobile() {
        const history = [...mobileNavigation];
        let destination = null;
        while (history.length && !destination) {
            const candidate = history.pop();
            if (isMobileDestinationAvailable(candidate)) destination = candidate;
        }
        mobileNavigation = history;
        chatMenuOpen = false;
        appMenuOpen = false;
        if (!destination) return;
        const current = currentMobileDestination();
        if (current) mobileForwardNavigation = [...mobileForwardNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        await activateMobileDestination(destination);
    }

    async function goForwardMobile() {
        const history = [...mobileForwardNavigation];
        let destination = null;
        while (history.length && !destination) {
            const candidate = history.pop();
            if (isMobileDestinationAvailable(candidate)) destination = candidate;
        }
        mobileForwardNavigation = history;
        chatMenuOpen = false;
        appMenuOpen = false;
        if (!destination) return;
        const current = currentMobileDestination();
        if (current) mobileNavigation = [...mobileNavigation.filter(isMobileDestinationAvailable), current].slice(-40);
        await activateMobileDestination(destination);
    }

    async function closeActiveMobileTab() {
        const current = currentMobileDestination();
        if (!current) return;

        // A aba é removida antes da troca. Assim ela não pode reaparecer nos
        // controles de voltar ou avançar, mesmo que seja o único destino salvo.
        mobileNavigation = mobileNavigation.filter((item) => item.kind !== current.kind || item.id !== current.id);
        mobileForwardNavigation = mobileForwardNavigation.filter((item) => item.kind !== current.kind || item.id !== current.id);
        const previous = [...mobileNavigation].reverse().find(isMobileDestinationAvailable) ?? null;

        if (current.kind === "app") {
            appTabs = appTabs.filter((tab) => tab.id !== current.id);
            appLoadingMap = Object.fromEntries(Object.entries(appLoadingMap).filter(([id]) => id !== current.id));
        } else {
            tabs = tabs.filter((tab) => tab.sessionId !== current.id);
            tabOrder = tabOrder.filter((id) => id !== current.id);
            loadingMap = { ...loadingMap, [current.id]: false };
            unreadMap = { ...unreadMap, [current.id]: false };
            delete sessionCache[current.id];
        }

        chatMenuOpen = false;
        appMenuOpen = false;
        if (previous && isMobileDestinationAvailable(previous)) {
            await activateMobileDestination(previous);
            return;
        }

        const fallbackChat = tabs[0]?.sessionId;
        if (fallbackChat) {
            await activateMobileDestination({ kind: "chat", id: fallbackChat });
            return;
        }
        const fallbackApp = appTabs[0]?.id;
        if (fallbackApp) {
            await activateMobileDestination({ kind: "app", id: fallbackApp });
            return;
        }
        activeTab = "";
        sessionId = "";
        activeIsApp = false;
        history = [];
        fullSaveSessionState();
    }

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
        gestureOffs.push(installEdgeSwipeDetector(shellEl, (gesture) => router.dispatch(gesture), () => isMobile, () => mobilePanel));
    }

    // A configuração do menu virou um MODO DE EDIÇÃO INLINE no próprio Sidebar/
    // painéis (Reforma na Configuração dos Menus) — a engrenagem alterna o
    // store `menuEditMode` dentro do Sidebar, sem modal aqui.

    // Toque no título volta ao chat quando um app está em tela cheia
    function mobileHome() {
        if (canGoBackMobile) return goBackMobile();
        if (activeIsApp && sessionId) {
            activeIsApp = false;
            activeTab = sessionId;
            appMenuOpen = false;
        }
    }

    async function refreshMobileChat() {
        if (activeIsApp || chatRefreshing) return;
        chatMenuOpen = false;
        chatRefreshing = true;
        try {
            await refreshChat(activeTab, false);
            refreshTrigger++;
        } finally {
            chatRefreshing = false;
        }
    }

    function openChatInfo() {
        chatMenuOpen = false;
        chatInfoOpen = true;
    }

    async function loadChatFeatureAvailability() {
        const result = await api("/apps/availability?packages=artifacts,bags", "GET", null, "shell");
        if (result?.error || !result?.packages) return;
        chatFeatureAvailability = {
            artifacts: result.packages.artifacts === true,
            bags: result.packages.bags === true,
        };
    }

    async function openBag() {
        if (!chatFeatureAvailability.bags) return;
        const targetSessionId = activeIsApp ? sessionId : (activeTab || sessionId);
        chatMenuOpen = false;
        if (!targetSessionId) return;

        bagSheetOpen = true;
        bagStatus = null;
        bagError = "";
        bagLoading = true;
        try {
            const result = await api(`/status/${encodeURIComponent(targetSessionId)}`, "GET", null, "bags", { timeoutMs: 12000 });
            if (result?.success) bagStatus = result;
            else if (result?.error && result.code !== "route_not_found") bagError = result.error;
        } finally {
            bagLoading = false;
        }
    }

    function bagStepLabel(status) {
        return {
            done: "Done",
            skipped: "Skipped",
            in_progress: "In progress",
            failed: "Failed",
            pending: "Pending",
        }[status] ?? "Pending";
    }

    $: chatInfoHistory = sessionCache[activeTab] ?? history;
    $: chatInfoUsage = chatInfoHistory.reduce((total, message) => {
        const usage = message?.usage || {};
        return {
            prompt: total.prompt + Number(usage.prompt_tokens || usage.input_tokens || 0),
            completion: total.completion + Number(usage.completion_tokens || usage.output_tokens || 0),
            cost: total.cost + Number(usage.cost || 0),
        };
    }, { prompt: 0, completion: 0, cost: 0 });
    $: chatInfoTotalTokens = chatInfoUsage.prompt + chatInfoUsage.completion;
    $: chatInfoMessages = chatInfoHistory.filter((message) => String(message?.content ?? '').trim()).length;

    function formatChatNumber(value) {
        return new Intl.NumberFormat('en-US').format(value || 0);
    }

    function formatChatCost(value) {
        if (!Number.isFinite(value) || value <= 0) return 'Not available';
        return value < 0.01 ? `$${value.toFixed(4)}` : `$${value.toFixed(2)}`;
    }

    function openArtifactLibrary() {
        if (!chatFeatureAvailability.artifacts) return;
        chatMenuOpen = false;
        const targetSessionId = activeIsApp ? sessionId : (activeTab || sessionId);
        if (!targetSessionId) return;
        const filter = encodeURIComponent(targetSessionId);
        const artifactTabId = `artifacts:${targetSessionId}`;
        // Uma aba de artefatos já aberta preserva seu próprio filtro. Um novo
        // pedido abre outra aba, sem reutilizar ou alterar a anterior.
        const id = appTabs.some((tab) => tab.id === artifactTabId)
            ? `${artifactTabId}:${Date.now()}`
            : artifactTabId;
        handleOpenApp({ detail: {
            id,
            name: `Artifact - Id: ${targetSessionId}`,
            packageName: "artifacts",
            view: "Index",
            url: `/view/artifacts/Index?sessionId=${filter}`,
            description: "Artifacts generated in this conversation.",
            native: true,
        } });
    }

    async function copyActiveSessionId() {
        if (!sessionId) return;
        try {
            await navigator.clipboard.writeText(sessionId);
            chatMenuMessage = "Identifier copied.";
            clearTimeout(chatMenuMessageTimer);
            chatMenuMessageTimer = setTimeout(() => {
                chatMenuMessage = "";
            }, 2200);
        } catch {
            chatMenuMessage = "Unable to copy identifier.";
        }
    }

    function refreshMobileApp() {
        if (!activeIsApp) return;
        appMenuOpen = false;
        appRefreshingMap = { ...appRefreshingMap, [activeTab]: true };
        reloadApp(activeTab, false);
    }

    function enterMobileFullscreen() {
        dismissMobileMenus();
        mobileHeaderCollapsed = true;
    }

    // A bridge é criada pelo Android WebView antes do código da página. É o
    // sinal confiável do APK, inclusive depois que o login remove ?appId=.
    function returnToLauncher() {
        if (!nativeApp || !window.FlutterBridge?.postMessage) return;
        window.FlutterBridge.postMessage("return-to-launcher");
    }

    function checkMobile() {
        // Keep touch-first phones in the mobile layout when their WebView
        // reports a wider layout viewport than the physical screen.
        isMobile = window.matchMedia("(max-width: 767px)").matches
            || window.matchMedia("(pointer: coarse)").matches;
        maybeLoadRecentSessions();
        if (!isMobile) mobilePanel = null;
    }

    // ── Workspace tabs ───────────────────────────────────────────────
    let tabs = [{ sessionId: initialId, name: "New Mission", pinned: false }];
    let activeTab = initialId;
    let loadingMap = {};
    let unreadMap = {};
    let refreshTrigger = 0;
    let sidebarCollapsed = false;
    let rightSidebarCollapsed = false;
    // Desktop rail widths come from Sidebar.svelte. They must be part of the
    // main layout calculation as well: tabs live here, not inside Sidebar.
    let desktopSidebarWidth = 280;
    let desktopRightSidebarWidth = 280;
    let appReloadKeys = {};
    let tabOrder = [];
    let appMenuOpen = false;
    let appRefreshingMap = {};

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

    async function activateSession(sid) {
        const activation = sessionActivation.begin(sid);
        historyTruncated = false;
        activeAgentId = readSessionAgent(localStorage, sid);
        agentRuntime.activateAgent(activeAgentId);
        // Abrir a conversa também consome seus avisos informativos. A emissão
        // local fecha o toast imediatamente; a mensagem WS persiste a leitura.
        busEmitLocal("ntfy:session-read", { sessionId: sid });
        agentRuntime.send({
            type: "bus:emit",
            event: "ntfy:session-read",
            detail: { sessionId: sid },
        });
        if (sessionCache[sid]) {
            sessionId = sid;
            const cachedHistory = sessionCache[sid].map((m) => ({
                ...m,
                thinkingExpanded: m.thinkingExpanded ?? false,
            }));
            historyTruncated = isMobile && cachedHistory.length >= 100;
            sessionCache[sid] = cachedHistory;
            if (sessionActivation.isCurrent(activation, sessionId, activeIsApp)) {
                history = cachedHistory;
            }
            await discardResolvedGovernanceCard(sid);
            if (!sessionActivation.isCurrent(activation, sessionId, activeIsApp)) return;
            await tick();
            await listRef?.scrollBottom(true);
            // Cache pode estar defasado se a sessão segue respondendo
            reconcileSession(sid);
            return;
        }
        sessionId = sid;
        const data = await api(historyPath(sid), "GET");
        const loadedHistory = sanitizeHistoryMessages(data || []);
        if (!sessionActivation.isCurrent(activation, sessionId, activeIsApp)) return;
        historyTruncated = isMobile && loadedHistory.length >= 100;
        const liveHistory = sessionCache[sid];
        if (liveHistory?.some((item) => item?._localEchoContent)) {
            history = liveHistory;
            await tick();
            await listRef?.scrollBottom(true);
            reconcileSession(sid);
            return;
        }
        history = loadedHistory;
        if (loadedHistory.length > 0) sessionCache[sid] = loadedHistory;
        else delete sessionCache[sid];
        await discardResolvedGovernanceCard(sid);
        if (!sessionActivation.isCurrent(activation, sessionId, activeIsApp)) return;
        await tick();
        await listRef?.scrollBottom(true);
        // Se a sessão ainda está respondendo no servidor, reata o stream
        reconcileSession(sid);
    }

    // Uma sessão escolhe seu próprio agente. Reconexões de abas em segundo
    // plano não podem usar implicitamente o adapter da aba que está em foco.
    async function apiForAgent(agentId, path, method = "GET", body = null) {
        try {
            const options = { method, headers: { "Content-Type": "application/json" } };
            if (body) options.body = JSON.stringify(body);
            const response = await agentRuntime.requestForAgent(agentId, path, options);
            const payload = await response?.json?.();
            return payload?.data ?? payload ?? null;
        } catch {
            return null;
        }
    }

    // ── Tab event handlers ───────────────────────────────────────────
    async function handleSelectTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        if (sessionId) sessionCache[sessionId] = [...history];
        const isApp = appTabs.some((t) => t.id === sid);
        recordMobileNavigation({ kind: isApp ? "app" : "chat", id: sid });
        activeTab = sid;
        activeIsApp = isApp;
        if (!isApp) sessionId = sid;
        fullSaveSessionState();
        if (!isApp) {
            markChatRead(sid);
            await activateSession(sid);
        }
        if (isMobile) closePanel();
    }

    export async function handleNewTab() {
        const newId = generateSessionId();
        await applyDefaultModelToNewSession(newId);
        recordMobileNavigation({ kind: "chat", id: newId });
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
        fullSaveSessionState();
        refreshTrigger++;
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
            console.error("Failed to create specialist conversation:", error);
            return;
        }
        recordMobileNavigation({ kind: "chat", id: newId });

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
        fullSaveSessionState();
        refreshTrigger++;
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

    function handleMoveTab(e) {
        const { sourceId, targetId, after = false } = e?.detail ?? e ?? {};
        if (!sourceId || !targetId) return;
        tabOrder = moveTab(tabOrder, sourceId, targetId, after);
        fullSaveSessionState();
    }

    async function handleCloseTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        tabOrder = tabOrder.filter((id) => id !== sid);
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
        fullSaveSessionState();
        if (next.sessionId && next.sessionId !== sid) await activateSession(next.sessionId);
        delete sessionCache[sid];
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
        fullSaveSessionState();
        for (const sid of closedIds) delete sessionCache[sid];
        refreshTrigger++;
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
                                      error: result?.ok ? null : result?.error || "Could not record the decision. Please try again." }
                                  : p,
                          ),
                      }
                    : m,
            ),
        );
        if (result?.ok) busEmitLocal("notifications:resolved", { sessionId: target, requestId: request_id });
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
            // Governança exige atenção mesmo se a conversa estiver aberta em
            // outra aba ou o usuário estiver num app. O card continua sendo a
            // única superfície que efetivamente aprova ou nega a ação.
            busEmitLocal("notifications:push", {
                id: `governance:${sid}:${data.request_id}`,
                title: "Approval required",
                message: `${data.tool_name || "An action"} is awaiting your decision.`,
                click: `${window.location.origin}${window.location.pathname}?open=chat&session=${encodeURIComponent(sid)}`,
                priority: 5,
                tags: [`notify_id:governance:${sid}:${data.request_id}`],
                kind: "governance",
                requestId: data.request_id,
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
                        // Codex App Server identifica cada item; APIs HTTP
                        // carregam o id do tool call. Só no legado sem id o
                        // último step pendente é a associação mais segura.
                        let stepIndex = data.toolCallId
                            ? steps.map((step) => step.toolCallId).lastIndexOf(data.toolCallId)
                            : -1;
                        if (stepIndex < 0) stepIndex = steps.map((step) => step.result === undefined || step.result === null).lastIndexOf(true);
                        if (stepIndex < 0) stepIndex = steps.length - 1;
                        steps[stepIndex] = {
                            ...steps[stepIndex],
                            result: data.result,
                            completedAt: data.completedAt ?? new Date().toISOString(),
                        };
                        return { ...m, steps };
                    });
                });
                if (sid === sessionId) listRef?.scrollBottom();
                return;
            }
            const newStep = {
                toolCallId: data.toolCallId ?? null,
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
                startedAt: data.startedAt ?? new Date().toISOString(),
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
            if (sid === sessionId && !activeIsApp) {
                listRef?.scrollBottom();
            } else {
                const preview = String(data.response ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
                if (preview) busEmitLocal("notifications:push", {
                    id: `chat:${sid}:${data.epoch ?? "turn"}:${data.seq ?? Date.now()}`,
                    title: "Response complete", message: preview,
                    click: `${window.location.origin}${window.location.pathname}?open=chat&session=${encodeURIComponent(sid)}`,
                    priority: 3, tags: [`notify_id:chat:${sid}`],
                });
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
        const sessionAgentId = readSessionAgent(localStorage, sid);
        const generation = (reconcileGeneration[sid] || 0) + 1;
        reconcileGeneration[sid] = generation;
        const status = await apiForAgent(sessionAgentId, `/sessions/${sid}/status`, "GET");
        if (reconcileGeneration[sid] !== generation) return;
        if (!status) return; // servidor inacessível — não mexe no estado

        const cached = sessionCache[sid];
        // A mensagem enviada localmente ainda pode não existir no histórico
        // persistido quando o socket reconecta. Preserve esse eco até o replay
        // confirmar `user_message`, pois ele é a única cópia visível neste
        // intervalo.
        const hasLocalEcho = cached?.some((item) => item?._localEchoContent);
        const staleStreaming =
            cached?.length && cached[cached.length - 1]?.streaming;

        if (!status.active) {
            // Turno terminou (ou servidor reiniciou) enquanto estávamos fora:
            // se o cache tem bolha presa em streaming, recarrega do disco.
            if ((staleStreaming || loadingMap[sid]) && !hasLocalEcho) {
                delete sessionCache[sid];
                loadingMap = { ...loadingMap, [sid]: false };
                const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
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
            if (!cached?.length) {
                const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
                sessionCache[sid] = sanitizeHistoryMessages(data || []);
                if (sid === sessionId) history = sessionCache[sid];
            }
        }

        loadingMap = { ...loadingMap, [sid]: true };
        const r = await apiForAgent(sessionAgentId, "/chat/stream/reconnect", "POST", {
            session_id: sid,
            epoch: cursorMap[sid]?.epoch ?? null,
            last_event_id: cursorMap[sid]?.seq ?? null,
        });
        if (reconcileGeneration[sid] !== generation) return;
        if (r?.cursor_mismatch) {
            const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
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
            if (t.sessionId === targetSessionId && t.name === "New Mission") {
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
                        return `\n[Automatic OCR: ${a.name}]\n${a.ocrText}\n[/Automatic OCR]\n`;
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
            retry: detail?.retry === true,
        });

        if (!r?.accepted && !r?.queued && !r?.forwarded) {
            // Falha de rede ou rejeição HTTP: mantém a mensagem do usuário e
            // apresenta a causa na bolha de resposta.
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
                                      `Error: ${r?.error || "could not send the message (network failure)."}`,
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

    function animateComposerToDock() {
        const first = composerStage?.getBoundingClientRect();
        if (!first) return;
        tick().then(() => {
            const last = composerStage?.getBoundingClientRect();
            if (!last) return;
            const dx = first.left - last.left;
            const dy = first.top - last.top;
            composerStage.style.transition = "none";
            composerStage.style.transform = `translate(${dx}px, ${dy}px) scale(1.035)`;
            requestAnimationFrame(() => {
                composerStage.style.transition = "transform 320ms cubic-bezier(.22,.8,.2,1)";
                composerStage.style.transform = "";
                window.setTimeout(() => {
                    if (composerStage) composerStage.style.transition = "";
                }, 340);
            });
        });
    }

    async function openDesktopComposition(payload) {
        const detail = typeof payload === "object" && payload ? payload : { text: payload };
        const text = String(detail.text ?? "").trim();
        if (!text) return;

        const suppliedId = String(detail.sessionId ?? desktopSession ?? "").trim();
        const newId = /^[A-Za-z0-9_-]{1,200}$/.test(suppliedId) ? suppliedId : generateSessionId();
        if (!suppliedId) await applyDefaultModelToNewSession(newId);
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
        if (detail.agentId) {
            activeAgentId = writeSessionAgent(localStorage, newId, detail.agentId);
            agentRuntime.activateAgent(activeAgentId);
        }
        await send({ detail: { ...detail, text } });
    }

    // O handoff inicial chega pela URL somente quando o Desktop ainda não tem
    // uma janela do Shell. Ele precisa ser consumido antes do envio: caso a
    // janela seja recriada (hot reload, restauração do Desktop ou navegação),
    // manter `handoff` na URL faria a mesma mensagem ser enviada novamente.
    function consumeDesktopHandoff() {
        const text = String(handoff ?? "").trim();
        if (!text) return null;

        const detail = { text, sessionId: desktopSession, agentId };
        handoff = undefined;
        desktopSession = undefined;
        agentId = undefined;

        const url = new URL(window.location.href);
        url.searchParams.delete("handoff");
        url.searchParams.delete("desktopSession");
        url.searchParams.delete("agentId");
        window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);

        return detail;
    }

    async function handleSelectSession(e) {
        const { sessionId: newId, history: newHistory } = e.detail;
        recordMobileNavigation({ kind: "chat", id: newId });
        if (sessionCache[sessionId]) sessionCache[sessionId] = [...history];
        const existing = tabs.find((t) => t.sessionId === newId);
        if (!existing) {
            tabs = [
                ...tabs,
                { sessionId: newId, name: "New Mission", pinned: false },
            ];
        }
        activeTab = newId;
        activeIsApp = false;
        sessionId = newId;
        fullSaveSessionState();
        await activateSession(newId);
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
    // Workstation keeps a deterministic icon preview: iframe pixel capture is
    // inconsistent under sandbox and origin restrictions.
    let activeIsApp = false;
    $: {
        const current = activeIsApp ? appTabs.find((tab) => tab.id === activeTab) : null;
        publishBackgroundContext(activeIsApp
            ? { category: "app", contextId: current?.id || "unknown-app", contextLabel: current?.name || current?.label || "App" }
            : { category: "chat", contextId: "chat", contextLabel: "Chat" });
    }
    let appLoadingMap = {};
    // Um iframe pode carregar antes de o listener ser associado em uma troca
    // rápida de abas, ou nunca disparar `load` quando o navegador cancela uma
    // navegação em segundo plano. O Workstation não pode ficar bloqueado por
    // esse estado transitório: o indicador é apenas visual e expira rápido.
    const appLoadTimers = {};
    const APP_LOAD_FALLBACK_MS = 1200;

    function finishAppLoad(id) {
        if (!id) return;
        if (appLoadTimers[id]) {
            clearTimeout(appLoadTimers[id]);
            delete appLoadTimers[id];
        }
        if (appLoadingMap[id]) appLoadingMap = { ...appLoadingMap, [id]: false };
        if (appRefreshingMap[id]) appRefreshingMap = { ...appRefreshingMap, [id]: false };
    }

    function startAppLoad(id) {
        if (!id) return;
        finishAppLoad(id);
        appLoadingMap = { ...appLoadingMap, [id]: true };
        appLoadTimers[id] = setTimeout(() => finishAppLoad(id), APP_LOAD_FALLBACK_MS);
    }
    let statusModal = null;
    let notificationCenterOpen = false;
    let notificationCount = 0;
    let appInfoOpen = false;
    let appInfoTarget = null;
    let headerActionCatalog = [];

    $: activeAppInfo = activeIsApp
        ? appTabs.find((tab) => tab.id === activeTab) ?? null
        : null;
    $: activeHeaderActions = headerActionsForView(headerActionCatalog, activeAppInfo);
    $: activeAppIcon = (() => {
        if (!activeAppInfo) return null;
        if (theme === "dark") {
            if (activeAppInfo.iconDarkSvg) return { kind: "svg", value: activeAppInfo.iconDarkSvg };
            if (activeAppInfo.iconDark) return { kind: "image", value: activeAppInfo.iconDark };
        }
        if (activeAppInfo.iconSvg) return { kind: "svg", value: activeAppInfo.iconSvg };
        if (activeAppInfo.icon) return { kind: "image", value: activeAppInfo.icon };
        return null;
    })();
    $: activeAppInitials = String(activeAppInfo?.name || activeAppInfo?.packageName || "App")
        .trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AP";
    $: appInfoIcon = (() => {
        if (!appInfoTarget) return null;
        if (theme === "dark") {
            if (appInfoTarget.iconDarkSvg) return { kind: "svg", value: appInfoTarget.iconDarkSvg };
            if (appInfoTarget.iconDark) return { kind: "image", value: appInfoTarget.iconDark };
        }
        if (appInfoTarget.iconSvg) return { kind: "svg", value: appInfoTarget.iconSvg };
        if (appInfoTarget.icon) return { kind: "image", value: appInfoTarget.icon };
        return null;
    })();
    $: appInfoInitials = String(appInfoTarget?.name || appInfoTarget?.packageName || "App")
        .trim().split(/\s+/).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "AP";
    $: appInfoDetails = buildAppDetails(appInfoTarget);
    function buildAppDetails(app) {
        if (!app) return [];
        // The tab id is an internal compatibility key and can originate in an
        // external opener. The sheet intentionally displays only canonical,
        // safe package catalog metadata.
        const relativeUrl = String(app.url || "").replace(/^https?:\/\/[^/]+/i, "") || "Not available";
        return [
            { label: "Package", value: app.packageName || "Unknown" },
            ...(app.version ? [{ label: "Version", value: app.version }] : []),
            ...(app.description ? [{ label: "Description", value: app.description }] : []),
            ...(app.view ? [{ label: "View", value: app.view }] : []),
            { label: "View role", value: app.default ? "Package home" : "Additional view" },
            { label: "Mobile", value: app.mobileSupported === false ? "Not supported" : "Supported" },
            ...(app.entrypoint ? [{ label: "Entrypoint", value: app.entrypoint }] : []),
            ...(app.packageType ? [{ label: "Module type", value: app.packageType }] : []),
            ...(app.license ? [{ label: "License", value: app.license }] : []),
            ...(app.author ? [{ label: "Author", value: app.author }] : []),
            ...(app.nodeEngine ? [{ label: "Node.js", value: app.nodeEngine }] : []),
            ...(app.viewCount ? [{ label: "Package views", value: String(app.viewCount) }] : []),
            ...(Number.isFinite(app.scriptCount) ? [{ label: "Scripts", value: String(app.scriptCount) }] : []),
            ...(Number.isFinite(app.dependencyCount) ? [{ label: "Dependencies", value: String(app.dependencyCount) }] : []),
            ...(app.keywords?.length ? [{ label: "Keywords", value: app.keywords.join(", ") }] : []),
            ...(app.homepage ? [{ label: "Homepage", value: app.homepage }] : []),
            ...(app.repository ? [{ label: "Repository", value: app.repository }] : []),
            { label: "Route", value: relativeUrl },
        ];
    }

    function openAppInfo() {
        appMenuOpen = false;
        appInfoTarget = activeAppInfo;
        appInfoOpen = true;
    }

    async function bootstrapHeaderActions() {
        try {
            const catalog = await api("/apps/list", "GET", null, "shell");
            if (Array.isArray(catalog)) headerActionCatalog = catalog;
        } catch (error) {
            // Ações de cabeçalho são extensão opcional. O app ativo segue
            // disponível mesmo se o catálogo não puder ser atualizado.
            console.warn("[header-actions] failed to load contributions:", error);
        }
    }

    function runHeaderAction(action) {
        const frame = iframeRefs[activeTab];
        if (!action || !activeAppInfo || !frame?.contentWindow) return;
        appMenuOpen = false;
        frame.contentWindow.postMessage(headerActionMessage(action, activeAppInfo), window.location.origin);
    }

    function openCatalogAppInfo(event) {
        appMenuOpen = false;
        appInfoTarget = event.detail;
        appInfoOpen = true;
    }

    function closeAppInfo() {
        appInfoOpen = false;
        appInfoTarget = null;
    }

    $: rawTabs = [
        ...tabs.map((t) => ({ ...t, type: "chat" })),
        ...appTabs.map((t) => ({ ...t, type: "app", sessionId: t.id })),
    ];
    $: {
        const normalizedOrder = normalizeTabOrder(tabOrder, rawTabs);
        if (normalizedOrder.length !== tabOrder.length ||
            normalizedOrder.some((id, index) => id !== tabOrder[index])) {
            tabOrder = normalizedOrder;
        }
    }
    $: allTabs = tabOrder.map((id) => rawTabs.find((tab) => tab.sessionId === id)).filter(Boolean);

    function handleOpenApp(e) {
        const app = e.detail;
        const existing = appTabs.find((t) => t.id === app.id);
        recordMobileNavigation({ kind: "app", id: app.id });
        if (existing) {
            activeTab = app.id;
            activeIsApp = true;
            finishAppLoad(app.id);
            appMenuOpen = false;
            fullSaveSessionState();
            if (isMobile) closePanel();
            return;
        }
        const newAppTab = { ...app, type: "app" };
        appTabs = [...appTabs, newAppTab];
        activeTab = app.id;
        activeIsApp = true;
        appMenuOpen = false;
        startAppLoad(app.id);
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    function shellControlState() {
        const windows = appTabs.map((tab) => {
            const catalogApp = shellControlApps.find((item) => item.id === tab.id || item.url === tab.url);
            return {
                id: tab.id,
                appId: catalogApp?.appId || tab.id,
                title: tab.name || catalogApp?.name || "App",
                workspace: "shell",
                isMinimized: false,
                isMaximized: false,
                isFocused: activeIsApp && activeTab === tab.id,
            };
        });
        return {
            activeWorkspace: "shell",
            workspaces: [{ id: "shell", name: "Shell" }],
            activeWindowId: activeIsApp ? activeTab : null,
            windows,
            apps: shellControlApps.map((item) => ({
                appId: item.appId,
                name: item.name,
                description: item.description,
                isOpen: windows.some((win) => win.appId === item.appId),
                windowIds: windows.filter((win) => win.appId === item.appId).map((win) => win.id),
            })),
        };
    }

    async function loadShellControlApps() {
        const response = await api("/apps/list", "GET", null, "shell");
        const list = Array.isArray(response) ? response : [];
        shellControlApps = list
            .filter((item) => item?.url && item.default === true)
            .map((item) => ({
                appId: item.packageName || item.id || item.url,
                id: item.id || item.url,
                name: item.name || item.packageName || "App",
                description: item.description || "",
                url: item.url,
                source: item,
            }));
        return shellControlApps;
    }

    async function shellControlCommand(action, payload) {
        if (action === "list_apps" || action === "list_windows" || action === "get_state") return shellControlState();
        if (action !== "open_app") throw new Error("Action is not supported by Shell");
        const appId = String(payload?.appId || "").trim();
        // O Desktop pode pedir uma aba assim que o WebSocket abre, antes de a
        // consulta inicial do catálogo terminar. Resolve o catálogo aqui para
        // que esse primeiro comando não seja descartado como "não encontrado".
        if (!shellControlApps.length) await loadShellControlApps();
        const target = shellControlApps.find((item) => item.appId === appId);
        if (!target) throw new Error("App was not found in the Shell catalog");
        handleOpenApp({ detail: target.source });
        await tick();
        return shellControlState();
    }

    function installShellDesktopControl() {
        const bridge = installShellControlBridge({
            sessionId: () => sessionId,
            state: shellControlState,
            execute: shellControlCommand,
        });
        // Não bloqueia a conexão da ponte: o primeiro comando ainda pode
        // carregar o catálogo via shellControlCommand.
        loadShellControlApps().catch((error) => {
            console.warn("[desktop-control] Shell could not load the catalog", error);
        });
        return bridge;
    }

    $: {
        sessionId;
        appTabs;
        activeTab;
        activeIsApp;
        shellControlApps;
        shellDesktopControl?.updateState();
    }

    // ── Deep-link (notificação push — ver packages/ntfy/AGENT.md) ────
    // Abre (criando a aba se preciso) a sessão de chat de um sessionId que
    // pode nem estar entre as abas já abertas neste device.
    async function abrirChatPorDeepLink(sid) {
        if (!sid) return;
        recordMobileNavigation({ kind: "chat", id: sid });
        const existing = tabs.find((t) => t.sessionId === sid);
        if (!existing) {
            tabs = [
                ...tabs,
                { sessionId: sid, name: "New Mission", pinned: false },
            ];
        }
        activeTab = sid;
        activeIsApp = false;
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
        const apps = await api("/apps/list", "GET", null, "shell");
        const found = Array.isArray(apps)
            ? apps.find((a) => a.id === appTargetId)
            : null;
        if (!found) {
            console.warn(`[deep-link] app "${appTargetId}" not found`);
            return;
        }
        handleOpenApp({ detail: found });
    }

    // open=result: abre o resultado de um job de pacote. Se há `file` e o File
    // Manager está instalado, abre-o com o arquivo selecionado; senão cai pro
    // app do próprio pacote (`pkg`) na sua tela de resultado.
    async function abrirResultadoPorDeepLink({ pkg: sourcePkg, file: resultFile }) {
        const apps = await api("/apps/list", "GET", null, "shell");
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
        const apps = await api("/apps/list", "GET", null, "shell");
        const list = Array.isArray(apps) ? apps : [];
        const target = String(pkg).toLowerCase();
        const found =
            list.find((a) => a.id === pkg || a.url === pkg) ||
            list.find((a) => a?.url?.includes(`/view/${pkg}/`)) ||
            list.find((a) => (a.name || "").toLowerCase() === target);
        if (!found) {
            console.warn(`[bus] open:app: "${pkg}" not found`);
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
            const apps = await api("/apps/list", "GET", null, "shell");
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

    function abrirCaminhoInterno(path, label = "Page") {
        if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return;
        return abrirAppComPath({ url: path, title: label });
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
        // Ponte front→back: eventos logos:/think: (ou {server:true}) viajam
        // pelo WS e viram dispatchEvent no backend.
        setServerForwarder((event, detail) =>
            agentRuntime.send({ type: "bus:emit", event, detail }),
        );
        busOffs.push(busOn("open:app", (pkg) => abrirAppPorPacote(pkg)));
        busOffs.push(busOn("shell:loading", (detail) => setGlobalLoading(detail)));
        busOffs.push(busOn("shell:reload", () => {
            // O widget vive em iframe; o Shell é quem pode resetar toda a
            // página e reconstruir os widgets usando o cache já limpo.
            window.location.reload();
        }));
        busOffs.push(busOn("agent:deep-link", (target) => {
            if (target?.type === "chat") return abrirChatPorDeepLink(target.session);
            if (target?.type === "app") return abrirAppPorDeepLink(target.app);
            if (target?.type === "result") return abrirResultadoPorDeepLink(target);
        }));
        busOffs.push(busOn("open:iframe", (d) => abrirIframe(d)));
        busOffs.push(busOn("open:with", (d) => abrirAppComPath(d)));
        busOffs.push(busOn(FILE_MANAGER_PREVIEW_EVENT, (d) => abrirPreviewNoFileManager(d)));
        // Um pacote ou controle local pode pedir uma view modal sem precisar
        // conhecer o estado visual do Shell. URLs relativas evitam que esse
        // canal vire uma abertura arbitrária de conteúdo externo.
        busOffs.push(busOn("modal-ui", (modal) => {
            if (!modal?.label || typeof modal.url !== "string" || !modal.url.startsWith("/")) return;
            statusModal = { label: modal.label, url: modal.url };
        }));
        // Permite que um package (rodando em iframe) abra o Canvas de verdade
        // via parent.postMessage({source:"aurora", type:"open:canvas", detail:{html}}),
        // mesmo caminho que MessageList usa internamente (handleOpenCanvas).
        busOffs.push(busOn("open:canvas", (d) => handleOpenCanvas({ detail: d || {} })));
        busOffs.push(busOn("message-actions:refresh", () => bootstrapMessageActions()));
        // A menu contribution runs one iframe below the Shell. Forward a
        // selected central notification to the Desktop host, which owns the
        // native governance approval overlay.
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
        if (!appTabs.some((tab) => tab.id === id)) return;
        activeTab = id;
        activeIsApp = true;
        // A tab can be selected again after its iframe load event was dropped
        // while it was backgrounded. Never let that stale loading state cover
        // the restored package view.
        finishAppLoad(id);
        fullSaveSessionState();
        if (isMobile) closePanel();
    }

    function handleCloseApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        finishAppLoad(id);
        appTabs = appTabs.filter((t) => t.id !== id);
        if (activeTab === id) {
            activeTab = sessionId;
            activeIsApp = false;
        }
        fullSaveSessionState();
    }

    function handleCloseAllApps() {
        Object.keys(appLoadTimers).forEach(finishAppLoad);
        const next = closeAllAppTabs({ appTabs, activeTab, activeIsApp, sessionId });
        appTabs = next.appTabs;
        activeTab = next.activeTab;
        activeIsApp = next.activeIsApp;
        fullSaveSessionState();
    }

    function handleReorderApps(event) {
        const { id, targetId } = event?.detail || {};
        const from = appTabs.findIndex((tab) => tab.id === id);
        const to = appTabs.findIndex((tab) => tab.id === targetId);
        if (from < 0 || to < 0 || from === to) return;
        const next = [...appTabs];
        const [tab] = next.splice(from, 1);
        next.splice(to, 0, tab);
        appTabs = next;
        fullSaveSessionState();
    }

    function handleOpenSeparateWindow(event) {
        if (!desktopHost) return;
        const tab = event?.detail;
        if (!tab?.sessionId) return;
        const detail = tab.type === "app"
            ? { kind: "app", appId: tab.id || tab.sessionId }
            : { kind: "chat", sessionId: tab.sessionId };
        window.parent.postMessage({
            source: "thinkiac-shell",
            type: "open:shell-window",
            detail,
        }, window.location.origin);
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
        const handlerStep = structuredProps?.find((step) => step?.submitEvent || step?.localAction);
        const detail = e?.detail ?? {};
        if (!handlerStep) {
            send(e);
            detail.acknowledge?.();
            return;
        }
        // Use a rota confirmável para aprovações de governança. O envio WS é
        // fire-and-forget e antes fazia o botão parecer aceito sem gravar nada.
        if (handlerStep.governanceDecisionId) {
            const approved = detail.responses?.[structuredProps.indexOf(handlerStep)] === handlerStep.confirmLabel;
            try {
                const response = await fetch('/governance/confirmations/resolve', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId, decisionId: handlerStep.governanceDecisionId, approved }),
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || result?.success === false || !(result?.data?.status || result?.status)) {
                    throw new Error(result?.error || `Could not record approval (HTTP ${response.status}).`);
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
    $: agentRuntime.subscribeAll(tabs.map((t) => t.sessionId));
    $: if (agentRuntime.isReady()) {
        agentRuntime.setUiState({
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
        let disposed = false;
        nativeApp = Boolean(window.FlutterBridge?.postMessage);
        desktopHost = isHostedByDesktop(window);
        if (!desktopHost) {
            const bridge = installShellDesktopControl();
            if (disposed) bridge.stop();
            else shellDesktopControl = bridge;
        }
        theme = getTheme();
        activeAgentId = readSessionAgent(localStorage, sessionId);
        agentRuntime.activateAgent(activeAgentId);
        loadSessionPreferences();
        checkMobile();
        layoutReady = true;

        bootstrapBackgroundViews().then(() => publishBackgroundContext({ category: "chat", contextId: "chat", contextLabel: "Chat" }));

        // ── Canal WS de eventos de chat ──
        agentRuntime.on((envelope) => {
            const msg = envelope.message;
            if (msg.type === "chat:event") {
                if (envelope.agentId !== readSessionAgent(localStorage, msg.session_id)) return;
                applyChatEvent(msg.session_id, msg.event, msg.data, msg.seq, msg.epoch);
            } else if (msg.type === "sessions:updated") {
                refreshTrigger++;
                if (history.length === 0) maybeLoadRecentSessions();
            } else if (msg.type === "bus:event") {
                // Evento vindo do backend → re-emite no bus local (sem
                // reencaminhar, para não criar loop).
                busEmitLocal(msg.event, msg.detail);
            }
        });
        // A cada (re)abertura do socket, reconcilia as sessões abertas —
        // cobre tanto o primeiro load (sessão pode estar respondendo desde
        // antes do refresh) quanto quedas de conexão no meio do stream.
        agentRuntime.onReopen((reopenedAgentId) => {
            agentRuntime.subscribeAll(tabs.map((t) => t.sessionId));
            agentRuntime.setUiState({
                activeChatSessionId: activeIsApp ? null : sessionId,
            });
            for (const t of tabs) {
                if (readSessionAgent(localStorage, t.sessionId) === reopenedAgentId) reconcileSession(t.sessionId);
            }
        });
        agentRuntime.onCommand(({ agentId: commandAgentId, command }) => {
            if (commandAgentId !== activeAgentId) return;
            if (command?.type === "navigate" && typeof command.path === "string" && command.path.startsWith("/") && !command.path.startsWith("//")) {
                window.location.assign(command.path);
            } else if (command?.type === "request-snapshot") {
                agentRuntime.sendSnapshot(createUiSnapshot());
            }
        });
        agentRuntime.connectAll();

        // Registra widgets contribuídos por pacotes e liga o bus de UI.
        setupWidgetBus();
        // Descobre itens de menu contribuídos por pacotes (manifest.menu).
        bootstrapMenuItems();
        // Descobre ações de cabeçalho declaradas por addons e pacotes.
        bootstrapHeaderActions();
        // As ações contextuais não tornam seus pacotes apps do catálogo.
        // Consulta a disponibilidade explicitamente para nunca oferecer uma
        // rota que não está instalada neste Runtime.
        loadChatFeatureAvailability();

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
        if (!restored || !tabs.length) loadWorkspace();

        // A entrada atual é a base da navegação interna. Ela é substituída,
        // nunca acrescentada, para preservar a rota que abriu o Shell.
        replaceMobileBrowserHistoryEntry();

        // Deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
        // — tem prioridade sobre a sessão restaurada/padrão acima.
        if (open === "chat" && session) {
            abrirChatPorDeepLink(session);
        } else if (open === "app" && app) {
            abrirAppPorDeepLink(app);
        } else if (open === "result") {
            abrirResultadoPorDeepLink({ pkg, file });
        } else if (open === "path") {
            abrirCaminhoInterno(url, title || "Home page");
        }
        if (open === "chat" && listen === "1") {
            tick().then(() => window.dispatchEvent(
                new CustomEvent("thinkiac:shell:start-dictation"),
            ));
        }

        // A URL é usada somente para a primeira abertura. Nas seguintes, o
        // Desktop envia diretamente ao iframe focado para não recarregar a
        // janela nem criar uma segunda sessão.
        const initialDesktopHandoff = consumeDesktopHandoff();
        if (initialDesktopHandoff) openDesktopComposition(initialDesktopHandoff);
        const onDesktopMessage = (event) => {
            const data = event.data;
            if (data?.source !== "thinkiac-desktop") return;
            if (data.type === "shell:new-message") {
                openDesktopComposition(data.detail);
            } else if (data.type === "shell:open-session") {
                handleSelectSession({ detail: { sessionId: data.detail?.sessionId } });
            } else if (data.type === "shell:stop") {
                handleStop(data.detail?.sessionId);
            }
        };
        window.addEventListener("message", onDesktopMessage);
        setupGestureProtocol();

        // A altura do composer não é fixa: o textarea, anexos e controles
        // opcionais podem crescer sem uma nova mensagem. A MessageList usa
        // esta medida para nunca terminar atrás dele.
        let composerObserver = null;
        tick().then(() => {
            measureComposerDock();
            if (typeof ResizeObserver !== "undefined" && composerStage) {
                composerObserver = new ResizeObserver(measureComposerDock);
                composerObserver.observe(composerStage);
            }
        });

        window.addEventListener("resize", checkMobile);
        window.addEventListener("popstate", handleMobileBrowserBack);
        window.addEventListener("online", handleOnline);
        window.addEventListener("offline", handleOffline);

        // ── Eventos de persistência ──
        window.addEventListener("beforeunload", fullSaveSessionState);
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) fullSaveSessionState();
        });
        // Salvar periodicamente
        const persistInterval = setInterval(fullSaveSessionState, 30000);

        // Verifica estado inicial
        if (!navigator.onLine) {
            handleOffline();
        }

        // A confirmação ocorre no próximo frame, quando a árvore Svelte já
        // foi hidratada e a WebView pode remover seu loading nativo com
        // segurança. Não depende de consultas frágeis ao DOM.
        requestAnimationFrame(() => {
            showLoading = false;
            postEdgeStatus({ type: "ready", surface: floatingShell ? "floating-shell" : "default" });
        });

        return () => {
            composerObserver?.disconnect();
            disposed = true;
            shellDesktopControl?.stop();
            disposeBackgroundViews();
            for (const off of busOffs) off?.();
            busOffs = [];
            for (const off of gestureOffs) off?.();
            gestureOffs = [];
            window.removeEventListener("resize", checkMobile);
            window.removeEventListener("popstate", handleMobileBrowserBack);
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("beforeunload", fullSaveSessionState);
            window.removeEventListener("message", onDesktopMessage);
            document.removeEventListener(
                "visibilitychange",
                fullSaveSessionState,
            );
            if (reconnectTimer) clearInterval(reconnectTimer);
            if (globalLoadingTimer) clearTimeout(globalLoadingTimer);
            if (persistInterval) clearInterval(persistInterval);
        };
    });
</script>

<svelte:head>
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>ThinkIac</title>
</svelte:head>

<!--
    Safe-area: no browser/PWA usa env(); dentro do app nativo a presença da
    ponte confirma que a WebView já vem envolta por SafeArea, então zeramos pra não
    contar o inset duas vezes (padding-top/​bottom fantasma). A var cascateia
    pro componente filho (Sidebar).
-->
<svelte:window
    on:keydown={handleDesktopShortcut}
    on:click={dismissMobileMenus}
    on:error={reportEdgeError}
    on:unhandledrejection={reportEdgeRejection}
/>
<div
    class="shell"
    class:floating-shell={floatingShell}
    class:layout-ready={layoutReady}
    data-thinkiac-shell="ready"
    bind:this={shellEl}
    data-theme={theme}
    style="--safe-top: {nativeApp ? '0px' : 'env(safe-area-inset-top)'}; --safe-bottom: {nativeApp ? '0px' : 'env(safe-area-inset-bottom)'};"
>
    {#if isMobile && !mobilePanel}
        <!-- Fica acima de iframes no browser/PWA: eventos iniciados dentro de
             um iframe não atravessam para o documento pai. -->
        <div class="mobile-swipe-edge mobile-swipe-edge-left" aria-hidden="true"></div>
        <div class="mobile-swipe-edge mobile-swipe-edge-right" aria-hidden="true"></div>
    {/if}
    <GlobalLoading
        active={showLoading || globalLoading.active || !isOnline}
    />

    <div class="bg-layer" aria-hidden="true">
        <div class="bg-noise"></div>
    </div>

    <!-- Sidebar -->
    {#if !floatingShell}
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
        desktopHost={desktopHost}
        {nativeApp}
            bind:collapsed={sidebarCollapsed}
            bind:rightCollapsed={rightSidebarCollapsed}
        bind:sidebarWidth={desktopSidebarWidth}
        bind:rightSidebarWidth={desktopRightSidebarWidth}
        on:selectSession={handleSelectSession}
        on:clear={handleNewTab}
        on:openApp={handleOpenApp}
        on:appInfo={openCatalogAppInfo}
        on:deleteSession={handleSessionDelete}
        on:close={closePanel}
        on:selectApp={handleSelectApp}
        on:closeApp={handleCloseApp}
        on:closeAllApps={handleCloseAllApps}
        on:reorderApps={handleReorderApps}
        on:selectChat={handleSelectChat}
        on:closeChat={handleCloseChat}
        on:closeAllChats={handleCloseAllChats}
        on:togglePin={handleTogglePin}
        on:toggleTheme={handleToggleTheme}
        on:returnToModeChoice={returnToLauncher}
    />
    {/if}

    {#if isMobile && !floatingShell && mobileHeaderCollapsed}
        <nav class="mobile-fullscreen-sidebar-controls" aria-label="Open side panels">
            {#if mobilePanel !== "right"}
                <button
                    type="button"
                    class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-left"
                    class:open={mobilePanel === "left"}
                    on:click={openLeft}
                    aria-label={mobilePanel === "left" ? "Close conversations panel" : "Open conversations panel"}
                    aria-expanded={mobilePanel === "left"}
                    title={mobilePanel === "left" ? "Close conversations panel" : "Open conversations panel"}
                >
                    <svg viewBox="0 0 16 24" width="10" height="16" fill="none" aria-hidden="true">
                        <path d="m5 4 7 8-7 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            {/if}
            {#if mobilePanel !== "left"}
                <button
                    type="button"
                    class="mobile-fullscreen-sidebar-toggle mobile-fullscreen-sidebar-toggle-right"
                    class:open={mobilePanel === "right"}
                    on:click={openRight}
                    aria-label={mobilePanel === "right" ? "Close applications panel" : "Open applications panel"}
                    aria-expanded={mobilePanel === "right"}
                    title={mobilePanel === "right" ? "Close applications panel" : "Open applications panel"}
                >
                    <svg viewBox="0 0 16 24" width="10" height="16" fill="none" aria-hidden="true">
                        <path d="m11 4-7 8 7 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
                    </svg>
                </button>
            {/if}
        </nav>
    {/if}

    <div
        class="main-area"
        class:push-left={isMobile && mobilePanel === 'left'}
        class:push-right={isMobile && mobilePanel === 'right'}
        style="--shell-left-rail: {!floatingShell && !isMobile && !sidebarCollapsed ? `${desktopSidebarWidth}px` : '0px'}; --shell-right-rail: {!floatingShell && !isMobile && !rightSidebarCollapsed ? `${desktopRightSidebarWidth}px` : '0px'};"
    >
        {#if isMobile && mobilePanel}
            <!-- Gaveta empurra o conteúdo em vez de escurecê-lo com um véu —
                 este botão invisível cobre o conteúdo deslocado e fecha a
                 gaveta ao tocar nele, como tocar a borda exposta de uma
                 gaveta física. -->
            <button
                class="push-catcher"
                on:click={closePanel}
                aria-label="Close drawer"
            ></button>
        {/if}
        <!-- Tab bar desktop -->
        {#if !isMobile}
            <SessionTabs
                tabs={allTabs}
                {appTabs}
                {activeTab}
                {loadingMap}
                {theme}
                headerActions={activeHeaderActions}
                isMobile={false}
                on:selectTab={handleSelectTab}
                on:newTab={handleNewTab}
                on:renameTab={handleRenameTab}
                on:closeTab={handleCloseTab}
                on:moveTab={handleMoveTab}
                on:openSeparate={handleOpenSeparateWindow}
                on:headerAction={(event) => runHeaderAction(event.detail)}
                hostedByDesktop={desktopHost}
            />
        {/if}

        <!-- Os menus de Widget permanecem acessíveis também nas views de
             pacote. Os controles específicos do pacote entram ao lado do
             nome, sem substituir os atalhos declarativos das gavetas. -->
        {#if isMobile && !floatingShell}
            <div class="mobile-topbar-dock" class:collapsed={mobileHeaderCollapsed}>
            <div
                class="mobile-topbar"
                class:collapsed={mobileHeaderCollapsed}
                aria-hidden={mobileHeaderCollapsed}
                inert={mobileHeaderCollapsed}
            >
                {#if activeIsApp}
                    <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                    <button class="mtb-btn" on:click={mobileHome} aria-label="Back" title="Back">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M10 3L5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button
                        type="button"
                        class="mtb-app-title"
                        on:click={() => (mobileHeaderCollapsed = true)}
                        aria-label={`Collapse header for ${activeTabName}`}
                        title="Collapse header"
                    >{activeTabName}</button>
                    <div class="mtb-app-menu" on:click|stopPropagation>
                        <button class="mtb-btn" class:active={appMenuOpen} on:click={() => (appMenuOpen = !appMenuOpen)} aria-label="App options" aria-expanded={appMenuOpen}>
                            <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                        </button>
                        {#if appMenuOpen}
                            <div class="mtb-app-dropdown" role="menu" aria-label="App options">
                                {#each activeHeaderActions as action (`${action.sourcePackage}:${action.id}`)}
                                    <button type="button" role="menuitem" class="mtb-header-action" on:click={() => runHeaderAction(action)}>
                                        <span><strong>{action.label}</strong>{#if action.description}<small>{action.description}</small>{/if}</span>
                                    </button>
                                {/each}
                                <div class="mtb-menu-actions" aria-label="Package actions">
                                    <button type="button" role="menuitem" on:click={openAppInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={refreshMobileApp} disabled={appRefreshingMap[activeTab]} aria-label="Refresh" title="Refresh"><svg class:refreshing={appRefreshingMap[activeTab]} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                                </div>
                            </div>
                        {/if}
                    </div>
                    <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
                {:else}
                    <button class="mtb-btn" on:click={openLeft} aria-label="Docks and sessions"><svg viewBox="0 0 16 16" fill="none" width="17" height="17"><path d="M2 4.5h12M2 8h12M2 11.5h12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                    <button class="mtb-btn" on:click={goBackMobile} disabled={!canGoBackMobile} aria-label="Back" title="Back">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="M10 3 5 8l5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button class="mtb-btn" on:click={goForwardMobile} disabled={!canGoForwardMobile} aria-label="Forward" title="Forward">
                        <svg viewBox="0 0 16 16" fill="none" width="17" height="17" aria-hidden="true"><path d="m6 3 5 5-5 5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>
                    </button>
                    <button
                        type="button"
                        class="mtb-title"
                        on:click={() => (mobileHeaderCollapsed = true)}
                        aria-label={`Collapse header for ${activeTabName}`}
                        title="Collapse header"
                    ><span class="mtb-title-text">{activeTabName}</span></button>
                    <div class="mtb-app-menu" on:click|stopPropagation>
                        <button class="mtb-btn" class:active={chatMenuOpen} on:click={() => (chatMenuOpen = !chatMenuOpen)} aria-label="Chat options" aria-expanded={chatMenuOpen}>
                            <svg viewBox="0 0 16 16" fill="currentColor" width="17" height="17" aria-hidden="true"><circle cx="3" cy="8" r="1.25"/><circle cx="8" cy="8" r="1.25"/><circle cx="13" cy="8" r="1.25"/></svg>
                        </button>
                        {#if chatMenuOpen}
                            <div class="mtb-app-dropdown" role="menu" aria-label="Chat options">
                                <div class="mtb-menu-actions" aria-label="Chat actions">
                                    <button type="button" role="menuitem" on:click={openChatInfo} aria-label="Information" title="Information"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="5.75" stroke="currentColor" stroke-width="1.35"/><path d="M8 7.1v4M8 4.75v.1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={enterMobileFullscreen} aria-label="Full Screen" title="Full Screen"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m6.25 2.75-3.5 3.5m0 0V3.4m0 2.85H5.6m4.15 7 3.5-3.5m0 0v2.85m0-2.85H10.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={refreshMobileChat} disabled={chatRefreshing} aria-label="Refresh" title="Refresh"><svg class:refreshing={chatRefreshing} viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="M13 5.5A5.5 5.5 0 1 0 13.2 10M13 2.7v3h-3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
                                    <button type="button" role="menuitem" on:click={closeActiveMobileTab} aria-label="Close" title="Close"><svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m5 5 6 6m0-6-6 6" stroke="currentColor" stroke-width="1.45" stroke-linecap="round"/></svg></button>
                                </div>
                                {#if chatFeatureAvailability.artifacts}
                                    <button type="button" role="menuitem" on:click={openArtifactLibrary}>
                                        <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.75h6.2l3.8 3.8v6.7H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M9.2 2.75v3.8H13M5.4 9.25h5.2m-5.2 2.25h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
                                        <span><strong>Artifacts</strong><small>Browse generated files</small></span>
                                    </button>
                                {/if}
                                {#if chatFeatureAvailability.bags}
                                    <button type="button" role="menuitem" on:click={openBag}>
                                        <span class="mtb-menu-icon"><svg viewBox="0 0 16 16" fill="none" width="16" height="16" aria-hidden="true"><path d="M3 2.5h10v11H3z" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><path d="M5.25 5.5h5.5M5.25 8h5.5M5.25 10.5h3.4" stroke="currentColor" stroke-width="1.35" stroke-linecap="round"/></svg></span>
                                        <span><strong>Bag</strong><small>View session plan</small></span>
                                    </button>
                                {/if}
                            </div>
                        {/if}
                    </div>
                    <button class="mtb-btn" on:click={openRight} aria-label="Apps"><svg viewBox="0 0 20 20" fill="none" width="17" height="17"><rect x="2" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="2" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="2" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/><rect x="11" y="11" width="7" height="7" rx="1.6" stroke="currentColor" stroke-width="1.4"/></svg></button>
                {/if}
            </div>
            {#if mobileHeaderCollapsed}
                <div class="mobile-fullscreen-center">
                    <button type="button" class="mobile-topbar-toggle" on:click={() => (mobileHeaderCollapsed = false)} aria-expanded="false" aria-label="Show header" title="Show header">
                        <svg viewBox="0 0 20 12" width="18" height="11" fill="none" aria-hidden="true"><path d="M3 3.5 10 9l7-5.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" /></svg>
                    </button>
                </div>
            {/if}
            </div>
        {/if}

        <div class="tab-content">
            <div class="chat-panel" class:hidden={activeIsApp} style={`--composer-reserve: ${composerDockHeight}px`}>
                {#if isMobile && historyTruncated}
                    <button
                        class="mobile-history-expand"
                        on:click={loadFullHistory}
                        disabled={loadingFullHistory}
                    >
                        {loadingFullHistory ? "Loading full conversation…" : "Load full conversation history"}
                    </button>
                {/if}
                <MessageList
                    {history}
                    {isMobile}
                    agentName={activeAgent?.name ?? "Agent"}
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
                    <div bind:this={composerStage} class="composer-stage" class:initial={history.length === 0}>
                        {#if history.length === 0}
                            <h1 class="composer-title">What will we build today?</h1>
                        {/if}
                        <InputBar
                            bind:value={message}
                            initial={history.length === 0}
                            {isMobile}
                            loading={loadingMap[activeTab] ?? false}
                            sessionId={activeTab}
                            disabled={!isOnline}
                            on:depart={animateComposerToDock}
                            on:send={send}
                            on:stop={(e) => handleStop(e?.detail)}
                            on:newSpecialistSession={handleNewSpecialistSession}
                        />
                    </div>
                    {#if !isMobile && history.length === 0 && (recentSessionsLoading || visibleRecentSessions.length)}
                        <section class="recent-sessions" aria-label="Recent conversations">
                            {#if visibleRecentSessions.length}
                                <div
                                    class="recent-session-list"
                                    use:recentSessionInfiniteScroll
                                    on:scroll={handleRecentSessionsScroll}
                                >
                                    {#each visibleRecentSessions as recent (recent.id)}
                                        <button
                                            type="button"
                                            class="recent-session"
                                            on:click={() => openRecentSession(recent.id)}
                                            title={recentSessionLabel(recent)}
                                        >
                                            <span class="recent-session-title">{recentSessionLabel(recent)}</span>
                                            <span class="recent-session-meta">{recentSessionMeta(recent)}</span>
                                        </button>
                                    {/each}
                                    {#if visibleRecentSessions.length < recentSessions.length}
                                        <div class="recent-sessions-sentinel" aria-hidden="true"></div>
                                    {/if}
                                </div>
                            {:else}
                                <span class="recent-sessions-loading">Loading recent conversations…</span>
                            {/if}
                        </section>
                    {/if}
                {/if}
            </div>

            {#each appTabs as tab (tab.id)}
                <div class="iframe-panel" class:hidden={activeTab !== tab.id} class:with-refresh-rail={isMobile && activeTab === tab.id}>
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
                            sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
                            allowfullscreen
                            on:load={() => {
                                try {
                                    applyThemeToDocument(iframeRefs[tab.id]?.contentDocument);
                                } catch {
                                    // URLs externas podem ser cross-origin e não são tematizáveis.
                                }
                                finishAppLoad(tab.id);
                            }}
                            on:error={() => finishAppLoad(tab.id)}
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

    <NtfyInbox bind:centerOpen={notificationCenterOpen} on:count={(event) => (notificationCount = event.detail.count)} />

    {#if statusModal}
        <div class="status-modal-backdrop" role="presentation" on:click={() => (statusModal = null)}>
            <section class="status-modal" role="dialog" aria-modal="true" aria-label={statusModal.label} on:click|stopPropagation>
                <header>
                    <h2>{statusModal.label}</h2>
                    <button type="button" aria-label="Close {statusModal.label}" on:click={() => (statusModal = null)}>×</button>
                </header>
                <iframe src={statusModal.url} title={statusModal.label} sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"></iframe>
            </section>
        </div>
    {/if}

    {#if appInfoTarget}
        <ModalSheet open={appInfoOpen} centered label="Package information" on:close={closeAppInfo}>
                <div class="app-info-hero">
                    <div class="app-info-icon" aria-hidden="true">
                        {#if appInfoIcon?.kind === "svg"}
                            <span class="app-info-icon-svg">{@html appInfoIcon.value}</span>
                        {:else if appInfoIcon?.kind === "image"}
                            <img src={appInfoIcon.value} alt="" />
                        {:else}
                            <span class="app-info-initials">{appInfoInitials}</span>
                        {/if}
                    </div>
                    <div>
                        <p class="app-info-eyebrow">Package information</p>
                        <h2 id="app-info-title">{appInfoTarget.name || appInfoTarget.packageName || "Application"}</h2>
                        {#if appInfoTarget.version}<p class="app-info-version">Version {appInfoTarget.version}</p>{/if}
                    </div>
                </div>
                <div class="app-info-details" aria-label="Package details">
                    {#each appInfoDetails as detail}
                        <div class="app-info-row"><dt>{detail.label}</dt><dd>{detail.value}</dd></div>
                    {/each}
                </div>
        </ModalSheet>
    {/if}

    <ModalSheet open={chatInfoOpen} centered label="Chat information" on:close={() => (chatInfoOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">Σ</div>
            <div><p class="app-info-eyebrow">Chat information</p><h2>Current conversation</h2></div>
        </div>
        <div class="app-info-details" aria-label="Chat details">
            <div class="app-info-row"><dt>Identifier</dt><dd><button type="button" class="chat-info-identifier" on:click={copyActiveSessionId} title="Copy identifier">{chatMenuMessage || sessionId}</button></dd></div>
            <div class="app-info-row"><dt>Context</dt><dd>{formatChatNumber(chatInfoMessages)} messages</dd></div>
            <div class="app-info-row"><dt>Input tokens</dt><dd>{formatChatNumber(chatInfoUsage.prompt)}</dd></div>
            <div class="app-info-row"><dt>Output tokens</dt><dd>{formatChatNumber(chatInfoUsage.completion)}</dd></div>
            <div class="app-info-row"><dt>Total usage</dt><dd>{formatChatNumber(chatInfoTotalTokens)} tokens</dd></div>
            <div class="app-info-row"><dt>Cost</dt><dd>{formatChatCost(chatInfoUsage.cost)}</dd></div>
        </div>
    </ModalSheet>

    <ModalSheet open={bagSheetOpen} centered label="Session bag" on:close={() => (bagSheetOpen = false)}>
        <div class="app-info-hero">
            <div class="app-info-icon chat-info-icon" aria-hidden="true">□</div>
            <div><p class="app-info-eyebrow">Session bag</p><h2>Plan and progress</h2></div>
        </div>
        {#if bagLoading}
            <p class="bag-sheet-message">Loading plan…</p>
        {:else if bagError}
            <p class="bag-sheet-message bag-sheet-error">{bagError}</p>
        {:else if !bagStatus}
            <p class="bag-sheet-message">No plan has been created for this conversation.</p>
        {:else}
            <div class="bag-sheet-summary">
                <p>{bagStatus.objective}</p>
                <span>{bagStatus.status === "done" ? "Complete" : "In progress"} · {bagStatus.steps?.filter((step) => step.status === "done" || step.status === "skipped").length ?? 0}/{bagStatus.steps?.length ?? 0} steps</span>
            </div>
            {#if bagStatus.steps?.length}
                <ol class="bag-sheet-steps" aria-label="Plan steps">
                    {#each bagStatus.steps as step (step.seq)}
                        <li class:done={step.status === "done" || step.status === "skipped"} class:failed={step.status === "failed"}>
                            <span class="bag-step-state">{step.seq}</span>
                            <span><strong>{step.description}</strong><small>{bagStepLabel(step.status)}{step.result ? ` · ${step.result}` : ""}</small></span>
                        </li>
                    {/each}
                </ol>
            {/if}
        {/if}
    </ModalSheet>

    <!-- Pai direto dos apps em abas: recebe os pedidos postMessage deles. -->
    <Dialogs host={true} />

</div>

<style>
    /* Sobre Canvas, drawers e qualquer app em modo tela cheia. */
    :global(.dlg-backdrop) { z-index: 2147483647; }
    .status-modal-backdrop { position: fixed; inset: 0; z-index: 2147483645; display: grid; place-items: center; padding: 2rem; background: color-mix(in srgb, var(--tk-bg) 74%, transparent); }
    .status-modal { display: flex; width: min(100%, 58rem); height: min(78dvh, 46rem); flex-direction: column; overflow: hidden; border: 1px solid var(--tk-border); border-radius: var(--tk-radius-lg); background: var(--tk-surface); box-shadow: 0 2px 8px rgba(0,0,0,.08); }
    .status-modal header { display: flex; align-items: center; justify-content: space-between; min-height: 2.75rem; padding: 0 .75rem 0 1rem; border-bottom: 1px solid var(--tk-border); color: var(--tk-text); }
    .status-modal h2 { margin: 0; font-size: .875rem; font-weight: 600; }.status-modal button { width: 2rem; height: 2rem; border: 0; border-radius: var(--tk-radius-md); background: transparent; color: var(--tk-text); font-size: 1.25rem; cursor: pointer; }.status-modal button:hover, .status-modal button:focus-visible { background: var(--tk-surface-2); outline: none; }.status-modal iframe { min-height: 0; flex: 1; border: 0; }
    .app-info-backdrop { position: fixed; inset: 0; z-index: 2147483646; display: grid; place-items: center; padding: 1rem; background: color-mix(in srgb, var(--tk-bg) 78%, transparent); backdrop-filter: blur(14px); }
    .app-info-modal { position: relative; width: min(100%, 23rem); max-height: calc(100dvh - 2rem); overflow: auto; border: 1px solid color-mix(in srgb, var(--tk-border) 72%, transparent); border-radius: 1.1rem; padding: 1.15rem; background: color-mix(in srgb, var(--tk-surface) 96%, transparent); color: var(--tk-text); box-shadow: 0 1.2rem 3.5rem color-mix(in srgb, var(--tk-bg) 65%, transparent); outline: none; }
    .app-info-close { position: absolute; top: .55rem; right: .55rem; width: 1.8rem; height: 1.8rem; border: 0; border-radius: 999px; background: transparent; color: var(--tk-text-muted, var(--tk-text)); font: 400 1.15rem/1 system-ui; cursor: pointer; }
    .app-info-hero { display: flex; align-items: center; gap: .85rem; padding-right: 1.75rem; }
    .app-info-icon { display: grid; width: 3.8rem; height: 3.8rem; flex: 0 0 auto; place-items: center; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 60%, transparent); border-radius: .95rem; background: linear-gradient(145deg, var(--tk-surface-2), var(--tk-surface)); box-shadow: 0 .45rem 1rem color-mix(in srgb, var(--tk-bg) 32%, transparent); }
    .app-info-icon img, .app-info-icon-svg, .app-info-icon-svg :global(svg) { display: block; width: 100%; height: 100%; object-fit: cover; }
    .app-info-initials { font-size: 1.25rem; font-weight: 720; letter-spacing: -.04em; color: var(--tk-text); }
    .app-info-eyebrow { margin: 0 0 .18rem; color: var(--tk-text-muted, var(--tk-text)); font-size: .62rem; font-weight: 700; letter-spacing: .08em; text-transform: uppercase; }
    .app-info-modal h2 { margin: 0; font-size: 1.15rem; letter-spacing: -.025em; }
    .app-info-version { margin: .18rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .74rem; }
    .app-info-description { margin: .85rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.42; }
    .app-info-details { display: grid; margin-top: .9rem; overflow: hidden; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .app-info-row { display: grid; grid-template-columns: minmax(4.8rem, .72fr) minmax(0, 1.28fr); gap: .65rem; padding: .5rem .65rem; border-bottom: 1px solid color-mix(in srgb, var(--tk-border) 55%, transparent); }
    .app-info-row:last-child { border-bottom: 0; }
    .app-info-row dt { color: var(--tk-text-muted, var(--tk-text)); font-size: .69rem; font-weight: 600; }
    .app-info-row dd { min-width: 0; margin: 0; overflow-wrap: anywhere; color: var(--tk-text); font-size: .69rem; text-align: right; }
    .chat-info-icon { color: var(--tk-accent, var(--tk-text)); font-size: 1.25rem; }
    .chat-info-identifier { max-width: 100%; border: 0; padding: 0; background: transparent; color: inherit; font: inherit; text-align: right; text-decoration: underline; cursor: copy; overflow-wrap: anywhere; }
    .bag-sheet-message { margin: 1rem 0 0; color: var(--tk-text-muted, var(--tk-text)); font-size: .82rem; line-height: 1.45; }
    .bag-sheet-error { color: var(--tk-danger, #d14d4d); }
    .bag-sheet-summary { display: grid; gap: .35rem; margin-top: .9rem; padding: .7rem; border: 1px solid color-mix(in srgb, var(--tk-border) 70%, transparent); border-radius: .7rem; background: color-mix(in srgb, var(--tk-surface-2) 58%, transparent); }
    .bag-sheet-summary p { margin: 0; color: var(--tk-text); font-size: .84rem; font-weight: 600; line-height: 1.4; }
    .bag-sheet-summary span, .bag-sheet-steps small { color: var(--tk-text-muted, var(--tk-text)); font-size: .7rem; }
    .bag-sheet-steps { display: grid; gap: .5rem; margin: .8rem 0 0; padding: 0; list-style: none; }
    .bag-sheet-steps li { display: grid; grid-template-columns: 1.5rem minmax(0, 1fr); gap: .55rem; align-items: start; padding: .5rem; border: 1px solid color-mix(in srgb, var(--tk-border) 58%, transparent); border-radius: .65rem; }
    .bag-sheet-steps li.done { opacity: .7; }.bag-sheet-steps li.failed { border-color: color-mix(in srgb, var(--tk-danger, #d14d4d) 60%, var(--tk-border)); }
    .bag-step-state { display: grid; width: 1.5rem; height: 1.5rem; place-items: center; border-radius: 999px; background: var(--tk-surface-2); color: var(--tk-text-muted, var(--tk-text)); font-size: .68rem; font-weight: 700; }
    .bag-sheet-steps strong, .bag-sheet-steps small { display: block; }.bag-sheet-steps strong { color: var(--tk-text); font-size: .76rem; line-height: 1.35; }.bag-sheet-steps small { margin-top: .12rem; line-height: 1.35; }
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
    .mobile-topbar-dock {
        --mobile-topbar-height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        position: relative;
        z-index: 10;
        flex: 0 0 auto;
        height: var(--mobile-topbar-height);
        transition: height 280ms cubic-bezier(0.22, 0.75, 0.18, 1);
    }
    .mobile-topbar-dock::after {
        content: "";
        position: absolute;
        right: 0;
        bottom: 0;
        left: 0;
        z-index: 0;
        height: 18px;
        background: linear-gradient(to bottom, transparent, color-mix(in srgb, var(--bg) 28%, transparent));
        pointer-events: none;
        transition: opacity 180ms ease;
    }
    .mobile-topbar-dock.collapsed {
        /* Em fullscreen, o controle não reserva uma faixa do cabeçalho: ele
           flutua sobre o conteúdo, como as setas das laterais. */
        height: 0;
    }
    .mobile-topbar-dock.collapsed::after {
        opacity: 0;
    }
    .mobile-topbar {
        display: flex;
        align-items: center;
        gap: 8px;
        height: calc(56px + var(--safe-top, env(safe-area-inset-top)));
        padding: var(--safe-top, env(safe-area-inset-top)) 10px 0;
        position: absolute;
        inset: 0 0 auto;
        z-index: 1;
        border: 0;
        border-bottom: 1px solid color-mix(in srgb, var(--border) 52%, transparent);
        background: transparent;
        opacity: 1;
        transform: translateY(0);
        transition: transform 280ms cubic-bezier(0.22, 0.75, 0.18, 1), opacity 180ms ease;
    }
    .mobile-topbar.collapsed {
        opacity: 0;
        pointer-events: none;
        transform: translateY(calc(-1 * var(--mobile-topbar-height)));
    }
    .mobile-fullscreen-center {
        position: absolute;
        z-index: 2;
        top: 0;
        left: 50%;
        display: flex;
        height: 38px;
        align-items: center;
        justify-content: center;
        gap: 5px;
        transform: translateX(-50%);
    }
    .mobile-topbar-toggle {
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        border-radius: 0;
        background-color: transparent;
        box-shadow: none;
        color: var(--txt-2);
        opacity: 0.52;
        cursor: pointer;
        transition: color 150ms ease, opacity 150ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-topbar-toggle:active {
        color: var(--txt);
        opacity: 0.9;
    }
    .mobile-topbar-toggle:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
    }
    /* Em tela cheia o cabeçalho deixa de ocupar espaço, mas os dois destinos
       de navegação continuam acessíveis no centro das bordas. A área de toque
       conserva o tamanho de uma aba mobile, embora a seta fique sem superfície
       própria. Ao abrir, ela percorre junto a borda exposta da gaveta. */
    .mobile-fullscreen-sidebar-controls {
        position: fixed;
        inset: 0;
        z-index: 25;
        pointer-events: none;
    }
    .mobile-fullscreen-sidebar-toggle {
        position: absolute;
        top: 50%;
        display: flex;
        width: 38px;
        height: 38px;
        align-items: center;
        justify-content: center;
        padding: 0;
        border: 0;
        background: transparent;
        color: var(--txt-2);
        cursor: pointer;
        opacity: .42;
        pointer-events: auto;
        transform: translateY(-50%);
        transition: transform 320ms cubic-bezier(0.32, 0.72, 0, 1), color 180ms ease, opacity 180ms ease;
        -webkit-tap-highlight-color: transparent;
    }
    .mobile-fullscreen-sidebar-toggle-left {
        left: 0;
        border-radius: 0;
    }
    .mobile-fullscreen-sidebar-toggle-right {
        right: 0;
        border-radius: 0;
    }
    .mobile-fullscreen-sidebar-toggle svg {
        transition: transform 240ms ease-out;
    }
    .mobile-fullscreen-sidebar-toggle.open svg {
        transform: rotate(180deg);
    }
    .mobile-fullscreen-sidebar-toggle-left.open {
        transform: translate(min(86vw, 340px), -50%);
    }
    .mobile-fullscreen-sidebar-toggle-right.open {
        transform: translate(calc(-1 * min(92vw, 400px)), -50%);
    }
    .mobile-fullscreen-sidebar-toggle:active {
        color: var(--txt);
        opacity: 1;
    }
    .mobile-fullscreen-sidebar-toggle:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
        opacity: 1;
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
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title-text {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .mtb-app-title {
        flex: 1;
        min-width: 0;
        padding: 0 6px;
        border: 0;
        background: transparent;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        color: var(--txt);
        font: 600 15px var(--font-body);
        letter-spacing: 0.01em;
        text-align: center;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
    }
    .mtb-title:focus-visible,
    .mtb-app-title:focus-visible {
        outline: 2px solid var(--border-strong);
        outline-offset: 2px;
        border-radius: 4px;
    }
    .mtb-app-menu { position: relative; flex-shrink: 0; }
    .mtb-btn.active { background: var(--w06); color: var(--txt); border-color: var(--border); }
    .mtb-btn.refreshing { cursor: wait; }
    .mtb-btn.refreshing svg { animation: mtb-refresh-spin .7s linear infinite; }
    .mtb-btn:disabled { cursor: not-allowed; opacity: .48; }
    @keyframes mtb-refresh-spin { to { transform: rotate(360deg); } }
    .mtb-app-dropdown {
        position: absolute;
        top: calc(100% + 5px);
        right: 0;
        min-width: 158px;
        padding: 4px;
        border: 1px solid color-mix(in srgb, var(--border) 70%, transparent);
        border-radius: 10px;
        background: color-mix(in srgb, var(--bg) 94%, transparent);
        box-shadow: 0 12px 30px rgba(0, 0, 0, 0.18);
        backdrop-filter: blur(20px) saturate(1.15);
        animation: mtb-menu-in 160ms cubic-bezier(.22,.75,.18,1);
    }
    .mtb-menu-actions { display: grid; grid-template-columns: repeat(4, 1fr); gap: 2px; }
    .mtb-header-action { min-height: 42px; text-align: left; }
    .mtb-header-action + .mtb-header-action { border-top: 1px solid color-mix(in srgb, var(--border) 52%, transparent); }
    .mtb-header-action > span { display: grid; gap: 2px; }
    .mtb-app-dropdown .mtb-menu-actions button {
        display: grid;
        width: 30px;
        height: 30px;
        min-height: 30px;
        place-items: center;
        padding: 0;
        border: 1px solid transparent;
        border-radius: 7px;
        color: var(--txt-2);
    }
    .mtb-app-dropdown .mtb-menu-actions button:hover, .mtb-app-dropdown .mtb-menu-actions button:focus-visible { border-color: color-mix(in srgb, var(--border) 72%, transparent); background: var(--w06); color: var(--txt); outline: none; }
    .mtb-menu-actions button svg { width: 15px; height: 15px; }
    .mtb-app-dropdown > button {
        width: 100%;
        display: flex;
        align-items: center;
        gap: 9px;
        min-height: 36px;
        margin-top: 3px;
        padding: 6px;
        border: 0;
        border-radius: 7px;
        background: transparent;
        color: var(--txt);
        font: 500 12px var(--font-body);
        text-align: left;
        transition: background 140ms ease, transform 140ms ease;
    }
    .mtb-app-dropdown > button:hover, .mtb-app-dropdown > button:focus-visible { background: var(--w06); outline: none; }
    .mtb-app-dropdown > button:active { background: var(--w06); transform: scale(.985); }
    .mtb-app-dropdown button:disabled { cursor: wait; opacity: .62; }
    .mtb-menu-icon { display: grid; width: 32px; height: 32px; flex: 0 0 auto; place-items: center; border: 1px solid color-mix(in srgb, var(--border) 65%, transparent); border-radius: 9px; background: var(--w03); color: var(--txt-2); }
    .mtb-app-dropdown button > span:last-child { display: grid; gap: 2px; }
    .mtb-app-dropdown strong { font: 600 13px var(--font-body); }
    .mtb-app-dropdown small { color: var(--txt-3); font: 400 10px var(--font-body); }
    .mtb-session-id small { max-width: 148px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-family: var(--font-mono, ui-monospace, monospace); }
    .mtb-app-dropdown svg { flex: 0 0 auto; }
    .mtb-app-dropdown svg.refreshing { animation: mtb-refresh-spin .7s linear infinite; }
    @keyframes mtb-menu-in { from { opacity: 0; transform: translateY(-4px) scale(.98); } to { opacity: 1; transform: translateY(0) scale(1); } }

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

    .shell {
        --tk-bg: #111111;
        --tk-surface: #181818;
        --tk-surface-2: #1f1f1f;
        --tk-border: rgba(255, 255, 255, 0.09);
        --tk-border-hi: rgba(255, 255, 255, 0.16);
        --tk-text: #f5f5f5;
        --tk-muted: #888888;
        --tk-muted-2: rgba(136, 136, 136, 0.5);
        --tk-accent: #f5f5f5;
        --tk-on-accent: #111111;
        --tk-radius-md: 8px;
        --tk-radius-lg: 14px;
        --tk-font: 'Ubuntu', system-ui, sans-serif;
        --tk-mono: 'Ubuntu Mono', monospace;

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
        --aurora-bg: var(--bg);
        --aurora-surface: var(--surface);
        --aurora-surface2: var(--surface-2);
        --aurora-border: var(--border);
        --aurora-border-hi: var(--border-hi);
        --aurora-text: var(--txt);
        --aurora-muted: var(--txt-2);
        --aurora-muted2: var(--txt-3);
        --aurora-teal: #ffffff;
        --aurora-violet: #cccccc;
        --aurora-pink: #aaaaaa;
        --aurora-glow: rgba(255, 255, 255, 0.06);
        --aurora-dim: rgba(255, 255, 255, 0.04);
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

        /* Rail — Sidebar + mobile drawers. It shares the canonical theme
           ground. Package widgets are intentionally transparent, so a
           separate near-black token would leak through as a blue/navy band. */
        --rail-bg: var(--bg);
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
         height: 100dvh;
        background: var(--bg);
        color: var(--txt);
        font-family: var(--font-body);
        font-size: 15px;
        position: relative;
        overflow: hidden;
    }

    /* Camadas transparentes de borda permitem que o fallback web comece até
       quando um app em iframe ocupa todo o conteúdo. Só existem com as
       gavetas fechadas, portanto não interferem na interação do sidebar. */
    .mobile-swipe-edge {
        position: fixed;
        z-index: 31;
        top: 0;
        bottom: 0;
        width: 24px;
        touch-action: pan-y;
    }
    .mobile-swipe-edge-left { left: 0; }
    .mobile-swipe-edge-right { right: 0; }

    /* A resposta SSR é desktop por padrão, porque não tem acesso ao viewport.
       Em uma tela que o Shell reconhece como mobile, não a exponha durante o
       intervalo até a hidratação. `layoutReady` é liberado no mesmo flush que
       troca `isMobile`, portanto a primeira pintura visível já é mobile. */
    @media (max-width: 767px), (pointer: coarse) {
        .shell:not(.layout-ready) {
            visibility: hidden;
        }
    }

    /* Light variant — same token names, DESIGN.md palette (soft neutrals,
       never pure black/white). Everything under .shell reads these through
       var(), so this is the only place a new theme needs color values. */
    .shell[data-theme="light"] {
        --tk-bg: #ffffff;
        --tk-surface: #f5f5f5;
        --tk-surface-2: #ececec;
        --tk-border: rgba(0, 0, 0, 0.10);
        --tk-border-hi: rgba(0, 0, 0, 0.18);
        --tk-text: #1a1a1a;
        --tk-muted: #666666;
        --tk-muted-2: rgba(0, 0, 0, 0.4);
        --tk-accent: #111111;
        --tk-on-accent: #ffffff;

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
        --aurora-teal: #1a1a1a;
        --aurora-violet: #444444;
        --aurora-pink: #666666;
        --aurora-glow: rgba(0, 0, 0, 0.06);
        --aurora-dim: rgba(0, 0, 0, 0.04);
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
        /* Sidebar emits two sibling slots. The explicit ordering makes the
           desktop composition stable: left rail, content, right rail. */
        order: 1;
        display: flex;
        flex-direction: column;
        height: 100dvh;
        overflow: hidden;
        min-width: 0;
        background: var(--bg);
        transform: translateX(0);
        transition: transform 0.32s cubic-bezier(0.32, 0.72, 0, 1), box-shadow 0.32s cubic-bezier(0.32, 0.72, 0, 1);
    }
    /* The desktop rails are rendered by Sidebar as sibling slots. Declare the
       available width here too, rather than relying only on flex shrink: the
       tab strip is absolutely positioned within its slot and must never draw
       beneath the right rail while it is open or resized. */
    @media (min-width: 769px) {
        .main-area {
            flex: 0 0 calc(100% - var(--shell-left-rail, 0px) - var(--shell-right-rail, 0px));
            width: calc(100% - var(--shell-left-rail, 0px) - var(--shell-right-rail, 0px));
        }
    }
    .shell.floating-shell .main-area {
        width: 100%;
        height: 100%;
    }
    /* Push mechanic — the mobile Sidebar panels (Sidebar.svelte, z-index 10)
       sit behind .main-area at rest; opening one shifts the content by
       exactly the panel's own width so the panel is revealed underneath,
       not overlaid with a scrim. */
    .main-area.push-left {
        transform: translateX(min(86vw, 340px));
        box-shadow: -14px 0 28px -16px var(--push-shadow);
        /* Keep the drawer above the shifted page so its controls stay clickable. */
        z-index: 5;
    }
    .main-area.push-right {
        transform: translateX(calc(-1 * min(92vw, 400px)));
        box-shadow: 14px 0 28px -16px var(--push-shadow);
        z-index: 5;
    }
    .push-catcher {
        position: absolute;
        inset: 0;
        z-index: 30;
        border: none;
        background: transparent;
        cursor: pointer;
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
    .mobile-history-expand {
        position: relative;
        z-index: 2;
        flex: 0 0 auto;
        align-self: center;
        margin: 8px 12px 0;
        padding: 7px 12px;
        border: 1px solid var(--rail-border);
        border-radius: 999px;
        background: var(--rail-bg);
        color: var(--rail-txt-2);
        font: inherit;
        font-size: 11px;
        cursor: pointer;
    }
    .mobile-history-expand:disabled {
        cursor: wait;
        opacity: 0.65;
    }
    .composer-stage {
        position: absolute;
        z-index: 4;
        right: 0;
        bottom: 0;
        left: 0;
        width: 100%;
        transform-origin: center bottom;
    }
    .composer-stage.initial {
        top: 50%;
        bottom: auto;
        transform: translateY(-50%);
        transform-origin: center center;
    }
    .composer-title {
        margin: 0 0 1rem;
        color: var(--txt, #f5f5f5);
        font-size: clamp(1.5rem, 2.6vw, 2rem);
        font-weight: 650;
        letter-spacing: -.035em;
        line-height: 1.15;
        text-align: center;
    }
    .recent-sessions {
        position: absolute;
        z-index: 3;
        right: 0;
        bottom: max(1.5rem, env(safe-area-inset-bottom));
        left: 0;
        display: flex;
        width: min(100% - 2rem, 38rem);
        min-height: 2rem;
        box-sizing: border-box;
        align-items: stretch;
        margin: 0 auto;
    }
    .recent-session-list {
        display: grid;
        width: 100%;
        max-height: 8.25rem;
        gap: .2rem;
        overflow-y: auto;
        overscroll-behavior: contain;
        scrollbar-width: none;
    }
    .recent-session-list::-webkit-scrollbar { display: none; }
    .recent-session {
        display: grid;
        min-width: 0;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: .75rem;
        border: 0;
        border-radius: .5rem;
        background: transparent;
        padding: .3rem .45rem;
        color: var(--tk-muted, #888);
        font: inherit;
        text-align: left;
        cursor: pointer;
        opacity: .72;
        transition: background 160ms ease, color 160ms ease, opacity 160ms ease;
    }
    .recent-session:hover,
    .recent-session:focus-visible {
        background: color-mix(in srgb, var(--tk-surface, #181818) 76%, transparent);
        color: var(--tk-text, #f5f5f5);
        opacity: 1;
        outline: none;
    }
    .recent-session:focus-visible { box-shadow: 0 0 0 1px var(--tk-border-hi, rgba(255,255,255,.2)); }
    .recent-session-title {
        overflow: hidden;
        font-size: .76rem;
        font-weight: 500;
        letter-spacing: -.01em;
        line-height: 1.35;
        text-overflow: ellipsis;
        white-space: nowrap;
    }
    .recent-session-meta {
        color: var(--tk-muted-2, #666);
        font: 400 .65rem var(--tk-mono, monospace);
        line-height: 1.55;
        white-space: nowrap;
    }
    .recent-sessions-sentinel { height: 1px; }
    .recent-sessions-loading {
        margin: auto;
        color: var(--tk-muted-2, #666);
        font: 400 .67rem var(--tk-mono, monospace);
    }
    .chat-panel :global(.ml-root) { padding-bottom: var(--composer-reserve, 122px); }
    @media (max-width: 560px) {
        .composer-stage.initial { top: 46%; }
    }
    .chat-panel.hidden {
        opacity: 0;
        pointer-events: none;
    }
    .iframe-panel {
        position: absolute;
        inset: 0;
        transform: translateY(0);
        transition: opacity 0.18s ease, transform 0.22s ease-out;
    }
    .iframe-panel.hidden {
        opacity: 0;
        transform: translateY(-10px);
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
        /* O app continua recebendo interação enquanto o iframe termina de
           iniciar. Alguns WebViews não emitem `load` para navegação em aba
           oculta; o indicador jamais pode segurar a superfície por isso. */
        pointer-events: none;
    }
</style>
