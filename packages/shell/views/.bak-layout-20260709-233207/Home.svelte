<script>
    import { onMount, tick } from "svelte";

    import Sidebar from "./Sidebar.svelte";
    import MessageList from "./MessageList.svelte";
    import Canvas from "./Canvas.svelte";
    import WidgetDrawer from "./WidgetDrawer.svelte";
    import SessionTabs from "./SessionTabs.svelte";

    import StructuredInput from "./components/StructuredInput.svelte";
    import InputBar from "./InputBar2.svelte";

    import { api } from "./api";

    import {
        saveSessionState,
        restoreSessionState,
        clearSessionState,
    } from "./persistence.js";
    import { getTheme, setTheme } from "./theme.js";

    // ── GET params ───────────────────────────────────────────────────
    export let open; // "chat" | "terminal" | "app"
    export let session; // sessionId para open=chat
    export let appId; // id do app para open=app

    // ── Tema (black default / white) ─────────────────────────────────
    let theme = "dark";

    function handleToggleTheme() {
        theme = theme === "dark" ? "light" : "dark";
        setTheme(theme);
    }

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

    function handleOffline() {
        isOnline = false;
        wasOffline = true;
        reconnecting = true;
        startReconnectLoop();
        saveSessionState();
    }

    // ── Persistência de sessão ────────────────────────────────────────
    const PERSIST_KEY = "aurora-session-state";

    function fullSaveSessionState() {
        saveSessionState({
            tabs,
            appTabs,
            activeTab,
            sessionId,
            sessionCache,
            isMobile,
        });
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
            if (state.isMobile !== undefined) isMobile = state.isMobile;
            return true;
        } catch (e) {
            console.warn("[Aurora] Falha ao restaurar estado:", e.message);
            return false;
        }
    }

    function startReconnectLoop() {
        if (reconnectTimer) return;
        reconnectTimer = setInterval(async () => {
            try {
                const res = await fetch("/aurora/provider", {
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

    // ── Widget panel (bags e outros widgets futuros) ─────────────────
    let widgetPanelOpen = false;
    let widgetAutoOpenedSessions = new Set();

    async function maybeAutoOpenWidgetPanel(forSessionId) {
        if (widgetAutoOpenedSessions.has(forSessionId)) return;
        try {
            const res = await fetch(`/bags/status/${forSessionId}`);
            const json = await res.json();
            if (json?.success) {
                widgetAutoOpenedSessions = new Set([
                    ...widgetAutoOpenedSessions,
                    forSessionId,
                ]);
                widgetPanelOpen = true;
            }
        } catch {
            // silencioso — checagem best-effort, nao deve quebrar o chat
        }
    }

    // ── Chat ────────────────────────────────────────────────────────
    let message = "";
    const initialId = generateSessionId();
    let sessionId = initialId;
    let history = [];
    let system = { provider: "—", model: "—", connections: [] };
    let listRef;

    let abortControllers = {};
    let sessionCache = {};
    let messageCache = {};

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

    function mergeAssistantGroup(items) {
        const steps = [];
        const reasoningParts = [];
        let allReasoningText = null;
        let lastContent = "";
        for (const item of items) {
            const m = item.raw;
            const content = item.content;
            lastContent = content;
            const toolCalls = m.tool_calls ?? [];
            if (toolCalls.length > 0) {
                for (const tc of toolCalls) {
                    const name = tc.function?.name || tc.name || "tool";
                    steps.push({ label: name, reasoning: content || null });
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
                merged.push({
                    role: "user",
                    content: item.content,
                    attachments: item.raw.attachments ?? [],
                    streaming: false,
                    steps: [],
                    allReasoning: null,
                    thinkingExpanded: false,
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
    let sidebarOpen = false;

    function openSidebar() {
        sidebarOpen = true;
    }

    function closeSidebar() {
        sidebarOpen = false;
    }

    function checkMobile() {
        isMobile = window.matchMedia("(max-width: 767px)").matches;
        if (!isMobile) sidebarOpen = false;
        tick().then(() => {
            showLoading = false;
        });
    }

    // ── Workspace tabs ───────────────────────────────────────────────
    let tabs = [{ sessionId: initialId, name: "Nova Missão", pinned: false }];
    let activeTab = initialId;
    let loadingMap = {};
    let refreshTrigger = 0;

    async function loadWorkspace() {
        if (tabs.length > 0) {
            await activateSession(tabs[0].sessionId);
        }
    }

    async function activateSession(sid) {
        if (sessionCache[sid]) {
            sessionId = sid;
            history = sessionCache[sid].map((m) => ({
                ...m,
                thinkingExpanded: m.streaming
                    ? true
                    : m.thinkingExpanded ?? false,
            }));
            await tick();
            await listRef?.scrollBottom();
            return;
        }
        sessionId = sid;
        const data = await api(`/sessions/${sid}/history`, "GET");
        history = sanitizeHistoryMessages(data || []);
        sessionCache[sid] = history;
        await tick();
        await listRef?.scrollBottom();
    }

    // ── Tab event handlers ───────────────────────────────────────────
    async function handleSelectTab(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        if (sessionId) sessionCache[sessionId] = [...history];
        const isApp = appTabs.some((t) => t.id === sid);
        activeTab = sid;
        activeIsApp = isApp;
        if (!isApp) await activateSession(sid);
        if (isMobile) sidebarOpen = false;
    }

    export async function handleNewTab() {
        const newId = generateSessionId();
        const newTab = { sessionId: newId, name: "Nova Missão", pinned: false };
        tabs = [...tabs, newTab];
        activeTab = newId;
        sessionId = newId;
        history = [];
        activeIsApp = false;
        refreshTrigger++;
        if (isMobile) sidebarOpen = false;
    }

    function handleRenameTab(e) {
        const payload = typeof e === "object" && e?.detail ? e.detail : e;
        const { sessionId: sid, name } = payload;
        tabs = tabs.map((t) => (t.sessionId === sid ? { ...t, name } : t));
    }

    function handleTogglePin(e) {
        const sid = typeof e === "string" ? e : e?.detail ?? e;
        tabs = tabs.map((t) =>
            t.sessionId === sid ? { ...t, pinned: !t.pinned } : t,
        );
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
            return;
        }
        if (loadingMap[sid]) {
            const ctrl = abortControllers[sid];
            if (ctrl) {
                ctrl.abort();
                delete abortControllers[sid];
            }
        }
        loadingMap = { ...loadingMap, [sid]: false };
        if (tabs.length <= 1) {
            const newId = generateSessionId();
            tabs = [{ sessionId: newId, name: "Nova Missão", pinned: false }];
            activeTab = newId;
            sessionId = newId;
            history = [];
            activeIsApp = false;
            delete sessionCache[sid];
            refreshTrigger++;
            return;
        }
        const idx = tabs.findIndex((t) => t.sessionId === sid);
        tabs = tabs.filter((t) => t.sessionId !== sid);
        if (activeTab === sid) {
            const fallback = tabs[Math.max(0, idx - 1)];
            activeTab = fallback?.sessionId || tabs[0]?.sessionId;
            activeIsApp = false;
            if (tabs.length > 0) {
                await activateSession(tabs[0].sessionId);
            }
        }
        delete sessionCache[sid];
        refreshTrigger++;
    }

    function updateSessionHistory(sid, updater) {
        const cached = sessionCache[sid] || [];
        const updated = updater(cached);
        sessionCache[sid] = updated;
        if (sessionId === sid) history = updated;
    }

    // ── Stop ─────────────────────────────────────────────────────────
    function handleStop(sid) {
        const target = sid || sessionId;
        api("/aurora/chat/cancel", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ session_id: target }),
        }).catch(() => {});
        const ctrl = abortControllers[target];
        if (ctrl) {
            ctrl.abort();
            delete abortControllers[target];
        }
        loadingMap = { ...loadingMap, [target]: false };
        updateSessionHistory(target, (hist) => {
            const idx = hist.length - 1;
            if (idx < 0) return hist;
            const last = hist[idx];
            if (last.streaming) {
                return hist.map((m, i) =>
                    i === idx
                        ? {
                              ...m,
                              content: "*Geração interrompida.*",
                              streaming: false,
                              thinkingExpanded: false,
                          }
                        : m,
                );
            }
            return hist;
        });
    }

    // ── SSE streaming send ───────────────────────────────────────────
    async function send(e) {
        const detail = e?.detail ?? e;
        const text =
            typeof detail === "object"
                ? detail.text ?? ""
                : String(detail ?? "");
        const attachments =
            typeof detail === "object" ? detail.attachments ?? [] : [];

        const streamingSessionId = sessionId;

        if (text.trim() === "/clear") {
            await handleClearSession(streamingSessionId);
            message = "";
            messageCache[streamingSessionId] = "";
            return;
        }

        if (
            (!text && attachments.length === 0) ||
            loadingMap[streamingSessionId]
        )
            return;
        message = "";
        messageCache[streamingSessionId] = "";

        loadingMap = { ...loadingMap, [streamingSessionId]: true };

        tabs = tabs.map((t) => {
            if (
                t.sessionId === streamingSessionId &&
                t.name === "Nova Missão"
            ) {
                const preview =
                    text.length > 30 ? text.slice(0, 30) + "…" : text;
                return { ...t, name: preview || "Arquivo" };
            }
            return t;
        });

        const userMsg = { role: "user", content: text, attachments };
        updateSessionHistory(streamingSessionId, (hist) => [...hist, userMsg]);
        await listRef?.scrollBottom();

        let llmMessageContent = text;
        if (attachments.length > 0) {
            const attachmentParts = attachments
                .map((a) => {
                    if (a.isImage && a.base64)
                        return `\n[Image Path: ${a.path}]\n`;
                    else if (a.isText && a.textContent)
                        return `\n\`\`\`\n// Path: ${a.path}\n${a.textContent}\n\`\`\`\n`;
                    return `\n[Arquivo: ${a.name}]`;
                })
                .join("");
            llmMessageContent = text
                ? `${text}\n${attachmentParts}`
                : attachmentParts;
        }

        const assistantMsg = {
            role: "assistant",
            content: "",
            streaming: true,
            steps: [],
            allReasoning: null,
            thinkingExpanded: true,
        };
        updateSessionHistory(streamingSessionId, (hist) => [
            ...hist,
            assistantMsg,
        ]);

        const controller = new AbortController();
        abortControllers[streamingSessionId] = controller;

        try {
            const res = await fetch("/aurora/chat/stream", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    message: llmMessageContent,
                    session_id: streamingSessionId,
                    settings: detail.settings,
                }),
                signal: controller.signal,
            });

            if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

            const reader = res.body.getReader();
            const decoder = new TextDecoder();
            let buf = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                buf += decoder.decode(value, { stream: true });
                const parts = buf.split("\n\n");
                buf = parts.pop();

                for (const part of parts) {
                    let eventName = "message";
                    let dataLine = "";
                    for (const line of part.split("\n")) {
                        if (line.startsWith("event: "))
                            eventName = line.slice(7).trim();
                        if (line.startsWith("data: "))
                            dataLine = line.slice(6).trim();
                    }
                    if (!dataLine) continue;
                    let payload;
                    try {
                        payload = JSON.parse(dataLine);
                    } catch {
                        continue;
                    }
 
                    if (eventName === "step") {
                        const newStep = {
                            label: payload.label ?? "",
                            reasoning: payload.reasoning ?? null,
                            iteration: payload.iteration ?? null,
                        };
                        updateSessionHistory(streamingSessionId, (hist) => {
                            const idx = hist.length - 1;
                            return hist.map((m, i) =>
                                i === idx
                                    ? {
                                          ...m,
                                          steps: [...m.steps, newStep],
                                          allReasoning: payload.reasoning
                                              ? m.allReasoning
                                                  ? m.allReasoning +
                                                    "\n\n" +
                                                    payload.reasoning
                                                  : payload.reasoning
                                              : m.allReasoning,
                                      }
                                    : m,
                            );
                        });
                        if (streamingSessionId === sessionId)
                            await listRef?.scrollBottom();
                    } else if (eventName === "token") {
                        updateSessionHistory(streamingSessionId, (hist) => {
                            const idx = hist.length - 1;
                            return hist.map((m, i) =>
                                i === idx
                                    ? {
                                          ...m,
                                          content:
                                              (m.content ?? "") +
                                              (payload.text ?? ""),
                                      }
                                    : m,
                            );
                        });
                        if (streamingSessionId === sessionId)
                            await listRef?.scrollBottom();
                    } else if (eventName === "reasoning") {
                        // Concatena o delta de reasoning no bloco "pensando" em tempo real
                        updateSessionHistory(streamingSessionId, (hist) => {
                            const idx = hist.length - 1;
                            return hist.map((m, i) =>
                                i === idx
                                    ? {
                                          ...m,
                                          allReasoning:
                                              (m.allReasoning ?? "") +
                                              (payload.text ?? ""),
                                          thinkingExpanded: true,
                                      }
                                    : m,
                            );
                        });
                        // Não scrolla — o bloco de reasoning fica acima, não empurra o conteúdo
                    } else if (eventName === "done") {
                        updateSessionHistory(streamingSessionId, (hist) => {
                            const idx = hist.length - 1;
                            return hist.map((m, i) => {
                                if (i === idx) {
                                    const updatedMsg = {
                                        ...m,
                                        content: payload.response ?? "",
                                        streaming: false,
                                        thinkingExpanded: false,
                                    };
                                    return processAssistantMessage(updatedMsg);
                                }
                                return m;
                            });
                        });
                        if (streamingSessionId === sessionId)
                            await listRef?.scrollBottom();
                    } else if (eventName === "error") {
                        updateSessionHistory(streamingSessionId, (hist) => {
                            const idx = hist.length - 1;
                            return hist.map((m, i) =>
                                i === idx
                                    ? {
                                          ...m,
                                          content: `⚠️ ${payload.error}`,
                                          streaming: false,
                                      }
                                    : m,
                            );
                        });
                    }
                }
            }
        } catch (e) {
            const isAbort = e?.name === "AbortError";
            // Se for perda de conexão (não abort intencional), mostra toast e aguarda reconexão
            const isNetwork =
                !isAbort &&
                (e?.name === "TypeError" ||
                    e?.message?.includes("Failed to fetch") ||
                    e?.message?.includes("NetworkError"));

            if (isNetwork) {
                // Não polui o histórico — o toast de offline aparece na UI
                // Mas marca a mensagem como pendente se quiser (opcional, deixamos como erro suave)
                updateSessionHistory(streamingSessionId, (hist) => {
                    const idx = hist.length - 1;
                    return hist.map((m, i) =>
                        i === idx
                            ? {
                                  ...m,
                                  content: "",
                                  streaming: false,
                                  thinkingExpanded: false,
                                  networkError: true,
                              }
                            : m,
                    );
                });
            } else {
                updateSessionHistory(streamingSessionId, (hist) => {
                    const idx = hist.length - 1;
                    return hist.map((m, i) =>
                        i === idx
                            ? {
                                  ...m,
                                  content: isAbort
                                      ? "*Geração interrompida.*"
                                      : `⚠️ Erro: ${e.message}`,
                                  streaming: false,
                                  thinkingExpanded: false,
                              }
                            : m,
                    );
                });
            }
        } finally {
            delete abortControllers[streamingSessionId];
            loadingMap = { ...loadingMap, [streamingSessionId]: false };
            if (streamingSessionId === sessionId) await listRef?.scrollBottom();
            if (streamingSessionId === sessionId)
                await maybeAutoOpenWidgetPanel(streamingSessionId);
            refreshTrigger++;
        }
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
        await activateSession(newId);
        if (isMobile) sidebarOpen = false;
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
            await activateSession(fallback);
        }
    }

    async function handleClearSession(sid) {
        const target = sid || sessionId;
        await api(`/sessions/${target}/clear`, "GET");
        delete sessionCache[target];
        if (target === sessionId) {
            history = [];
            await tick();
        }
        refreshTrigger++;
    }

    // ── App tabs ─────────────────────────────────────────────────────
    let appTabs = [];
    let activeIsApp = false;
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
            if (isMobile) sidebarOpen = false;
            return;
        }
        const newAppTab = { ...app, type: "app" };
        appTabs = [...appTabs, newAppTab];
        activeTab = app.id;
        activeIsApp = true;
        appLoadingMap = { ...appLoadingMap, [app.id]: true };
        if (isMobile) sidebarOpen = false;
    }

    // ── Windows: handlers vindos do Sidebar / Windows ────────────────
    function handleSelectApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        activeTab = id;
        activeIsApp = true;
        if (isMobile) sidebarOpen = false;
    }

    function handleCloseApp(e) {
        const id = typeof e === "string" ? e : e?.detail ?? e;
        appTabs = appTabs.filter((t) => t.id !== id);
        if (activeTab === id) {
            activeTab = sessionId;
            activeIsApp = false;
        }
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

    function onStructuredSend(e) {
        send(e);
    }

    onMount(() => {
        theme = getTheme();

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
        checkMobile();

        window.addEventListener("resize", checkMobile);
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

        return () => {
            window.removeEventListener("resize", checkMobile);
            window.removeEventListener("online", handleOnline);
            window.removeEventListener("offline", handleOffline);
            window.removeEventListener("beforeunload", fullSaveSessionState);
            document.removeEventListener(
                "visibilitychange",
                fullSaveSessionState,
            );
            if (reconnectTimer) clearInterval(reconnectTimer);
            if (persistInterval) clearInterval(persistInterval);
        };
    });
</script>

<div class="shell" data-theme={theme}>
    <!-- Loading screen -->
    {#if showLoading}
        <div class="loading-screen">
            <div class="loading-spinner"></div>
            <p class="loading-label">Inicializando Aurora…</p>
        </div>
    {/if}

    <!-- Offline / reconnect toast -->
    {#if !isOnline}
        <div class="offline-toast" role="status" aria-live="polite">
            <div class="offline-spinner"></div>
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
    <Sidebar
        {system}
        {sessionId}
        {tabs}
        {isMobile}
        {sidebarOpen}
        {theme}
        {refreshTrigger}
        {appTabs}
        chatTabs={chatTabsForWindows}
        {activeTab}
        on:selectSession={handleSelectSession}
        on:clear={handleNewTab}
        on:openApp={handleOpenApp}
        on:deleteSession={handleSessionDelete}
        on:close={closeSidebar}
        on:selectApp={handleSelectApp}
        on:closeApp={handleCloseApp}
        on:selectChat={handleSelectChat}
        on:closeChat={handleCloseChat}
        on:toggleTheme={handleToggleTheme}
    />

    <!-- Overlay mobile -->
    {#if isMobile && sidebarOpen}
        <div
            class="mobile-overlay"
            role="button"
            tabindex="-1"
            aria-label="Fechar menu"
            on:click={closeSidebar}
            on:keydown={(e) => e.key === "Escape" && closeSidebar()}
        ></div>
    {/if}

    <div class="main-area">
        <!-- Tab bar desktop -->
        {#if !isMobile}
            <SessionTabs
                tabs={allTabs}
                {appTabs}
                {activeTab}
                {loadingMap}
                isMobile={false}
                on:selectTab={handleSelectTab}
                on:newTab={handleNewTab}
                on:renameTab={handleRenameTab}
                on:togglePin={handleTogglePin}
                on:closeTab={handleCloseTab}
            />
        {/if}

        <!-- Tab bar mobile (dentro do main-area, acima do chat) -->
        {#if isMobile}
            <SessionTabs
                tabs={allTabs}
                {appTabs}
                {activeTab}
                {loadingMap}
                isMobile={true}
                on:selectTab={handleSelectTab}
                on:newTab={handleNewTab}
                on:renameTab={handleRenameTab}
                on:togglePin={handleTogglePin}
                on:closeTab={handleCloseTab}
                on:openMenu={openSidebar}
            />
        {/if}

        <div class="tab-content">
            <div class="chat-panel" class:hidden={activeIsApp}>
                <MessageList
                    {history}
                    {isMobile}
                    loading={loadingMap[activeTab] ?? false}
                    bind:this={listRef}
                    on:openCanvas={handleOpenCanvas}
                />

                {#if structuredProps}
                    <StructuredInput
                        steps={structuredProps}
                        on:send={onStructuredSend}
                        on:escape={onEscape}
                    />
                {:else}
                    <InputBar
                        bind:value={message}
                        {isMobile}
                        loading={loadingMap[activeTab] ?? false}
                        sessionId={activeTab}
                        disabled={!isOnline}
                        on:send={send}
                        on:stop={(e) => handleStop(e?.detail)}
                    />
                {/if}
            </div>

            {#each appTabs as tab (tab.id)}
                <div class="iframe-panel" class:hidden={activeTab !== tab.id}>
                    {#if appLoadingMap[tab.id]}
                        <div class="app-loader">
                            <div class="loader-spinner"></div>
                            <span class="loader-label">{tab.name}</span>
                        </div>
                    {/if}
                    <iframe
                        src={tab.url}
                        title={tab.name}
                        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                        on:load={() => {
                            appLoadingMap = {
                                ...appLoadingMap,
                                [tab.id]: false,
                            };
                        }}
                    ></iframe>
                </div>
            {/each}
        </div>

    </div>

    <Canvas
        html={canvasHtml}
        open={canvasOpen}
        on:close={() => (canvasOpen = false)}
    />

    <WidgetDrawer
        open={widgetPanelOpen}
        sessionId={sessionId}
        on:close={() => (widgetPanelOpen = false)}
    />

    <button
        class="widget-panel-toggle"
        on:click={() => (widgetPanelOpen = !widgetPanelOpen)}
        title="Widgets"
    >
        🧰
    </button>
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
        border: 1px solid rgba(255, 255, 255, 0.08);
        background: rgba(24, 24, 27, 0.9);
        color: #e4e4e7;
        font-size: 1.1rem;
        cursor: pointer;
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
        --bg: #0a0a0a;
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
        --w02: rgba(255, 255, 255, 0.02);
        --w03: rgba(255, 255, 255, 0.03);
        --w04: rgba(255, 255, 255, 0.04);
        --w045: rgba(255, 255, 255, 0.045);
        --w05: rgba(255, 255, 255, 0.05);
        --w06: rgba(255, 255, 255, 0.06);
        --w07: rgba(255, 255, 255, 0.07);
        --w08: rgba(255, 255, 255, 0.08);
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
        --font-head: "DM Sans", system-ui, sans-serif;
        --font-body: "DM Sans", system-ui, sans-serif;
        --font-mono: "DM Mono", "Courier New", monospace;

        /* Bootstrap 5 loads globally (other packages use its components);
           every one of its utility classes is !important, and some share a
           name with a Tailwind utility used here (border, rounded, shadow*).
           Bootstrap reads its own color/radius/shadow through these vars, so
           pointing them at Aurora's tokens reclaims those classes without
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

        --w02: rgba(0, 0, 0, 0.02);
        --w03: rgba(0, 0, 0, 0.03);
        --w04: rgba(0, 0, 0, 0.04);
        --w045: rgba(0, 0, 0, 0.045);
        --w05: rgba(0, 0, 0, 0.05);
        --w06: rgba(0, 0, 0, 0.06);
        --w07: rgba(0, 0, 0, 0.07);
        --w08: rgba(0, 0, 0, 0.08);
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
        --w70: rgba(0, 0, 0, 0.7);
        --w75: rgba(0, 0, 0, 0.75);
        --w80: rgba(0, 0, 0, 0.8);
        --w85: rgba(0, 0, 0, 0.85);
        --w90: rgba(0, 0, 0, 0.9);
    }

    /* Bootstrap's spacing utilities (p-, m-, gap- variants) hardcode rem
       values with !important instead of reading a var, and their 0-5 scale
       collides by name with Tailwind's, so the border/shadow var-bridge
       above can't reach them — each colliding class needs its Tailwind
       value restored directly, scoped under .shell so nothing outside
       Aurora is touched. */
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
        background: #0a0a0a;
        color: #f5f5f5;
        font-family: "DM Sans", system-ui, sans-serif;
    }
    .loading-spinner {
        width: 32px;
        height: 32px;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 255, 255, 0.08);
        border-top-color: rgba(255, 255, 255, 0.7);
        animation: spin 0.8s linear infinite;
    }
    .loading-label {
        margin-top: 18px;
        font-size: 11px;
        color: rgba(255, 255, 255, 0.3);
        letter-spacing: 0.12em;
        text-transform: uppercase;
    }
    @keyframes spin {
        to {
            transform: rotate(360deg);
        }
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
        background: rgba(18, 18, 18, 0.98);
        border: 1px solid rgba(255, 255, 255, 0.12);
        border-radius: 24px;
        backdrop-filter: blur(12px);
        box-shadow: 0 4px 24px rgba(0, 0, 0, 0.7);
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
    .offline-spinner {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        border: 1.5px solid rgba(255, 255, 255, 0.1);
        border-top-color: rgba(255, 255, 255, 0.65);
        animation: spin 0.8s linear infinite;
        flex-shrink: 0;
    }
    .offline-text {
        font-family: var(--font-mono);
        font-size: 11px;
        color: rgba(255, 255, 255, 0.55);
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
        background: rgba(255, 255, 255, 0.3);
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

    /* ── Mobile overlay ── */
    .mobile-overlay {
        position: fixed;
        inset: 0;
        z-index: 29;
        background: rgba(0, 0, 0, 0.7);
        animation: fade-in 0.2s ease;
        cursor: pointer;
        border: none;
    }
    @keyframes fade-in {
        from {
            opacity: 0;
        }
        to {
            opacity: 1;
        }
    }

    /* ── Main ── */
    .main-area {
        position: relative;
        z-index: 2;
        flex: 1;
        display: flex;
        flex-direction: column;
        height: 100vh;
        height: 100dvh;
        overflow: hidden;
        min-width: 0;
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
        background: #fff;
    }

    .app-loader {
        position: absolute;
        inset: 0;
        z-index: 10;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 14px;
        background: var(--bg);
    }
    .loader-spinner {
        width: 28px;
        height: 28px;
        border: 1.5px solid rgba(255, 255, 255, 0.08);
        border-top-color: rgba(255, 255, 255, 0.6);
        border-radius: 50%;
        animation: spin 0.8s linear infinite;
    }
    .loader-label {
        font-family: var(--font-mono);
        font-size: 10px;
        font-weight: 500;
        letter-spacing: 0.12em;
        text-transform: uppercase;
        color: var(--txt-2);
    }

    @media (max-width: 767px) {
        .chat-panel::before {
            content: "";
            position: absolute;
            top: 0;
            left: 0;
            right: 0;
            height: 60px;
            background: linear-gradient(to bottom, #000 0%, transparent 100%);
            z-index: 50;
            pointer-events: none;
        }
    }
</style>
