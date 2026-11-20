/**
 * chat events controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createChatEvents({ state, deps }) {
    function updateSessionHistory(sid, updater) {
        const cached = state.sessionCache[sid] || [];
        const updated = updater(cached);
        (state.sessionCache[sid] = updated, state.sessionCache = state.sessionCache);
        if (state.sessionId === sid) state.history = updated;
    }

    function markChatRead(sid) {
        if (!state.unreadMap[sid]) return;
        state.unreadMap = { ...state.unreadMap, [sid]: false };
    }

    function markChatUnread(sid) {
        if (sid === state.activeTab && !state.activeIsApp) return;
        state.unreadMap = { ...state.unreadMap, [sid]: true };
    }

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

    function insertUserMessage(hist, msg) {
        const last = hist[hist.length - 1];
        if (!msg.queued && last?.role === "assistant" && last.streaming) {
            return [...hist.slice(0, -1), msg, last];
        }
        return [...hist, msg];
    }

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
            const incomingEpoch = epoch || state.cursorMap[sid]?.epoch || "legacy";
            const cursor = state.cursorMap[sid];
            if (cursor?.epoch === incomingEpoch && cursor.seq >= seq) return;
            (state.cursorMap[sid] = { epoch: incomingEpoch, seq }, state.cursorMap = state.cursorMap);
        }

        if (event === "start") {
            state.loadingMap = { ...state.loadingMap, [sid]: true };
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
                const refs = deps.extractAttachmentRefs(data.text);
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
                const refs = deps.extractAttachmentRefs(data.text);
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
            if (sid === state.sessionId) state.listRef?.scrollBottom();
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
            if (sid === state.sessionId) state.listRef?.scrollBottom();
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
            deps.busEmitLocal("notifications:push", {
                id: `governance:${sid}:${data.request_id}`,
                title: "Approval required",
                message: `${data.tool_name || "An action"} is awaiting your decision.`,
                click: `${deps.window.location.origin}${deps.window.location.pathname}?open=chat&session=${encodeURIComponent(sid)}`,
                priority: 5,
                tags: [`notify_id:governance:${sid}:${data.request_id}`],
                kind: "governance",
                requestId: data.request_id,
            });
            if (sid === state.sessionId) state.listRef?.scrollBottom();
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
                if (sid === state.sessionId) state.listRef?.scrollBottom();
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
            if (sid === state.sessionId) state.listRef?.scrollBottom();
        } else if (event === "done") {
            state.loadingMap = { ...state.loadingMap, [sid]: false };
            markChatUnread(sid);
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) => {
                    if (i !== idx) return m;
                    return deps.processAssistantMessage({
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
            if (sid === state.sessionId && !state.activeIsApp) {
                state.listRef?.scrollBottom();
            } else {
                const preview = String(data.response ?? "").replace(/\s+/g, " ").trim().slice(0, 240);
                if (preview) deps.busEmitLocal("notifications:push", {
                    id: `chat:${sid}:${data.epoch ?? "turn"}:${data.seq ?? Date.now()}`,
                    title: "Response complete", message: preview,
                    click: `${deps.window.location.origin}${deps.window.location.pathname}?open=chat&session=${encodeURIComponent(sid)}`,
                    priority: 3, tags: [`notify_id:chat:${sid}`],
                });
            }
        } else if (event === "error") {
            state.loadingMap = { ...state.loadingMap, [sid]: false };
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
            state.loadingMap = { ...state.loadingMap, [sid]: false };
            updateSessionHistory(sid, (hist) => {
                const h = ensureStreamingAssistant(hist);
                const idx = h.length - 1;
                return h.map((m, i) => i === idx ? { ...m, content: "", streaming: false, timedOut: true, thinkingExpanded: false } : m);
            });
        }
        // 'commit' é ignorado ao vivo — serve ao slicing do replay no servidor
    }

    return { updateSessionHistory, markChatRead, markChatUnread, ensureStreamingAssistant, insertUserMessage, settleQueuedMessage, applyChatEvent };
}
