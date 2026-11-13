




import { writable, derived } from "svelte/store";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:app-folders";
const ORDER_KEY = "agent:app-loose-order";

function uid() {
    return `f_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function loadFolders() {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, ["aurora:app-folders"]);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.folders)) return [];
        return parsed.folders
            .filter((f) => f && typeof f.id === "string" && typeof f.name === "string")
            .map((f) => ({ id: f.id, name: f.name, appIds: Array.isArray(f.appIds) ? f.appIds : [] }));
    } catch (e) {
        console.warn("[app-folders] falha ao ler config:", e);
        return [];
    }
}

function saveFolders(list) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({ folders: list }));
    } catch (e) {
        console.warn("[app-folders] falha ao salvar config:", e);
    }
}

export const folders = writable(loadFolders());
folders.subscribe(saveFolders);

/** Cria uma pasta e retorna o id (ou null se o nome vier vazio). */
export function createFolder(name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return null;
    const id = uid();
    folders.update((list) => [...list, { id, name: trimmed, appIds: [] }]);
    return id;
}

/**
 * Cria uma pasta já contendo `appIds` (usado pelo drag&drop: soltar um app
 * sobre outro cria uma pasta com os dois). Nome pode vir vazio — usamos um
 * rótulo padrão, editável depois. Retorna o id.
 */
export function createFolderWith(name, appIds = []) {
    const id = uid();
    const clean = [...new Set(appIds.filter(Boolean))];
    const label = (name || "").trim() || "Nova pasta";
    folders.update((list) => {
        
        const cleared = list.map((f) => ({
            ...f,
            appIds: f.appIds.filter((aid) => !clean.includes(aid)),
        }));
        return [...cleared, { id, name: label, appIds: clean }];
    });
    return id;
}

export function renameFolder(id, name) {
    const trimmed = (name || "").trim();
    if (!trimmed) return;
    folders.update((list) => list.map((f) => (f.id === id ? { ...f, name: trimmed } : f)));
}

/** Apaga a pasta — os apps dela voltam pra "Sem pasta" (não são apagados). */
export function deleteFolder(id) {
    folders.update((list) => list.filter((f) => f.id !== id));
}

export function reorderFolders(orderedIds) {
    folders.update((list) => {
        const byId = new Map(list.map((f) => [f.id, f]));
        const placed = orderedIds.filter((id) => byId.has(id)).map((id) => byId.get(id));
        const placedSet = new Set(orderedIds);
        const rest = list.filter((f) => !placedSet.has(f.id));
        return [...placed, ...rest];
    });
}

/** Move um app pra dentro de uma pasta, tirando de qualquer outra que já estivesse. */
export function assignAppToFolder(appId, folderId) {
    folders.update((list) =>
        list.map((f) => {
            if (f.id === folderId) {
                return f.appIds.includes(appId) ? f : { ...f, appIds: [...f.appIds, appId] };
            }
            return f.appIds.includes(appId) ? { ...f, appIds: f.appIds.filter((id) => id !== appId) } : f;
        }),
    );
}

/** Tira o app de qualquer pasta (volta pra "Sem pasta"). */
export function unassignApp(appId) {
    folders.update((list) =>
        list.map((f) => (f.appIds.includes(appId) ? { ...f, appIds: f.appIds.filter((id) => id !== appId) } : f)),
    );
}

/** Reordena os apps DENTRO de uma pasta (drag&drop no modal da pasta). */
export function reorderFolderApps(folderId, orderedIds) {
    folders.update((list) =>
        list.map((f) => {
            if (f.id !== folderId) return f;
            const set = new Set(f.appIds);
            const placed = orderedIds.filter((id) => set.has(id));
            const rest = f.appIds.filter((id) => !orderedIds.includes(id));
            return { ...f, appIds: [...placed, ...rest] };
        }),
    );
}

/** Map appId -> folderId, pra lookup O(1) no grid. */
export const folderIdByApp = derived(folders, ($folders) => {
    const map = new Map();
    for (const f of $folders) {
        for (const appId of f.appIds) map.set(appId, f.id);
    }
    return map;
});




function loadOrder() {
    if (typeof localStorage === "undefined") return [];
    try {
        const raw = readMigratedStorage(localStorage, ORDER_KEY, ["aurora:app-loose-order"]);
        const parsed = raw ? JSON.parse(raw) : null;
        return Array.isArray(parsed) ? parsed.filter((x) => typeof x === "string") : [];
    } catch {
        return [];
    }
}

export const looseOrder = writable(loadOrder());
looseOrder.subscribe((v) => {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(ORDER_KEY, JSON.stringify(v));
    } catch (e) {
        console.warn("[app-folders] falha ao salvar ordem:", e);
    }
});

/** Grava a ordem manual completa dos apps soltos. */
export function setLooseOrder(orderedIds) {
    looseOrder.set([...new Set(orderedIds.filter(Boolean))]);
}

/**
 * Aplica a ordem manual sobre uma lista de apps, mantendo os não-ordenados
 * (novos) no fim na ordem em que vieram. `order` é o array de ids salvos.
 */
export function applyLooseOrder(apps, order) {
    if (!order || !order.length) return apps;
    const rank = new Map(order.map((id, i) => [id, i]));
    return [...apps].sort((a, b) => {
        const ra = rank.has(a.id) ? rank.get(a.id) : Infinity;
        const rb = rank.has(b.id) ? rank.get(b.id) : Infinity;
        if (ra !== rb) return ra - rb;
        return 0; 
    });
}
