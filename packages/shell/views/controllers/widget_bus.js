/**
 * widget bus controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createWidgetBus({ state: contextState, deps }) {
    function setupWidgetBus() {
        deps.bootstrapPackageWidgets();
        deps.bootstrapMessageActions();
        // Ponte front→back: eventos logos:/think: (ou {server:true}) viajam
        // pelo WS e viram dispatchEvent no backend.
        deps.setServerForwarder((event, detail) =>
            deps.agentRuntime.send({ type: "bus:emit", event, detail }),
        );
        contextState.busOffs.push(deps.busOn("open:app", (pkg) => deps.abrirAppPorPacote(pkg)));
        contextState.busOffs.push(deps.busOn("shell:loading", (detail) => deps.setGlobalLoading(detail)));
        contextState.busOffs.push(deps.busOn("shell:reload", () => {
            // O widget vive em iframe; o Shell é quem pode resetar toda a
            // página e reconstruir os widgets usando o cache já limpo.
            deps.window.location.reload();
        }));
        contextState.busOffs.push(deps.busOn("agent:deep-link", (target) => {
            if (target?.type === "chat") return deps.abrirChatPorDeepLink(target.session);
            if (target?.type === "app") return deps.abrirAppPorDeepLink(target.app);
            if (target?.type === "result") return deps.abrirResultadoPorDeepLink(target);
        }));
        contextState.busOffs.push(deps.busOn("open:iframe", (d) => deps.abrirIframe(d)));
        contextState.busOffs.push(deps.busOn("open:with", (d) => deps.abrirAppComPath(d)));
        contextState.busOffs.push(deps.busOn(deps.FILE_MANAGER_PREVIEW_EVENT, (d) => deps.abrirPreviewNoFileManager(d)));
        // Um pacote ou controle local pode pedir uma view modal sem precisar
        // conhecer o estado visual do Shell. URLs relativas evitam que esse
        // canal vire uma abertura arbitrária de conteúdo externo.
        contextState.busOffs.push(deps.busOn("modal-ui", (modal) => {
            if (!modal?.label || typeof modal.url !== "string" || !modal.url.startsWith("/")) return;
            contextState.statusModal = { label: modal.label, url: modal.url };
        }));
        // Permite que um package (rodando em iframe) abra o Canvas de verdade
        // via parent.postMessage({source:"aurora", type:"open:canvas", detail:{html}}),
        // mesmo caminho que MessageList usa internamente (handleOpenCanvas).
        contextState.busOffs.push(deps.busOn("open:canvas", (d) => deps.handleOpenCanvas({ detail: d || {} })));
        contextState.busOffs.push(deps.busOn("message-actions:refresh", () => deps.bootstrapMessageActions()));
        // A menu contribution runs one iframe below the Shell. Forward a
        // selected central notification to the Desktop host, which owns the
        // native governance approval overlay.
        contextState.busOffs.push(deps.busOn("notifications:activate", (notification) => {
            if (deps.window.parent === deps.window) return;
            deps.window.parent.postMessage({
                source: "thinkiac-shell",
                type: "notifications:activate",
                detail: notification,
            }, deps.window.location.origin);
        }));
        contextState.busOffs.push(deps.busOn("structured-input:resolved", (detail) => {
            if (!detail?.text || detail.sessionId !== contextState.sessionId) return;
            deps.send({ detail: { text: detail.text } });
        }));
        // Observabilidade da volta (back→front): loga o pong da demo.
        contextState.busOffs.push(
            deps.busOn("logos:pong", (d) => console.log("[bus] logos:pong", d)),
        );
    }

    return { setupWidgetBus };
}
