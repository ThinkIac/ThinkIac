/**
 * chat tools controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createChatTools({ state: contextState, deps }) {
    function openChatInfo() {
        contextState.chatMenuOpen = false;
        contextState.chatInfoOpen = true;
    }

    async function loadChatFeatureAvailability() {
        const result = await deps.api("/apps/availability?packages=artifacts,bags", "GET", null, "shell");
        if (result?.error || !result?.packages) return;
        contextState.chatFeatureAvailability = {
            artifacts: result.packages.artifacts === true,
            bags: result.packages.bags === true,
        };
    }

    async function openBag() {
        if (!contextState.chatFeatureAvailability.bags) return;
        const targetSessionId = contextState.activeIsApp ? contextState.sessionId : (contextState.activeTab || contextState.sessionId);
        contextState.chatMenuOpen = false;
        if (!targetSessionId) return;

        contextState.bagSheetOpen = true;
        contextState.bagStatus = null;
        contextState.bagError = "";
        contextState.bagLoading = true;
        try {
            const result = await deps.api(`/status/${encodeURIComponent(targetSessionId)}`, "GET", null, "bags", { timeoutMs: 12000 });
            if (result?.success) contextState.bagStatus = result;
            else if (result?.error && result.code !== "route_not_found") contextState.bagError = result.error;
        } finally {
            contextState.bagLoading = false;
        }
    }

    function openArtifactLibrary() {
        if (!contextState.chatFeatureAvailability.artifacts) return;
        contextState.chatMenuOpen = false;
        const targetSessionId = contextState.activeIsApp ? contextState.sessionId : (contextState.activeTab || contextState.sessionId);
        if (!targetSessionId) return;
        const filter = encodeURIComponent(targetSessionId);
        const artifactTabId = `artifacts:${targetSessionId}`;
        // Uma aba de artefatos já aberta preserva seu próprio filtro. Um novo
        // pedido abre outra aba, sem reutilizar ou alterar a anterior.
        const id = contextState.appTabs.some((tab) => tab.id === artifactTabId)
            ? `${artifactTabId}:${Date.now()}`
            : artifactTabId;
        deps.handleOpenApp({ detail: {
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
        if (!contextState.sessionId) return;
        try {
            await deps.navigator.clipboard.writeText(contextState.sessionId);
            contextState.chatMenuMessage = "Identifier copied.";
            clearTimeout(contextState.chatMenuMessageTimer);
            contextState.chatMenuMessageTimer = setTimeout(() => {
                contextState.chatMenuMessage = "";
            }, 2200);
        } catch {
            contextState.chatMenuMessage = "Unable to copy identifier.";
        }
    }

    return { openChatInfo, loadChatFeatureAvailability, openBag, openArtifactLibrary, copyActiveSessionId };
}
