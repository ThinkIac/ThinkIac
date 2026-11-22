/**
 * session loading controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createSessionLoading({ state, deps }) {
    function historyPath(sid, all = false) {
        const limit = all || !state.isMobile ? "all" : 100;
        return `/sessions/${encodeURIComponent(sid)}/history?limit=${limit}`;
    }

    async function loadFullHistory() {
        if (state.loadingFullHistory || !state.historyTruncated) return;
        const sid = state.sessionId;
        const agentId = deps.readSessionAgent(deps.localStorage, sid);
        state.loadingFullHistory = true;
        try {
            const data = await apiForAgent(agentId, historyPath(sid, true), "GET");
            if (sid !== state.sessionId || !Array.isArray(data)) return;
            const fullHistory = deps.sanitizeHistoryMessages(data);
            (state.sessionCache[sid] = fullHistory, state.sessionCache = state.sessionCache);
            state.history = fullHistory;
            state.historyTruncated = false;
            await deps.tick();
            await state.listRef?.scrollBottom(true);
        } finally {
            state.loadingFullHistory = false;
        }
    }

    async function discardResolvedGovernanceCard(sid) {
        const source = state.sessionCache[sid] || [];
        const message = source[source.length - 1];
        const steps = Array.isArray(message?._structuredData)
            ? message._structuredData
            : message?._structuredData ? [message._structuredData] : [];
        const decisionId = steps.find((step) => step?.governanceDecisionId)?.governanceDecisionId;
        if (!decisionId) return;
        try {
            const response = await deps.fetch(`/governance/confirmations/pending?sessionId=${encodeURIComponent(sid)}`);
            const result = await response.json();
            const pending = result?.data ?? result;
            if (response.ok && Array.isArray(pending) && !pending.some((row) => row?.id === decisionId)) {
                const current = state.sessionCache[sid] || [];
                const index = current.indexOf(message);
                if (index < 0) return;
                const updated = current.map((item, itemIndex) => itemIndex === index
                    ? { ...item, _structuredData: null }
                    : item);
                (state.sessionCache[sid] = updated, state.sessionCache = state.sessionCache);
                if (!state.activeIsApp && state.sessionId === sid) state.history = updated;
            }
        } catch {
            // Falha fechada: sem confirmar o estado, preserva o card.
        }
    }

    async function activateSession(sid) {
        const activation = state.sessionActivation.begin(sid);
        state.historyTruncated = false;
        state.activeAgentId = deps.readSessionAgent(deps.localStorage, sid);
        deps.agentRuntime.activateAgent(state.activeAgentId);
        // Abrir a conversa também consome seus avisos informativos. A emissão
        // local fecha o toast imediatamente; a mensagem WS persiste a leitura.
        deps.busEmitLocal("ntfy:session-read", { sessionId: sid });
        deps.agentRuntime.send({
            type: "bus:emit",
            event: "ntfy:session-read",
            detail: { sessionId: sid },
        });
        if (state.sessionCache[sid]) {
            state.sessionId = sid;
            const cachedHistory = state.sessionCache[sid].map((m) => ({
                ...m,
                thinkingExpanded: m.thinkingExpanded ?? false,
            }));
            state.historyTruncated = state.isMobile && cachedHistory.length >= 100;
            (state.sessionCache[sid] = cachedHistory, state.sessionCache = state.sessionCache);
            if (state.sessionActivation.isCurrent(activation, state.sessionId, state.activeIsApp)) {
                state.history = cachedHistory;
            }
            await discardResolvedGovernanceCard(sid);
            if (!state.sessionActivation.isCurrent(activation, state.sessionId, state.activeIsApp)) return;
            await deps.tick();
            await state.listRef?.scrollBottom(true);
            // Cache pode estar defasado se a sessão segue respondendo
            reconcileSession(sid);
            return;
        }
        state.sessionId = sid;
        const data = await deps.api(historyPath(sid), "GET");
        const loadedHistory = deps.sanitizeHistoryMessages(data || []);
        if (!state.sessionActivation.isCurrent(activation, state.sessionId, state.activeIsApp)) return;
        state.historyTruncated = state.isMobile && loadedHistory.length >= 100;
        const liveHistory = state.sessionCache[sid];
        if (liveHistory?.some((item) => item?._localEchoContent)) {
            state.history = liveHistory;
            await deps.tick();
            await state.listRef?.scrollBottom(true);
            reconcileSession(sid);
            return;
        }
        state.history = loadedHistory;
        if (loadedHistory.length > 0) (state.sessionCache[sid] = loadedHistory, state.sessionCache = state.sessionCache);
        else (delete state.sessionCache[sid], state.sessionCache = state.sessionCache);
        await discardResolvedGovernanceCard(sid);
        if (!state.sessionActivation.isCurrent(activation, state.sessionId, state.activeIsApp)) return;
        await deps.tick();
        await state.listRef?.scrollBottom(true);
        // Se a sessão ainda está respondendo no servidor, reata o stream
        reconcileSession(sid);
    }

    async function apiForAgent(agentId, path, method = "GET", body = null) {
        try {
            const options = { method, headers: { "Content-Type": "application/json" } };
            if (body) options.body = JSON.stringify(body);
            const response = await deps.agentRuntime.requestForAgent(agentId, path, options);
            const payload = await response?.json?.();
            return payload?.data ?? payload ?? null;
        } catch {
            return null;
        }
    }

    async function reconcileSession(sid) {
        if (!sid) return;
        const sessionAgentId = deps.readSessionAgent(deps.localStorage, sid);
        const generation = (state.reconcileGeneration[sid] || 0) + 1;
        (state.reconcileGeneration[sid] = generation, state.reconcileGeneration = state.reconcileGeneration);
        const status = await apiForAgent(sessionAgentId, `/sessions/${sid}/status`, "GET");
        if (state.reconcileGeneration[sid] !== generation) return;
        if (!status) return; // servidor inacessível — não mexe no estado

        const cached = state.sessionCache[sid];
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
            if ((staleStreaming || state.loadingMap[sid]) && !hasLocalEcho) {
                (delete state.sessionCache[sid], state.sessionCache = state.sessionCache);
                state.loadingMap = { ...state.loadingMap, [sid]: false };
                const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
                if (state.reconcileGeneration[sid] !== generation) return;
                const refreshed = deps.sanitizeHistoryMessages(data || []);
                if (refreshed.length > 0) (state.sessionCache[sid] = refreshed, state.sessionCache = state.sessionCache);
                deps.markChatUnread(sid);
                if (sid === state.sessionId) {
                    state.history = state.sessionCache[sid] || state.history;
                    await deps.tick();
                    await state.listRef?.scrollBottom(true);
                }
            }
            return;
        }

        // Sessão ativa no servidor
        if (state.cursorMap[sid] == null) {
            // Sem estado ao vivo (página recém-aberta): o cache local pode
            // conter tokens antigos que o replay repetiria — parte do
            // histórico do disco, que cobre exatamente até o último commit.
            if (!cached?.length) {
                const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
                (state.sessionCache[sid] = deps.sanitizeHistoryMessages(data || []), state.sessionCache = state.sessionCache);
                if (sid === state.sessionId) state.history = state.sessionCache[sid];
            }
        }

        state.loadingMap = { ...state.loadingMap, [sid]: true };
        const r = await apiForAgent(sessionAgentId, "/chat/stream/reconnect", "POST", {
            session_id: sid,
            epoch: state.cursorMap[sid]?.epoch ?? null,
            last_event_id: state.cursorMap[sid]?.seq ?? null,
        });
        if (state.reconcileGeneration[sid] !== generation) return;
        if (r?.cursor_mismatch) {
            const data = await apiForAgent(sessionAgentId, historyPath(sid), "GET");
            if (state.reconcileGeneration[sid] !== generation) return;
            const refreshed = deps.sanitizeHistoryMessages(data || []);
            if (refreshed.length > 0) (state.sessionCache[sid] = refreshed, state.sessionCache = state.sessionCache);
            if (sid === state.sessionId) state.history = state.sessionCache[sid] || state.history;
        }
        for (const ev of r?.events ?? []) {
            deps.applyChatEvent(sid, ev.event, ev.data, Number(ev.id), ev.epoch || r.epoch);
        }
        if (!r?.active && !r?.done && !r?.error) {
            state.loadingMap = { ...state.loadingMap, [sid]: false };
        }
        if (sid === state.sessionId) {
            await deps.tick();
            await state.listRef?.scrollBottom(true);
        }
    }

    return { historyPath, loadFullHistory, discardResolvedGovernanceCard, activateSession, apiForAgent, reconcileSession };
}
