// Contrato completo: ../../docs/package-widgets-and-ui-bus.md
// widget_bootstrap.js — descoberta de widgets de markdown contribuídos por
// PACOTES. Um pacote declara seu widget no package.json:
//
//   "manifest": { "widget": { "lang": "counter", "title": "Counter" } }
//
// e serve uma view Svelte (views/index.svelte). O /apps/list (shell)
// expõe esse `widget`, e aqui registramos a lang → PackageWidget (iframe da
// view do pacote). A partir daí, um bloco ```counter ... ``` numa mensagem do
// chat renderiza o widget inline. Registro no boot, antes das mensagens
// parsearem — MessageList não precisa mudar.
import { registerRenderer } from "./renderers.js";
import { installPostMessageBridge } from "./bus.js";
import { api } from "../api.js";

const PKG_WIDGET_LOADER = () => import("../components/PackageWidget.svelte");
const registered = new Set();

export async function bootstrapPackageWidgets() {
    // Liga a ponte postMessage (iframes de apps/widgets → bus local).
    installPostMessageBridge();

    let apps;
    try {
        apps = await api("/apps/list", "GET", null, "shell");
    } catch (e) {
        console.error("[widgets] falha ao listar apps:", e);
        return;
    }
    if (!Array.isArray(apps)) return;

    for (const app of apps) {
        const w = app?.widget;
        if (!w?.lang || !app?.url) continue;
        const lang = String(w.lang).toLowerCase();
        if (registered.has(lang)) continue;
        registered.add(lang);

        registerRenderer(lang, PKG_WIDGET_LOADER, {
            aliases: Array.isArray(w.aliases) ? w.aliases : undefined,
            partialMin: typeof w.partialMin === "number" ? w.partialMin : undefined,
            // O backend anexa o manifest apenas à view declarada em
            // `widget.view`, então a URL publicada já é a rota correta.
            propMap: (source) => ({
                url: app.url,
                source,
                title: w.title || app.name || lang,
            }),
        });
    }
}
