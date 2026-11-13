// Tema visual do Agent (black default / white) — persistido em localStorage,
// mesmo padrão de persistence.js.
//
// O tema também é um escopo de PERFIL (ver lib/profiles_bootstrap.js): cada
// perfil de configuração carrega o próprio tema. O escopo em si é registrado
// no Home.svelte, que é quem tem a variável reativa do tema para repintar a
// UI — aqui só avisamos o perfil ativo quando o tema muda.
import { touchActiveProfile } from "./lib/profiles_bootstrap.js";

export const THEME_KEY = "think:theme";
const LEGACY_THEME_KEY = "aurora:" + "theme";
export const GENERATED_THEME_ID_KEY = "thinkiac:theme-id";
export const GENERATED_THEME_CSS_KEY = "thinkiac:theme-css";
const KEY = THEME_KEY;
const SCROLLBAR_STYLE_ID = "thinkiac-theme-scrollbar";
const SCROLLBAR_CSS = `
html[data-thinkiac-theme-mode="dark"] {
    color-scheme: dark;
    --thinkiac-scrollbar-thumb: rgba(245, 245, 245, .14);
    --thinkiac-scrollbar-thumb-hover: rgba(245, 245, 245, .30);
}
html[data-thinkiac-theme-mode="light"] {
    color-scheme: light;
    --thinkiac-scrollbar-thumb: rgba(26, 26, 26, .14);
    --thinkiac-scrollbar-thumb-hover: rgba(26, 26, 26, .30);
}
html, body, * {
    scrollbar-width: thin;
    scrollbar-color: var(--thinkiac-scrollbar-thumb) transparent !important;
}
::-webkit-scrollbar { width: 6px !important; height: 6px !important; }
::-webkit-scrollbar-track { background: transparent; }
::-webkit-scrollbar-thumb {
    background: var(--thinkiac-scrollbar-thumb) !important;
    border-radius: 999px;
}
::-webkit-scrollbar-thumb:hover { background: var(--thinkiac-scrollbar-thumb-hover) !important; }
`;

function readTheme() {
    try {
        const saved = localStorage.getItem(KEY);
        if (saved === "light" || saved === "dark") return saved;
        const legacy = localStorage.getItem(LEGACY_THEME_KEY);
        if (legacy === "light" || legacy === "dark") return legacy;
    } catch (e) {
        console.warn("❌ Failed to read Shell theme:", e);
    }
    return "dark";
}

export function applyThemeScrollbarToDocument(targetDocument, theme = readTheme()) {
    if (!targetDocument?.documentElement) return false;
    const next = theme === "light" ? "light" : "dark";
    targetDocument.documentElement.dataset.thinkiacThemeMode = next;
    targetDocument.documentElement.dataset.theme = next;
    let style = targetDocument.getElementById(SCROLLBAR_STYLE_ID);
    if (!style) {
        style = targetDocument.createElement("style");
        style.id = SCROLLBAR_STYLE_ID;
    }
    style.textContent = SCROLLBAR_CSS;
    targetDocument.head.appendChild(style);
    return true;
}

export function applyGeneratedThemeToDocument(targetDocument, id, css) {
    if (!targetDocument || !id || !css) return false;
    targetDocument.documentElement.dataset.thinkiacTheme = id;
    let style = targetDocument.getElementById("thinkiac-generated-theme");
    if (!style) {
        style = targetDocument.createElement("style");
        style.id = "thinkiac-generated-theme";
        targetDocument.head.appendChild(style);
    }
    style.textContent = css;
    return true;
}

function readGeneratedTheme() {
    try {
        const id = localStorage.getItem(GENERATED_THEME_ID_KEY);
        const css = localStorage.getItem(GENERATED_THEME_CSS_KEY);
        return id && css ? { id, css } : null;
    } catch (e) {
        console.warn("Failed to read generated theme:", e);
        return null;
    }
}

export function applyGeneratedTheme(targetDocument = typeof document !== "undefined" ? document : null) {
    const generated = readGeneratedTheme();
    if (!generated || !targetDocument) return false;
    try {
        return applyGeneratedThemeToDocument(targetDocument, generated.id, generated.css);
    } catch (e) {
        console.warn("Failed to apply generated theme:", e);
        return false;
    }
}

export function applyThemeToDocument(targetDocument = typeof document !== "undefined" ? document : null) {
    if (!targetDocument) return false;
    const scrollbarApplied = applyThemeScrollbarToDocument(targetDocument);
    const generated = readGeneratedTheme();
    const generatedApplied = generated
        ? applyGeneratedThemeToDocument(targetDocument, generated.id, generated.css)
        : false;
    return scrollbarApplied || generatedApplied;
}

export function applyGeneratedThemeToFrames(rootDocument = typeof document !== "undefined" ? document : null) {
    if (!rootDocument) return;
    applyThemeToDocument(rootDocument);
    for (const frame of rootDocument.querySelectorAll?.("iframe") || []) {
        try {
            if (frame.contentDocument) applyThemeToDocument(frame.contentDocument);
        } catch {
            // Iframes externos não permitem acesso ao documento; apenas os apps
            // same-origin fazem parte do contrato global de temas.
        }
    }
}

export function getTheme() {
    applyThemeToDocument();
    return readTheme();
}

export function setTheme(theme) {
    const next = theme === "light" ? "light" : "dark";
    try {
        localStorage.setItem(KEY, next);
    } catch (e) {
        console.warn("❌ Failed to save Agent theme:", e);
    }
    touchActiveProfile();
    applyGeneratedThemeToFrames();
    if (typeof window !== "undefined") {
        window.dispatchEvent(new CustomEvent("think:theme-changed", { detail: next }));
    }
}

if (typeof window !== "undefined") {
    window.addEventListener("think:theme-changed", () => applyGeneratedThemeToFrames());
    window.addEventListener("message", (event) => {
        if (event.data?.source === "thinkiac:tema" && event.data?.type === "theme:change") {
            applyGeneratedThemeToFrames();
        }
    });
    window.addEventListener("storage", (event) => {
        if (event.key === GENERATED_THEME_ID_KEY || event.key === GENERATED_THEME_CSS_KEY) applyGeneratedThemeToFrames();
    });
}
