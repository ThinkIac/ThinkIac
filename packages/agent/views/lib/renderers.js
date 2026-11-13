/**
 * Registry DINÂMICO de renderers interpretativos de markdown.
 *
 * Built-ins são registrados no fim deste arquivo; pacotes registram os seus
 * via registerRenderer() (ver widget_bootstrap.js). BLOCK_REGEX/OPEN_BLOCK_REGEX
 * são live-bindings reconstruídas a cada registro — quem faz
 * `import { BLOCK_REGEX } from "./renderers.js"` sempre enxerga a versão atual.
 *
 * Para reatividade em componentes já montados (registro tardio/assíncrono),
 * assine `registryVersion` (Svelte store): ele incrementa a cada registerRenderer.
 */
import { writable } from "svelte/store";


export const renderers = {};

const propMaps = {};

const partialMins = {};

export const aliases = {};


export const registryVersion = writable(0);


export let BLOCK_REGEX;
export let OPEN_BLOCK_REGEX;

function escapeRe(s) {
    return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function rebuildRegex() {
    
    const allLangs = [...Object.keys(renderers), ...Object.keys(aliases)]
        .sort((a, b) => b.length - a.length)
        .map(escapeRe);
    if (allLangs.length === 0) {
        
        BLOCK_REGEX = /$^/g;
        OPEN_BLOCK_REGEX = /$^/;
        return;
    }
    const alt = allLangs.join("|");
    BLOCK_REGEX = new RegExp("```(" + alt + ")\\s*\\n([\\s\\S]*?)```", "gi");
    OPEN_BLOCK_REGEX = new RegExp("```(" + alt + ")\\s*\\n([\\s\\S]*)$", "i");
}

/**
 * Registra (ou sobrescreve) um renderer de bloco markdown.
 * @param {string} type  tag de linguagem canônica (ex: "mermaid", "counter")
 * @param {() => Promise<{default:any}>} loader  dynamic import do componente
 * @param {object} [opts]
 * @param {string[]} [opts.aliases]  langs equivalentes que resolvem para `type`
 * @param {(source:string)=>object} [opts.propMap]  props extras p/ o componente
 * @param {number} [opts.partialMin]  min chars p/ preview parcial (default 10)
 */
export function registerRenderer(type, loader, opts = {}) {
    if (!type || typeof loader !== "function") return;
    const t = String(type).toLowerCase();
    renderers[t] = loader;
    if (opts.propMap) propMaps[t] = opts.propMap;
    if (typeof opts.partialMin === "number") partialMins[t] = opts.partialMin;
    for (const a of opts.aliases ?? []) aliases[String(a).toLowerCase()] = t;
    rebuildRegex();
    registryVersion.update((n) => n + 1);
}

/** Remove um renderer registrado (e seus aliases). */
export function unregisterRenderer(type) {
    const t = String(type).toLowerCase();
    delete renderers[t];
    delete propMaps[t];
    delete partialMins[t];
    for (const [a, canon] of Object.entries(aliases)) {
        if (canon === t) delete aliases[a];
    }
    rebuildRegex();
    registryVersion.update((n) => n + 1);
}

/** Props a passar ao componente do renderer. Default: { source }. */
export function getProps(type, source) {
    const fn = propMaps[type];
    return fn ? fn(source) : { source };
}

/** Mínimo de chars para acionar preview parcial em streaming. */
export function getPartialMin(type) {
    return partialMins[type] ?? 10;
}

/**
 * Resolve um lang string para o tipo canônico do registry.
 * Retorna null se não reconhecido.
 */
export function resolveType(lang) {
    const l = (lang ?? "").toLowerCase();
    return aliases[l] ?? (renderers[l] ? l : null);
}



registerRenderer("html", () => import("../components/SvelteFrame.svelte"), {
    aliases: ["svelte"],
    propMap: (source) => ({ code: source }),
});
registerRenderer("d2", () => import("../components/D2Frame.svelte"));
registerRenderer("markmap", () => import("../components/MarkmapFrame.svelte"));
registerRenderer("mermaid", () => import("../components/MermaidFrame.svelte"));
registerRenderer("js", () => import("../components/CodeView.svelte"));
registerRenderer("javascript", () => import("../components/CodeView.svelte"));
registerRenderer("file", () => import("../components/FilePreview.svelte"), {
    propMap: (source) => ({ path: source.trim() }),
});
