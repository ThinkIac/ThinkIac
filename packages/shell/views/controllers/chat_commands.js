/**
 * chat commands controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createChatCommands({ state, deps }) {
    async function handleResolvePermission(e) {
        const { request_id, decision } = e.detail ?? {};
        if (!request_id) return;
        const target = e.detail?.session_id || state.sessionId;
        const result = await deps.api("/permission/resolve", "POST", {
            request_id, session_id: target, decision,
        });
        deps.updateSessionHistory(target, (hist) =>
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
        if (result?.ok) deps.busEmitLocal("notifications:resolved", { sessionId: target, requestId: request_id });
    }

    async function handleMessageFeedback(e) {
        const { assistantOrdinal, feedback } = e.detail ?? {};
        if (!Number.isInteger(assistantOrdinal) || !feedback) return;
        const result = await deps.api(`/sessions/${state.sessionId}/feedback`, "POST", {
            assistant_ordinal: assistantOrdinal,
            ...feedback,
        });
        if (!result?.success) return;
        deps.updateSessionHistory(state.sessionId, (hist) => {
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
        const target = sid || state.sessionId;
        const result = await deps.api("/chat/cancel", "POST", { session_id: target });
        if (!result?.success) return;
        deps.updateSessionHistory(target, (hist) => {
            // Mensagens ainda na fila não serão processadas (o servidor
            // limpa a fila no cancel) — remove para não enganar o usuário
            const filtered = hist.filter((m) => !m.queued);
            return filtered;
        });
    }

    async function retryTimedOutTurn(sid, index) {
        const target = sid || state.sessionId;
        const hist = state.sessionCache[target] || [];
        const input = deps.retryTurnInput(hist, index);
        if (!input || state.loadingMap[target]) return;
        if (target !== state.sessionId) await deps.activateSession(target);
        await send({ detail: input });
    }

    async function send(e) {
        const detail = e?.detail ?? e;
        const text =
            typeof detail === "object"
                ? detail.text ?? ""
                : String(detail ?? "");
        const attachments =
            typeof detail === "object" ? detail.attachments ?? [] : [];

        const targetSessionId = state.sessionId;

        if (text.trim() === "/clear") {
            await handleClearSession(targetSessionId);
            state.message = "";
            deps.clearComposerDraft(targetSessionId);
            return;
        }

        if (!text && attachments.length === 0) return;

        const busy = !!state.loadingMap[targetSessionId];

        state.tabs = state.tabs.map((t) => {
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
        deps.updateSessionHistory(targetSessionId, (hist) =>
            deps.insertUserMessage(hist, userMsg),
        );
        await state.listRef?.scrollBottom(true);

        if (!busy) {
            state.loadingMap = { ...state.loadingMap, [targetSessionId]: true };
            deps.updateSessionHistory(targetSessionId, deps.ensureStreamingAssistant);
        }

        const r = await deps.api("/chat/send", "POST", {
            message: llmMessageContent,
            session_id: targetSessionId,
            settings: detail?.settings,
            metadata: detail?.metadata,
            retry: detail?.retry === true,
        });

        if (!r?.accepted && !r?.queued && !r?.forwarded) {
            // Falha de rede ou rejeição HTTP: mantém a mensagem do usuário e
            // apresenta a causa na bolha de resposta.
            state.loadingMap = { ...state.loadingMap, [targetSessionId]: false };
            deps.updateSessionHistory(targetSessionId, (hist) => {
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

        deps.clearComposerDraft(targetSessionId);
        if (state.sessionId === targetSessionId) state.message = "";

        if (r.forwarded) {
            // Mensagem era resposta a uma pergunta pendente (ask_user) — não
            // inicia turno novo; limpa o estado de fila/eco do input
            deps.updateSessionHistory(targetSessionId, (hist) =>
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

    async function onStructuredSend(e) {
        const handlerStep = state.structuredProps?.find((step) => step?.submitEvent || step?.localAction);
        const detail = e?.detail ?? {};
        if (!handlerStep) {
            send(e);
            detail.acknowledge?.();
            return;
        }
        // Use a rota confirmável para aprovações de governança. O envio WS é
        // fire-and-forget e antes fazia o botão parecer aceito sem gravar nada.
        if (handlerStep.governanceDecisionId) {
            const approved = detail.responses?.[state.structuredProps.indexOf(handlerStep)] === handlerStep.confirmLabel;
            try {
                const response = await deps.fetch('/governance/confirmations/resolve', {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ sessionId: state.sessionId, decisionId: handlerStep.governanceDecisionId, approved }),
                });
                const result = await response.json().catch(() => null);
                if (!response.ok || result?.success === false || !(result?.data?.status || result?.status)) {
                    throw new Error(result?.error || `Could not record approval (HTTP ${response.status}).`);
                }
                if (state.lastMessage) {
                    state.lastMessage._structuredData = null;
                    state.history = [...state.history];
                    (state.sessionCache[state.sessionId] = [...state.history], state.sessionCache = state.sessionCache);
                }
                detail.acknowledge?.();
            } catch (error) {
                detail.reject?.(error?.message);
            }
            return;
        }
        deps.busEmit(handlerStep.submitEvent, {
            sessionId: state.sessionId, submissionId: `${state.sessionId}:${Date.now()}`,
            responseEvent: handlerStep.responseEvent, steps: state.structuredProps,
            responses: detail.responses, text: detail.text,
        });
        detail.acknowledge?.();
    }

    async function handleClearSession(sid) {
        const target = sid || state.sessionId;
        await deps.api(`/sessions/${target}/clear`, "GET");
        (delete state.sessionCache[target], state.sessionCache = state.sessionCache);
        (delete state.cursorMap[target], state.cursorMap = state.cursorMap);
        (state.reconcileGeneration[target] = (state.reconcileGeneration[target] || 0) + 1, state.reconcileGeneration = state.reconcileGeneration);
        state.loadingMap = { ...state.loadingMap, [target]: false };
        if (target === state.sessionId) {
            state.history = [];
            await deps.tick();
        }
        state.refreshTrigger++;
    }

    return { handleResolvePermission, handleMessageFeedback, handleStop, retryTimedOutTurn, send, onStructuredSend, handleClearSession };
}
