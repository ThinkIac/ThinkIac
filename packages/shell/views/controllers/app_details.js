/**
 * app details controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createAppDetails({ state: contextState, deps }) {
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
        contextState.appMenuOpen = false;
        contextState.appInfoTarget = contextState.activeAppInfo;
        contextState.appInfoOpen = true;
    }

    async function bootstrapHeaderActions() {
        try {
            const catalog = await deps.api("/apps/list", "GET", null, "shell");
            if (Array.isArray(catalog)) contextState.headerActionCatalog = catalog;
        } catch (error) {
            // Ações de cabeçalho são extensão opcional. O app ativo segue
            // disponível mesmo se o catálogo não puder ser atualizado.
            console.warn("[header-actions] failed to load contributions:", error);
        }
    }

    function runHeaderAction(action) {
        const frame = contextState.iframeRefs[contextState.activeTab];
        if (!action || !contextState.activeAppInfo || !frame?.contentWindow) return;
        contextState.appMenuOpen = false;
        frame.contentWindow.postMessage(deps.headerActionMessage(action, contextState.activeAppInfo), deps.window.location.origin);
    }

    function openCatalogAppInfo(event) {
        contextState.appMenuOpen = false;
        contextState.appInfoTarget = event.detail;
        contextState.appInfoOpen = true;
    }

    function closeAppInfo() {
        contextState.appInfoOpen = false;
        contextState.appInfoTarget = null;
    }

    return { buildAppDetails, openAppInfo, bootstrapHeaderActions, runHeaderAction, openCatalogAppInfo, closeAppInfo };
}
