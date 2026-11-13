










import { registerRenderer } from "./renderers.js";
import { installPostMessageBridge } from "./bus.js";
import { api } from "../api.js";

const PKG_WIDGET_LOADER = () => import("../components/PackageWidget.svelte");
const registered = new Set();

export async function bootstrapPackageWidgets() {
    
    installPostMessageBridge();

    let apps;
    try {
        apps = await api("/apps/list", "GET", null, "aura-system");
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
            
            
            propMap: (source) => ({
                url: app.url,
                source,
                title: w.title || app.name || lang,
            }),
        });
    }
}
