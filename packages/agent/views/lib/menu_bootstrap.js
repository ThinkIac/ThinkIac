




























import { writable, derived, get } from "svelte/store";
import { api } from "../api.js";
import { registerProfileScope, touchActiveProfile } from "./profiles_bootstrap.js";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:menu-config";
const ACCORDION_STATE_KEY = "agent:menu-accordion-open";




const BUILTIN_ITEMS = [
    { id: "windows", label: "Workstation", kind: "builtin", defaultTarget: "left" },
    { id: "sessions", label: "Sessions", kind: "builtin", defaultTarget: "right" },
    { id: "apps", label: "Packages", kind: "builtin", defaultTarget: "right" },
    { id: "chat-sessions", label: "Conversations", kind: "builtin", defaultTarget: "left" },
];




export const MENU_DEFAULTS = Object.freeze({
    order: ["chat-sessions", "apps", "windows", "sessions"],
    mobileOrderLeft: ["chat-sessions", "windows"],
    mobileOrderRight: ["apps", "sessions"],
});

const DEFAULT_VISIBLE_ITEM_IDS = new Set([
    "windows",
    "sessions",
    "apps",
    "chat-sessions",
]);

function emptyOverrides() {
    return {
        order: [...MENU_DEFAULTS.order],
        mobileOrderLeft: [...MENU_DEFAULTS.mobileOrderLeft],
        mobileOrderRight: [...MENU_DEFAULTS.mobileOrderRight],
        hidden: [],
        targets: {},
        labels: {},
        accordion: false,
        seen: [],
    };
}

function loadOverrides() {
    if (typeof localStorage === "undefined") return emptyOverrides();
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, ["aurora:menu-config"]);
        
        
        
        if (!raw) return emptyOverrides();
        const parsed = JSON.parse(raw);
        const arr = (v) => (Array.isArray(v) ? v : []);
        return {
            order: arr(parsed.order),
            mobileOrderLeft: arr(parsed.mobileOrderLeft),
            mobileOrderRight: arr(parsed.mobileOrderRight),
            hidden: arr(parsed.hidden),
            targets: parsed.targets && typeof parsed.targets === "object" ? parsed.targets : {},
            labels: parsed.labels && typeof parsed.labels === "object" ? parsed.labels : {},
            accordion: !!parsed.accordion,
            seen: arr(parsed.seen),
        };
    } catch (e) {
        console.warn("[menu] falha ao ler config:", e);
        return emptyOverrides();
    }
}

function saveOverrides(overrides) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) {
        console.warn("[menu] falha ao salvar config:", e);
    }
    
    
    touchActiveProfile();
}

function loadAccordionState() {
    if (typeof localStorage === "undefined") return {};
    try {
        const raw = readMigratedStorage(localStorage, ACCORDION_STATE_KEY, ["aurora:menu-accordion-open"]);
        return raw ? JSON.parse(raw) : {};
    } catch (e) {
        console.warn("[menu] falha ao ler estado da sanfona:", e);
        return {};
    }
}

function saveAccordionState(state) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(ACCORDION_STATE_KEY, JSON.stringify(state));
    } catch (e) {
        console.warn("[menu] falha ao salvar estado da sanfona:", e);
    }
}

const overridesStore = writable(loadOverrides());
const externalItemsStore = writable([]);

/**
 * O SideMenu hospeda painéis compactos, não a página principal de um pacote.
 * Ausência de `view` mantém o comportamento do catálogo do Runtime, que resolve
 * a contribuição para Index/Home, portanto também não é elegível aqui.
 */
export function isDedicatedMenuView(menu) {
    if (!menu?.view || typeof menu.view !== "string") return false;
    const view = menu.view.trim().toLowerCase();
    return view !== "index" && view !== "home";
}






registerProfileScope({
    key: STORAGE_KEY,
    hydrate() {
        overridesStore.set(loadOverrides());
        reconcileKnownItems(
            new Map([...BUILTIN_ITEMS, ...get(externalItemsStore)].map((it) => [it.id, it])),
        );
    },
});

/**
 * Reconcilia itens de `known` nunca vistos antes: decide visível ou oculto
 * (defaultHidden) UMA vez só, gravando o id em `seen` — sem isso, reativar
 * um item com defaultHidden:true faria ele voltar a ficar oculto no próximo
 * recálculo (visibilidade seria recomputada a partir de defaultHidden toda
 * vez, em vez de a partir da escolha do usuário).
 */
function reconcileKnownItems(known) {
    const ov = get(overridesStore);
    const seenSet = new Set(ov.seen);
    const newIds = [...known.keys()].filter((id) => !seenSet.has(id));
    if (newIds.length === 0) return;

    const newHidden = newIds.filter((id) => known.get(id).defaultHidden);
    const next = {
        ...ov,
        seen: [...ov.seen, ...newIds],
        hidden: [...ov.hidden, ...newHidden],
    };
    saveOverrides(next);
    overridesStore.set(next);
}

reconcileKnownItems(new Map(BUILTIN_ITEMS.map((it) => [it.id, it])));

/** Busca /apps/list e descobre itens de menu contribuídos por pacotes (app.menu). */
export async function bootstrapMenuItems() {
    let apps;
    try {
        apps = await api("/apps/list", "GET", null, "aura-system");
    } catch (e) {
        console.error("[menu] falha ao listar apps:", e);
        return;
    }
    if (!Array.isArray(apps)) return;

    const items = [];
    for (const app of apps) {
        const m = app?.menu;
        if (!m?.id || !isDedicatedMenuView(m)) continue;
        items.push({
            id: `pkg:${m.id}`,
            label: m.label || app.name || m.id,
            
            
            
            
            
            
            ...(m.icon
                ? { icon: m.icon, iconDark: m.iconDark || null }
                : {
                      icon: app.icon || null,
                      iconSvg: app.iconSvg || null,
                      iconDark: app.iconDark || null,
                      iconDarkSvg: app.iconDarkSvg || null,
                  }),
            kind: "package",
            defaultTarget: m.target === "right" ? "right" : "left",
            order: Number.isFinite(Number(m.order)) ? Number(m.order) : 1000,
            
            
            defaultHidden: m.hidden !== false,
            
            
            
            url: app.url,
            
            
            
            
            editable: !!m.edit,
        });
    }
    externalItemsStore.set(items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)));
    reconcileKnownItems(new Map([...BUILTIN_ITEMS, ...items].map((it) => [it.id, it])));
}




export const menuItems = derived(
    [overridesStore, externalItemsStore],
    ([$ov, $external]) => {
        const known = new Map([...BUILTIN_ITEMS, ...$external].map((it) => [it.id, it]));
        const hiddenSet = new Set($ov.hidden.filter((id) => known.has(id)));
        const targets = $ov.targets || {};
        const labels = $ov.labels || {};

        return [...known.entries()].map(([id, base]) => {
            const customLabel = labels[id];
            return {
                ...base,
                target: targets[id] || base.defaultTarget,
                label: customLabel && customLabel.trim() ? customLabel.trim() : base.label,
                visible: !hiddenSet.has(id),
            };
        });
    },
);




function applyOrder(orderArr, eligibleItems) {
    const byId = new Map(eligibleItems.map((it) => [it.id, it]));
    const placed = orderArr.filter((id) => byId.has(id));
    const placedSet = new Set(placed);
    const rest = eligibleItems.filter((it) => !placedSet.has(it.id)).map((it) => it.id);
    return [...placed, ...rest].map((id) => byId.get(id));
}

export const leftPanelItems = derived([menuItems, overridesStore], ([$items, $ov]) =>
    applyOrder($ov.mobileOrderLeft, $items.filter((i) => i.visible && i.target === "left")),
);
export const rightPanelItems = derived([menuItems, overridesStore], ([$items, $ov]) =>
    applyOrder($ov.mobileOrderRight, $items.filter((i) => i.visible && i.target === "right")),
);

export const desktopMenuItems = derived([menuItems, overridesStore], ([$items, $ov]) =>
    applyOrder($ov.order, $items.filter((i) => i.visible)),
);

/** Mostra/oculta um item. Não mexe em nenhuma ordem — ao reativar, o item
 * volta a aparecer no fim de cada contexto que ainda não tinha ordenado ele
 * explicitamente (ver applyOrder). */
export function setItemVisible(id, visible) {
    overridesStore.update((ov) => {
        let hidden = ov.hidden.filter((x) => x !== id);
        if (!visible) hidden = [...hidden, id];
        const next = { ...ov, hidden };
        saveOverrides(next);
        return next;
    });
}

export function setItemTarget(id, target) {
    overridesStore.update((ov) => {
        const next = { ...ov, targets: { ...ov.targets, [id]: target } };
        saveOverrides(next);
        return next;
    });
}

export function setItemLabel(id, label) {
    overridesStore.update((ov) => {
        const next = { ...ov, labels: { ...ov.labels, [id]: label } };
        saveOverrides(next);
        return next;
    });
}

/**
 * Persiste a nova ordem de um contexto específico.
 * @param {"desktop"|"left"|"right"} context
 * @param {string[]} orderedIds
 */
export function reorderMenuItems(context, orderedIds) {
    const key = context === "desktop" ? "order" : context === "left" ? "mobileOrderLeft" : "mobileOrderRight";
    overridesStore.update((ov) => {
        const next = { ...ov, [key]: orderedIds };
        saveOverrides(next);
        return next;
    });
}

export function resetMenuConfig() {
    const empty = emptyOverrides();
    saveOverrides(empty);
    overridesStore.set(empty);
    reconcileKnownItems(new Map([...BUILTIN_ITEMS, ...get(externalItemsStore)].map((it) => [it.id, it])));
}


export const accordionMode = derived(overridesStore, ($ov) => !!$ov.accordion);

export function setAccordionMode(enabled) {
    overridesStore.update((ov) => {
        const next = { ...ov, accordion: !!enabled };
        saveOverrides(next);
        return next;
    });
}



export const accordionOpenMap = writable(loadAccordionState());

export function toggleAccordionOpen(id) {
    accordionOpenMap.update((m) => {
        const next = { ...m, [id]: !m[id] };
        saveAccordionState(next);
        return next;
    });
}






export const menuEditMode = writable(false);

export function setMenuEditMode(on) {
    menuEditMode.set(!!on);
}
export function toggleMenuEditMode() {
    menuEditMode.update((v) => !v);
}

/**
 * Ativa um item que estava desativado, colocando-o num contexto específico.
 * Usado quando o usuário arrasta um item da faixa "Desativados" (topo) para a
 * lista ativa, ou toca no toggle de um item desativado. No mobile também fixa
 * o painel de destino; no desktop `target` é ignorado (coluna única).
 * @param {string} id
 * @param {"desktop"|"left"|"right"} context
 */
export function activateItem(id, context) {
    overridesStore.update((ov) => {
        const hidden = ov.hidden.filter((x) => x !== id);
        const targets = { ...ov.targets };
        if (context === "left" || context === "right") targets[id] = context;
        const next = { ...ov, hidden, targets };
        saveOverrides(next);
        return next;
    });
}
