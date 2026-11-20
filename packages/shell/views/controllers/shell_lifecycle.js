/**
 * shell lifecycle controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createShellLifecycle({ state: contextState, deps }) {
    function mountShell() {
        let disposed = false;
        contextState.nativeApp = Boolean(deps.window.FlutterBridge?.postMessage);
        contextState.desktopHost = deps.isHostedByDesktop(deps.window);
        if (!contextState.desktopHost) {
            const bridge = deps.installShellDesktopControl();
            if (disposed) bridge.stop();
            else contextState.shellDesktopControl = bridge;
        }
        contextState.theme = deps.getTheme();
        contextState.activeAgentId = deps.readSessionAgent(deps.localStorage, contextState.sessionId);
        deps.agentRuntime.activateAgent(contextState.activeAgentId);
        deps.loadSessionPreferences();
        deps.checkMobile();
        contextState.layoutReady = true;

        deps.bootstrapBackgroundViews().then(() => {
            if (!disposed) deps.publishBackgroundContext({ category: "chat", contextId: "chat", contextLabel: "Chat" });
        });

        // ── Canal WS de eventos de chat ──
        const offMessage = deps.agentRuntime.on((envelope) => {
            const msg = envelope.message;
            if (msg.type === "chat:event") {
                if (envelope.agentId !== deps.readSessionAgent(deps.localStorage, msg.session_id)) return;
                deps.applyChatEvent(msg.session_id, msg.event, msg.data, msg.seq, msg.epoch);
            } else if (msg.type === "sessions:updated") {
                contextState.refreshTrigger++;
                if (contextState.history.length === 0) deps.maybeLoadRecentSessions();
            } else if (msg.type === "bus:event") {
                // Evento vindo do backend → re-emite no bus local (sem
                // reencaminhar, para não criar loop).
                deps.busEmitLocal(msg.event, msg.detail);
            }
        });
        // A cada (re)abertura do socket, reconcilia as sessões abertas —
        // cobre tanto o primeiro load (sessão pode estar respondendo desde
        // antes do refresh) quanto quedas de conexão no meio do stream.
        const offReopen = deps.agentRuntime.onReopen((reopenedAgentId) => {
            deps.agentRuntime.subscribeAll(contextState.tabs.map((t) => t.sessionId));
            deps.agentRuntime.setUiState({
                activeChatSessionId: contextState.activeIsApp ? null : contextState.sessionId,
            });
            for (const t of contextState.tabs) {
                if (deps.readSessionAgent(deps.localStorage, t.sessionId) === reopenedAgentId) deps.reconcileSession(t.sessionId);
            }
        });
        const offCommand = deps.agentRuntime.onCommand(({ agentId: commandAgentId, command }) => {
            if (commandAgentId !== contextState.activeAgentId) return;
            if (command?.type === "navigate" && typeof command.path === "string" && command.path.startsWith("/") && !command.path.startsWith("//")) {
                deps.window.location.assign(command.path);
            } else if (command?.type === "request-snapshot") {
                deps.agentRuntime.sendSnapshot(createUiSnapshot());
            }
        });
        deps.agentRuntime.connectAll();

        // Registra widgets contribuídos por pacotes e liga o bus de UI.
        deps.setupWidgetBus();
        // Descobre itens de menu contribuídos por pacotes (manifest.menu).
        deps.bootstrapMenuItems();
        // Descobre ações de cabeçalho declaradas por addons e pacotes.
        deps.bootstrapHeaderActions();
        // As ações contextuais não tornam seus pacotes apps do catálogo.
        // Consulta a disponibilidade explicitamente para nunca oferecer uma
        // rota que não está instalada neste Runtime.
        deps.loadChatFeatureAvailability();

        // Tentar restaurar estado antes de carregar o workspace
        const restored = deps.fullRestoreSessionState();
        if (restored && contextState.tabs.length > 0) {
            // Se restaurou, ativar a sessão restaurada
            if (contextState.activeIsApp) {
                // App tabs são mantidas, não ativa sessão de chat
            } else {
                // Ativar a sessão restaurada
                deps.activateSession(contextState.sessionId).catch(() => {});
            }
        }
        deps.loadSystem();
        if (!restored || !contextState.tabs.length) deps.loadWorkspace();

        // A entrada atual é a base da navegação interna. Ela é substituída,
        // nunca acrescentada, para preservar a rota que abriu o Shell.
        deps.replaceMobileBrowserHistoryEntry();

        // Deep-link vindo de notificação push (ver packages/ntfy/AGENT.md)
        // — tem prioridade sobre a sessão restaurada/padrão acima.
        if (contextState.open === "chat" && contextState.session) {
            deps.abrirChatPorDeepLink(contextState.session);
        } else if (contextState.open === "app" && contextState.app) {
            deps.abrirAppPorDeepLink(contextState.app);
        } else if (contextState.open === "result") {
            deps.abrirResultadoPorDeepLink({ pkg: contextState.pkg, file: contextState.file });
        } else if (contextState.open === "path") {
            deps.abrirCaminhoInterno(contextState.url, contextState.title || "Home page");
        }
        if (contextState.open === "chat" && contextState.listen === "1") {
            deps.tick().then(() => deps.window.dispatchEvent(
                new deps.CustomEvent("thinkiac:shell:start-dictation"),
            ));
        }

        // A URL é usada somente para a primeira abertura. Nas seguintes, o
        // Desktop envia diretamente ao iframe focado para não recarregar a
        // janela nem criar uma segunda sessão.
        const initialDesktopHandoff = deps.consumeDesktopHandoff();
        if (initialDesktopHandoff) deps.openDesktopComposition(initialDesktopHandoff);
        const onDesktopMessage = (event) => {
            const data = event.data;
            if (data?.source !== "thinkiac-desktop") return;
            if (data.type === "shell:new-message") {
                deps.openDesktopComposition(data.detail);
            } else if (data.type === "shell:open-session") {
                deps.handleSelectSession({ detail: { sessionId: data.detail?.sessionId } });
            } else if (data.type === "shell:stop") {
                deps.handleStop(data.detail?.sessionId);
            }
        };
        deps.window.addEventListener("message", onDesktopMessage);
        deps.setupGestureProtocol();

        // A altura do composer não é fixa: o textarea, anexos e controles
        // opcionais podem crescer sem uma nova mensagem. A MessageList usa
        // esta medida para nunca terminar atrás dele.
        let composerObserver = null;
        deps.tick().then(() => {
            if (disposed) return;
            deps.measureComposerDock();
            if (typeof ResizeObserver !== "undefined" && contextState.composerStage) {
                composerObserver = new ResizeObserver(deps.measureComposerDock);
                composerObserver.observe(contextState.composerStage);
            }
        });

        deps.window.addEventListener("resize", deps.checkMobile);
        deps.window.addEventListener("popstate", deps.handleMobileBrowserBack);
        deps.window.addEventListener("online", deps.handleOnline);
        deps.window.addEventListener("offline", deps.handleOffline);

        // ── Eventos de persistência ──
        deps.window.addEventListener("beforeunload", deps.fullSaveSessionState);
        const onVisibilityChange = () => {
            if (deps.document.hidden) deps.fullSaveSessionState();
        };
        deps.document.addEventListener("visibilitychange", onVisibilityChange);
        // Salvar periodicamente
        const persistInterval = setInterval(deps.fullSaveSessionState, 30000);

        // Verifica estado inicial
        if (!deps.navigator.onLine) {
            deps.handleOffline();
        }

        // A confirmação ocorre no próximo frame, quando a árvore Svelte já
        // foi hidratada e a WebView pode remover seu loading nativo com
        // segurança. Não depende de consultas frágeis ao DOM.
        requestAnimationFrame(() => {
            if (disposed) return;
            contextState.showLoading = false;
            deps.postEdgeStatus({ type: "ready", surface: contextState.floatingShell ? "floating-shell" : "default" });
        });

        return () => {
            if (disposed) return;
            disposed = true;
            composerObserver?.disconnect();
            offMessage?.();
            offReopen?.();
            offCommand?.();
            contextState.shellDesktopControl?.stop();
            deps.disposeBackgroundViews();
            for (const off of contextState.busOffs) off?.();
            contextState.busOffs = [];
            for (const off of contextState.gestureOffs) off?.();
            contextState.gestureOffs = [];
            deps.window.removeEventListener("resize", deps.checkMobile);
            deps.window.removeEventListener("popstate", deps.handleMobileBrowserBack);
            deps.window.removeEventListener("online", deps.handleOnline);
            deps.window.removeEventListener("offline", deps.handleOffline);
            deps.window.removeEventListener("beforeunload", deps.fullSaveSessionState);
            deps.window.removeEventListener("message", onDesktopMessage);
            deps.document.removeEventListener(
                "visibilitychange",
                onVisibilityChange,
            );
            if (contextState.reconnectTimer) clearInterval(contextState.reconnectTimer);
            if (contextState.globalLoadingTimer) clearTimeout(contextState.globalLoadingTimer);
            if (persistInterval) clearInterval(persistInterval);
        };
    }

    function createUiSnapshot() {
        const elements = [...deps.document.querySelectorAll("button, a, input, textarea, [role='button']")]
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
            route: `${deps.window.location.pathname}${deps.window.location.search}`,
            activeChatSessionId: contextState.activeIsApp ? null : contextState.sessionId,
            elements,
            updatedAt: new Date().toISOString(),
        };
    }

    return { mountShell, createUiSnapshot };
}
