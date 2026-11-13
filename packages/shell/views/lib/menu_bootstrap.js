// menu_bootstrap.js — registry configurável dos itens de menu do Sidebar/
// painéis mobile. Combina:
//   1. Itens nativos (Dock, Sessions, Apps) — sempre existem.
//   2. Itens contribuídos por PACOTES via manifest:
//        "manifest": { "menu": { "id": "meu-pkg", "label": "Meu Pkg", "icon": "..." } }
//      O /apps/list (shell) expõe isso em `app.menu` (mesmo padrão já
//      usado para `app.widget`, ver widget_bootstrap.js) — aqui descobrimos
//      esses itens no boot.
//   3. Overrides do usuário persistidos em localStorage (mesmo padrão de
//      theme.js):
//        order            — ordem no desktop (coluna única)
//        mobileOrderLeft  — ordem no painel esquerdo do mobile
//        mobileOrderRight — ordem no painel direito do mobile
//      As três são INDEPENDENTES — reordenar no mobile não mexe no desktop
//      e vice-versa (cada contexto lembra da própria ordem).
//        hidden   — itens desativados (fora de qualquer ordem, à parte)
//        targets  — { id: "left"|"right" } painel de destino no mobile
//        labels   — { id: "nome customizado" }
//        accordion — bool, modo sanfona ligado/desligado
//        seen     — ids que já passaram pela reconciliação inicial (ver
//                   reconcileKnownItems) — evita que um item com
//                   defaultHidden volte a ficar oculto depois que o usuário
//                   já reativou ele uma vez.
//   4. Estado de aberto/fechado de cada item no modo sanfona, persistido
//      separadamente (é estado de UI, não de configuração).
//
// Consumido por Sidebar.svelte (desktop + os 2 painéis mobile: left/right)
// via MenuList.svelte, que também hospeda o modo de edição inline (o antigo
// modal MenuEditor foi removido na Reforma na Configuração dos Menus).
import { writable, derived, get } from "svelte/store";
import { api } from "../api.js";
import { registerProfileScope, touchActiveProfile } from "./profiles_bootstrap.js";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:menu-config";
const ACCORDION_STATE_KEY = "agent:menu-accordion-open";
const MENU_APPS_CACHE_KEY = "shell:menu-apps-cache:v1";

// target: em qual dos 2 "menus" mobile o item aparece — "left" (painel de
// Workstation/Conversations) ou "right" (painel Sigma). No desktop os dois painéis
// viram uma única coluna, então target não é usado ali, só a ordem.
const BUILTIN_ITEMS = [
    { id: "windows", label: "Workstation", kind: "builtin", defaultTarget: "left" },
    { id: "sessions", label: "Sessions", kind: "builtin", defaultTarget: "right" },
    { id: "apps", label: "Packages", kind: "builtin", defaultTarget: "right" },
    { id: "chat-sessions", label: "Conversations", kind: "builtin", defaultTarget: "left" },
];

// Defaults aplicados somente quando o perfil não tem configuração de menu.
// Perfis existentes continuam usando as ordens, alvos, visibilidade e nomes
// personalizados já persistidos em localStorage.
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
        accordion: true,
        seen: [],
    };
}

function loadOverrides() {
    if (typeof localStorage === "undefined") return emptyOverrides();
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, ["aurora:menu-config"]);
        // Ausência de configuração significa perfil novo/em branco: use o
        // layout padrão. Uma configuração já persistida continua sendo lida
        // campo a campo para preservar as escolhas que ela contém.
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
            accordion: typeof parsed.accordion === "boolean" ? parsed.accordion : true,
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
    // Mantém o perfil ativo em dia com o que acabou de mudar na tela
    // (ver profiles_bootstrap: o perfil ativo espelha as chaves vivas).
    touchActiveProfile();
}

function loadAccordionState() {
    const defaults = Object.fromEntries(BUILTIN_ITEMS.map(({ id }) => [id, true]));
    if (typeof localStorage === "undefined") return defaults;
    try {
        const raw = readMigratedStorage(localStorage, ACCORDION_STATE_KEY, ["aurora:menu-accordion-open"]);
        const parsed = raw ? JSON.parse(raw) : {};
        return { ...defaults, ...(parsed && typeof parsed === "object" ? parsed : {}) };
    } catch (e) {
        console.warn("[menu] falha ao ler estado da sanfona:", e);
        return defaults;
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

function readCachedMenuApps() {
    if (typeof localStorage === "undefined") return null;
    try {
        const cached = JSON.parse(localStorage.getItem(MENU_APPS_CACHE_KEY) || "null");
        return Array.isArray(cached) ? cached : null;
    } catch {
        return null;
    }
}

function saveCachedMenuApps(apps) {
    if (typeof localStorage === "undefined") return;
    try { localStorage.setItem(MENU_APPS_CACHE_KEY, JSON.stringify(apps)); } catch {}
}

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

// Este é um escopo de PERFIL: trocar de perfil reescreve STORAGE_KEY e chama
// o hydrate abaixo, que relê a chave para dentro do store (e reconcilia itens
// que o perfil de destino nunca tinha visto). Registrado antes da primeira
// reconciliação para que a chave do menu já entre no perfil "Default" criado
// na migração.
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
    // Disponibiliza imediatamente a última descoberta válida. A consulta em
    // rede continua sendo a fonte de verdade e substitui este cache ao chegar.
    const cachedApps = readCachedMenuApps();
    if (cachedApps) applyMenuApps(cachedApps);

    let apps;
    try {
        apps = await api("/apps/list", "GET", null, "shell");
    } catch (e) {
        console.error("[menu] falha ao listar apps:", e);
        return;
    }
    if (!Array.isArray(apps)) return;
    saveCachedMenuApps(apps);
    applyMenuApps(apps);
}

function applyMenuApps(apps) {
    const items = [];
    for (const app of apps) {
        const m = app?.menu;
        if (!m?.id || !isDedicatedMenuView(m)) continue;
        items.push({
            id: `pkg:${m.id}`,
            label: m.label || app.name || m.id,
            // Ícone real do pacote (raster ou svg inline). As variantes dark
            // vêm do `manifest.iconDark` e são resolvidas no registro de apps
            // (shell/runtime/system/apps/index.js); quem renderiza escolhe pelo tema.
            // Se o item de menu declara ícone próprio (`manifest.menu.icon`),
            // ele manda — e só a variante dark DELE vale, senão o ícone do
            // pacote apareceria no tema escuro contradizendo o do menu.
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
            // Cada pacote declara sua visibilidade inicial; depois da primeira
            // reconciliação, a preferência persistida do usuário prevalece.
            defaultHidden: m.hidden !== false,
            // O backend anexa o manifest apenas à view pedida em `m.view`.
            // Portanto `app.url` já é a rota exata, sem reconstruir URL a
            // partir do rótulo exibido da app.
            url: app.url,
            // Widget de Edição do Widget: se o pacote declara `manifest.menu.edit`,
            // a MESMA view sabe se auto-configurar quando recebe `mode=edit` no
            // hash (ver PackageWidget `edit`). No modo edição do menu, o item
            // ganha um chevron que revela esse painel de configuração inline.
            editable: !!m.edit,
        });
    }
    externalItemsStore.set(items.sort((a, b) => a.order - b.order || a.label.localeCompare(b.label)));
    reconcileKnownItems(new Map([...BUILTIN_ITEMS, ...items].map((it) => [it.id, it])));
}

// Metadados de todos os itens conhecidos (builtin + pacotes), com
// visível/target/label resolvidos — SEM aplicar ordem ainda (isso é feito
// por contexto abaixo: desktop/left/right têm ordens independentes).
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

// Aplica uma ordem salva (array de ids) sobre uma lista de itens elegíveis:
// itens já ordenados antes mantêm a posição relativa; itens novos (nunca
// ordenados nesse contexto) entram no fim, na ordem em que apareceram.
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
// Desktop: uma única coluna, ambos os alvos juntos, com ordem própria.
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

// ── Modo sanfona: cada widget vira um item colapsável ──────────────────────
export const accordionMode = derived(overridesStore, ($ov) => !!$ov.accordion);

export function setAccordionMode(enabled) {
    overridesStore.update((ov) => {
        const next = { ...ov, accordion: !!enabled };
        saveOverrides(next);
        return next;
    });
}

// Estado aberto/fechado por item (só relevante com accordionMode ligado).
// Persistido à parte por ser estado de UI, não de configuração do menu.
export const accordionOpenMap = writable(loadAccordionState());

export function toggleAccordionOpen(id) {
    accordionOpenMap.update((m) => {
        const next = { ...m, [id]: !m[id] };
        saveAccordionState(next);
        return next;
    });
}

// ── Modo edição do menu (transiente, NÃO persistido) ───────────────────────
// A "Reforma na Configuração dos Menus" trocou o modal MenuEditor por um modo
// de edição inline: o gear alterna este flag e o próprio Sidebar/painéis viram
// sanfonas arrastáveis com on/off, desativados destacados no topo e o botão de
// tema só aparecendo aqui. "Salvar" volta ao modo visualização (desliga isto).
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
