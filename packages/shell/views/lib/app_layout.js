// app_layout.js — preferências de exibição do grid de Apps (launcher/menu
// mobile): qual dos 3 layouts e o modo de ordenação. Local ao dispositivo.
import { writable } from "svelte/store";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:app-layout";
const LEGACY_STORAGE_KEY = "aurora:app-layout";

// Os 3 layouts pedidos: grade padrão, grade compacta (mais colunas/ícones
// menores) e lista (uma linha por app, ícone + nome à esquerda).
export const LAYOUTS = ["grid", "compact", "list"];
export const DEFAULT_APP_LAYOUT = { layout: "grid", sort: "manual" };
// Ordenação: "manual" respeita a ordem do usuário (drag&drop); "auto" reordena
// por score de uso (ver app_usage.js), do mais usado pro menos usado.
export const SORT_MODES = ["manual", "auto"];

export function normalizeAppLayout(value) {
    const layout = LAYOUTS.includes(value?.layout) ? value.layout : DEFAULT_APP_LAYOUT.layout;
    const sort = SORT_MODES.includes(value?.sort) ? value.sort : DEFAULT_APP_LAYOUT.sort;
    return { layout, sort };
}

function load() {
    if (typeof localStorage === "undefined") return { ...DEFAULT_APP_LAYOUT };
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, [LEGACY_STORAGE_KEY]);
        const parsed = raw ? JSON.parse(raw) : null;
        return normalizeAppLayout(parsed);
    } catch {
        return { ...DEFAULT_APP_LAYOUT };
    }
}

function persist(v) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(v));
    } catch (e) {
        console.warn("[app-layout] falha ao salvar:", e);
    }
}

export const appLayout = writable(load());
appLayout.subscribe(persist);

/** Cicla entre os 3 layouts (grid → compact → list → grid). */
export function cycleLayout() {
    appLayout.update((v) => {
        const i = LAYOUTS.indexOf(v.layout);
        return { ...v, layout: LAYOUTS[(i + 1) % LAYOUTS.length] };
    });
}

export function setSortMode(mode) {
    if (!SORT_MODES.includes(mode)) return;
    appLayout.update((v) => ({ ...v, sort: mode }));
}
