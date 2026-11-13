// inputbar_bootstrap.js — registry das entradas da InputBar, no mesmo espírito
// de menu_bootstrap.js (Sidebar) e widget_bootstrap.js (blocos de markdown).
//
// ── As duas naturezas ──────────────────────────────────────────────────
//
// Tudo que aparece na InputBar é uma de duas coisas, e a diferença não é
// estética — muda onde fica, o que mostra e quanto dura:
//
//   kind: "action"  verbo. Faz algo AGORA (anexar, gravar voz, abrir uma
//                   view). Mostra só o ícone. Vive à ESQUERDA da barra:
//                   os primeiros ficam em destaque, o resto cai na caixa.
//
//   kind: "state"   adjetivo. Modifica COMO a próxima mensagem vai ser
//                   processada (modelo, modo de aprovação). Precisa
//                   mostrar rótulo + valor atual, e persiste na sessão.
//                   Vive numa caixa única colada ao botão de enviar.
//
// Um pacote declara no package.json:
//
//   "manifest": {
//     "inputbar": {
//       "id": "governanca",
//       "kind": "state",      // "action" (padrão) | "state"
//       "label": "Governança",
//       "hint": "Modo de aprovação da sessão",
//       "view": true,         // abre a view do pacote numa caixa própria
//       "hidden": false       // nasce desativada (só na primeira descoberta)
//     }
//   }
//
// O ícone é o do próprio pacote (o mesmo da grade de Apps). Sem ícone, a
// barra desenha um monograma a partir do label — o DESIGN.md proíbe emoji na
// UI, então `manifest.inputbar.icon` NÃO é lido como glifo.
//
// O /apps/list (shell) já expõe o manifest inteiro; aqui filtramos o
// campo `inputbar`.
//
// As ferramentas nativas (anexar, voz e modelo) entram no MESMO
// registry, como entradas `native:*`. É isso que permite ocultá-las e
// reordená-las igual a qualquer contribuição de pacote — antes elas eram
// markup fixo, sem nenhuma configuração possível.
//
// Preferências do usuário (ocultas + ordem) ficam em localStorage, mesmo
// padrão do menu.
import { writable, derived, get } from "svelte/store";
import { api } from "../api.js";
import { registerProfileScope, touchActiveProfile } from "./profiles_bootstrap.js";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:inputbar-config";

// Teto padrão de ícones em destaque: três, mais o botão de "mais". É teto,
// não cota — se o usuário desativar ações, a barra mostra somente as ativas.
export const DEFAULT_MAX_PINNED = 3;

export const maxPinned = writable(DEFAULT_MAX_PINNED);

/**
 * Ferramentas nativas. Ficam no registry para serem configuráveis como
 * qualquer outra; o `native` diz à InputBar que o comportamento é local
 * (chama uma função do componente) em vez de abrir a view de um pacote.
 */
const NATIVE_ENTRIES = [
    {
        id: "native:attach",
        native: "attach",
        kind: "action",
        label: "Attach",
        hint: "File or image",
    },
    {
        id: "native:voice",
        native: "voice",
        kind: "action",
        label: "Voice",
        hint: "Dictate with the microphone",
    },
    {
        id: "native:location",
        native: "location",
        kind: "action",
        label: "Location",
        hint: "Share location once",
    },
    {
        id: "native:model",
        native: "model",
        kind: "state",
        label: "Model",
        hint: "Explicit model override for this session",
    },
    {
        id: "native:specialist",
        native: "specialist",
        kind: "state",
        label: "Specialist",
        hint: "Prompt, tools and model for this session",
    },
];

function emptyOverrides() {
    return { order: [], hidden: [], seen: [] };
}

function loadOverrides() {
    try {
        const raw = typeof localStorage !== "undefined"
            ? readMigratedStorage(localStorage, STORAGE_KEY, ["aurora:inputbar-config"])
            : null;
        const parsed = raw ? JSON.parse(raw) : {};
        const arr = (v) => (Array.isArray(v) ? v : []);
        return { order: arr(parsed.order), hidden: arr(parsed.hidden), seen: arr(parsed.seen) };
    } catch (e) {
        console.warn("[inputbar] falha ao ler config:", e);
        return emptyOverrides();
    }
}

function saveOverrides(overrides) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
    } catch (e) {
        console.warn("[inputbar] falha ao salvar config:", e);
    }
    // Espelha a mudança no perfil ativo (ver profiles_bootstrap).
    touchActiveProfile();
}

const overridesStore = writable(loadOverrides());
const entriesStore = writable([...NATIVE_ENTRIES]);

// Escopo de perfil: trocar de perfil reescreve STORAGE_KEY e re-hidrata daqui.
registerProfileScope({
    key: STORAGE_KEY,
    hydrate() {
        overridesStore.set(loadOverrides());
        reconcile(get(entriesStore));
    },
});

/**
 * Decide UMA vez se uma entrada nova nasce visível ou oculta (`hidden` do
 * manifest), gravando o id em `seen`. Sem isso, reativar uma entrada que o
 * pacote pede oculta por padrão seria desfeito no próximo boot.
 */
function reconcile(entries) {
    const ov = get(overridesStore);
    const seen = new Set(ov.seen);
    const novos = entries.filter((e) => !seen.has(e.id));
    if (!novos.length) return;
    const next = {
        ...ov,
        seen: [...ov.seen, ...novos.map((e) => e.id)],
        hidden: [...ov.hidden, ...novos.filter((e) => e.kind !== "state" && e.defaultHidden).map((e) => e.id)],
    };
    saveOverrides(next);
    overridesStore.set(next);
}

/** Descobre entradas de InputBar declaradas por pacotes (manifest.inputbar). */
export async function bootstrapInputBarEntries() {
    // Reidrata também quando o módulo veio do SSR.
    overridesStore.set(loadOverrides());
    let apps;
    try {
        apps = await api("/apps/list", "GET", null, "shell");
    } catch (e) {
        console.error("[inputbar] falha ao listar apps:", e);
        // As nativas continuam valendo — a barra não pode ficar sem anexo e
        // voz só porque a listagem de apps falhou.
        reconcile(get(entriesStore));
        return;
    }
    if (!Array.isArray(apps)) apps = [];

    const entries = [];
    for (const app of apps) {
        const cfg = app?.inputbar;
        if (!cfg?.id) continue;
        entries.push({
            id: `pkg:${cfg.id}`,
            kind: cfg.kind === "state" ? "state" : "action",
            label: cfg.label || app.name || cfg.id,
            // Ícone real do pacote (raster ou svg inline), nunca emoji.
            icon: app.icon || null,
            iconSvg: app.iconSvg || null,
            iconDark: app.iconDark || null,
            iconDarkSvg: app.iconDarkSvg || null,
            hint: cfg.hint || null,
            // Entrada com view abre a própria view do pacote num popover; sem
            // view, ela só emite um evento no bus (o pacote reage do lado dele).
            url: cfg.view === false ? null : app.url,
            event: cfg.event || null,
            command: cfg.command || null,
            defaultHidden: !!cfg.hidden,
            kindSource: "package",
        });
    }

    const todas = [...NATIVE_ENTRIES, ...entries];
    entriesStore.set(todas);
    reconcile(todas);
}

/** Aplica ocultas + ordem escolhida (novas entram no fim). */
function ordenar(entries, ov) {
    const hidden = new Set(ov.hidden);
    const visible = entries.filter((e) => !hidden.has(e.id));
    const byId = new Map(visible.map((e) => [e.id, e]));
    const placed = ov.order.filter((id) => byId.has(id));
    const placedSet = new Set(placed);
    const rest = visible.filter((e) => !placedSet.has(e.id)).map((e) => e.id);
    return [...placed, ...rest].map((id) => byId.get(id));
}

/** Ações visíveis, na ordem do usuário. */
export const actionEntries = derived(
    [entriesStore, overridesStore],
    ([$entries, $ov]) => ordenar($entries.filter((e) => e.kind !== "state"), $ov),
);

/** Controles de estado visíveis — a caixa única colada ao botão de enviar. */
export const stateEntries = derived(
    [entriesStore, overridesStore],
    ([$entries, $ov]) => ordenar($entries.filter((e) => e.kind === "state"), { ...$ov, hidden: [] }),
);

/** As primeiras ações, em destaque na barra. */
export const pinnedActions = derived(
    [actionEntries, maxPinned],
    ([$acoes, $max]) => $acoes.slice(0, Math.min(DEFAULT_MAX_PINNED, Math.max(0, Number.isFinite($max) ? $max : DEFAULT_MAX_PINNED))),
);

/** O resto das ações — vive dentro da caixa, não na barra. */
export const overflowActions = derived(
    [actionEntries, maxPinned],
    ([$acoes, $max]) => $acoes.slice(Math.min(DEFAULT_MAX_PINNED, Math.max(0, Number.isFinite($max) ? $max : DEFAULT_MAX_PINNED))),
);

/** Compat: a barra antiga iterava sobre isto. */
export const inputBarEntries = actionEntries;

/** Todas as entradas conhecidas, com visibilidade — para o editor. */
export const allInputBarEntries = derived(
    [entriesStore, overridesStore],
    ([$entries, $ov]) => {
        const hidden = new Set($ov.hidden);
        const ordem = new Map($ov.order.map((id, i) => [id, i]));
        return [...$entries]
            .sort((a, b) => (ordem.get(a.id) ?? Infinity) - (ordem.get(b.id) ?? Infinity))
            .map((e) => ({ ...e, visible: e.kind === "state" || !hidden.has(e.id) }));
    },
);

export function setEntryVisible(id, visible) {
    if (get(entriesStore).some((entry) => entry.id === id && entry.kind === "state")) return;
    overridesStore.update((ov) => {
        let hidden = ov.hidden.filter((x) => x !== id);
        if (!visible) hidden = [...hidden, id];
        const next = { ...ov, hidden };
        saveOverrides(next);
        return next;
    });
}

export function reorderEntries(orderedIds) {
    overridesStore.update((ov) => {
        const next = { ...ov, order: orderedIds };
        saveOverrides(next);
        return next;
    });
}

/**
 * Move uma entrada uma posição para cima/baixo DENTRO da própria natureza.
 * Ação e estado não se misturam na ordenação: são listas diferentes na tela,
 * e trocar um ícone de lugar com um controle de sessão não significaria nada.
 */
export function moveEntry(id, delta) {
    const todas = get(entriesStore);
    const alvo = todas.find((e) => e.id === id);
    if (!alvo) return;

    const mesmaNatureza = todas
        .filter((e) => (e.kind === "state") === (alvo.kind === "state"))
        .map((e) => e.id);

    const ov = get(overridesStore);
    const ordem = [
        ...ov.order.filter((x) => mesmaNatureza.includes(x)),
        ...mesmaNatureza.filter((x) => !ov.order.includes(x)),
    ];

    const i = ordem.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= ordem.length) return;
    [ordem[i], ordem[j]] = [ordem[j], ordem[i]];

    // Preserva a ordem da OUTRA natureza intacta.
    const outras = ov.order.filter((x) => !mesmaNatureza.includes(x));
    reorderEntries([...ordem, ...outras]);
}

/**
 * Reordena UMA das naturezas, preservando a ordem da outra intacta.
 *
 * É o que o arrasto usa. Ação e estado são listas separadas na tela — e no
 * `order` elas convivem no mesmo array, então gravar só a lista arrastada
 * apagaria a ordem da outra.
 */
export function reorderKind(isState, orderedIds) {
    const todas = get(entriesStore);
    const daNatureza = new Set(
        todas.filter((e) => (e.kind === "state") === !!isState).map((e) => e.id),
    );
    const ov = get(overridesStore);
    const outras = ov.order.filter((id) => !daNatureza.has(id));
    reorderEntries([...orderedIds.filter((id) => daNatureza.has(id)), ...outras]);
}

export function resetInputBarConfig() {
    const empty = emptyOverrides();
    saveOverrides(empty);
    overridesStore.set(empty);
    reconcile(get(entriesStore));
}
