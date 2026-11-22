/**
 * app navigation controller.
 * State uses live accessors supplied by the Svelte composition root.
 * Dependencies are explicit; creating a controller has no browser side effects.
 * @param {{state: object, deps: object}} context
 */
export function createAppNavigation({ state: contextState, deps }) {
    async function abrirChatPorDeepLink(sid) {
        if (!sid) return;
        deps.recordMobileNavigation({ kind: "chat", id: sid });
        const existing = contextState.tabs.find((t) => t.sessionId === sid);
        if (!existing) {
            contextState.tabs = [
                ...contextState.tabs,
                { sessionId: sid, name: "New Mission", pinned: false },
            ];
        }
        contextState.activeTab = sid;
        contextState.activeIsApp = false;
        await deps.activateSession(sid);
        if (contextState.isMobile) deps.closePanel();
    }

    async function abrirAppPorDeepLink(appTargetId) {
        if (!appTargetId) return;
        const existing = contextState.appTabs.find((t) => t.id === appTargetId);
        if (existing) {
            deps.handleOpenApp({ detail: existing });
            return;
        }
        const apps = await deps.api("/apps/list", "GET", null, "shell");
        const found = Array.isArray(apps)
            ? apps.find((a) => a.id === appTargetId)
            : null;
        if (!found) {
            console.warn(`[deep-link] app "${appTargetId}" not found`);
            return;
        }
        deps.handleOpenApp({ detail: found });
    }

    async function abrirResultadoPorDeepLink({ pkg: sourcePkg, file: resultFile }) {
        const apps = await deps.api("/apps/list", "GET", null, "shell");
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
            const existing = contextState.appTabs.find((t) => t.id === id);
            if (existing) return deps.handleOpenApp({ detail: existing });
            return deps.handleOpenApp({ detail: { id, name: fileApp.name || "Files", url, icon: fileApp.icon } });
        }
        // Fallback: abre o app do pacote de origem (mostra sua tela de resultado).
        const pkgApp = sourcePkg
            ? list.find((a) => a?.url?.includes(`/view/${sourcePkg}/`))
            : null;
        if (pkgApp) return deps.handleOpenApp({ detail: pkgApp });
        console.warn(`[deep-link] open=result: nem file-manager nem "${sourcePkg}" encontrados`);
    }

    async function abrirAppPorPacote(pkg) {
        if (!pkg) return;
        // pkg pode ser o nome do pacote, o id do app, ou a própria url.
        const existing = contextState.appTabs.find(
            (t) => t.id === pkg || t.name === pkg || t.url === pkg,
        );
        if (existing) return deps.handleOpenApp({ detail: existing });
        const apps = await deps.api("/apps/list", "GET", null, "shell");
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
        deps.handleOpenApp({ detail: found });
    }

    function abrirIframe(d = {}) {
        const { url, title } = d;
        if (!url) return;
        const id = `iframe:${url}`;
        const existing = contextState.appTabs.find((t) => t.id === id);
        if (existing) return deps.handleOpenApp({ detail: existing });
        deps.handleOpenApp({ detail: { id, name: title || "App", url } });
    }

    async function abrirAppComPath(d = {}) {
        const { pkg, url, title } = d;
        if (!url) return;
        const id = `open:${url}`; // url inclui o path → uma aba por arquivo
        const existing = contextState.appTabs.find((t) => t.id === id);
        if (existing) return deps.handleOpenApp({ detail: existing });
        // Tenta herdar nome/ícone do App a partir de /apps/list (mesma fonte de
        // abrirAppPorPacote); se não achar, usa só o título do opener.
        let name = title || "App";
        let icon;
        try {
            const apps = await deps.api("/apps/list", "GET", null, "shell");
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
        deps.handleOpenApp({ detail: { id, name, url, icon } });
    }

    function abrirCaminhoInterno(path, label = "Page") {
        if (typeof path !== "string" || !path.startsWith("/") || path.startsWith("//")) return;
        return abrirAppComPath({ url: path, title: label });
    }

    function abrirPreviewNoFileManager(detail = {}) {
        const url = deps.filePreviewUrl(detail);
        if (!url) return;
        return abrirAppComPath({ pkg: "file-manager", url, title: detail.title || detail.name || "Preview" });
    }

    return { abrirChatPorDeepLink, abrirAppPorDeepLink, abrirResultadoPorDeepLink, abrirAppPorPacote, abrirIframe, abrirAppComPath, abrirCaminhoInterno, abrirPreviewNoFileManager };
}
