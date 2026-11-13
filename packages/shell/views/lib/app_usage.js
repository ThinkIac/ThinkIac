// app_usage.js — telemetria LOCAL de uso dos apps, pra o auto-sort do grid
// (Sidebar/menu mobile). Guarda por app: quantas vezes foi aberto e quando
// foi a última. O "score" é frequência com decaimento por recência — apps
// muito usados e/ou usados há pouco sobem; apps esquecidos afundam. Local ao
// dispositivo (localStorage), mesma ressalva de pinned/pastas.
import { writable, derived } from "svelte/store";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:app-usage";
const LEGACY_STORAGE_KEY = "aurora:app-usage";

// Meia-vida do decaimento de recência: depois de ~14 dias sem abrir, o peso
// de recência de um app cai pela metade. Frequência bruta continua contando.
const HALF_LIFE_MS = 14 * 24 * 60 * 60 * 1000;

function loadUsage() {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, [LEGACY_STORAGE_KEY]);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || typeof parsed !== "object") return {};
        // { [appId]: { count:number, last:number } }
        const out = {};
        for (const [id, v] of Object.entries(parsed)) {
            if (v && typeof v.count === "number") {
                out[id] = { count: v.count, last: typeof v.last === "number" ? v.last : 0 };
            }
        }
        return out;
    } catch (e) {
        console.warn("[app-usage] falha ao ler config:", e);
        return {};
    }
}

function saveUsage(map) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(map));
    } catch (e) {
        console.warn("[app-usage] falha ao salvar config:", e);
    }
}

export const usage = writable(loadUsage());
usage.subscribe(saveUsage);

/** Registra a abertura de um app (chamado no on:open do grid). */
export function recordOpen(appId) {
    if (!appId) return;
    const now = Date.now();
    usage.update((map) => {
        const prev = map[appId] || { count: 0, last: 0 };
        return { ...map, [appId]: { count: prev.count + 1, last: now } };
    });
}

/** Score de um app: frequência ponderada pela recência (0 = nunca usado). */
export function scoreFor(entry, now = Date.now()) {
    if (!entry || !entry.count) return 0;
    const age = Math.max(0, now - (entry.last || 0));
    const recency = Math.pow(0.5, age / HALF_LIFE_MS); // 1 → 0 conforme envelhece
    // Frequência dá a base; recência é um multiplicador suave (0.25..1.25) pra
    // um app aberto agora não afundar sob outro aberto 100x há meses.
    return entry.count * (0.25 + recency);
}

/** Store derivado: Map appId -> score, recalculado quando o uso muda. */
export const usageScores = derived(usage, ($usage) => {
    const now = Date.now();
    const map = new Map();
    for (const [id, entry] of Object.entries($usage)) {
        map.set(id, scoreFor(entry, now));
    }
    return map;
});
