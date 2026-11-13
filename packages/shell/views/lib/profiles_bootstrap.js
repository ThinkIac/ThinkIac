// profiles_bootstrap.js — perfis de configuração do shell.
//
// Um PERFIL é um conjunto nomeado de configurações do Agent: a ordem/
// visibilidade do menu, a da InputBar, o tema. A ideia é ter jornadas
// diferentes ao longo do dia (trabalho, estudo, noite) sem reconfigurar tudo
// item a item toda vez.
//
// ── O contrato ────────────────────────────────────────────────────────────
//
// As chaves de configuração continuam sendo a fonte da verdade. Este módulo
// NÃO substitui menu_bootstrap/inputbar_bootstrap/theme — eles seguem lendo e
// escrevendo exatamente o que sempre escreveram em localStorage. O que muda:
//
//   1. Cada módulo de configuração se registra aqui com sua chave e um
//      `hydrate()` que relê essa chave para dentro dos próprios stores.
//   2. Depois de todo save, o módulo chama `touchActiveProfile()` — o perfil
//      ativo copia as chaves registradas para dentro de si. Ou seja, o perfil
//      ativo está SEMPRE em dia: não existe "esqueci de salvar o perfil".
//   3. Trocar de perfil = escrever as chaves guardadas no perfil de destino e
//      chamar o `hydrate()` de cada escopo.
//
// A inversão (o módulo se registra, em vez de este importar aquele) existe
// para não criar ciclo de import — profiles_bootstrap não conhece nenhum
// módulo de configuração concreto, e é isso que deixa pacotes futuros
// contribuírem com seus próprios escopos.
import { writable, derived, get } from "svelte/store";
import { readMigratedStorage } from "./storage_migration.js";

const STORAGE_KEY = "agent:profiles";

/** Escopos registrados: { key, hydrate }. A ordem de registro é irrelevante. */
const scopes = [];

function novoId() {
    return `p-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

/** Lê as chaves registradas cruas do localStorage (ausente = omitida). */
function snapshotAtual() {
    if (typeof localStorage === "undefined") return {};
    const data = {};
    for (const { key } of scopes) {
        try {
            const raw = localStorage.getItem(key);
            if (raw !== null) data[key] = raw;
        } catch (e) {
            console.warn("[profiles] falha ao ler", key, e);
        }
    }
    return data;
}

/**
 * Escreve um snapshot nas chaves reais e manda cada escopo se re-hidratar.
 *
 * São DUAS passadas de propósito: um `hydrate` pode gravar de volta (o menu
 * reconcilia itens novos ao reler) e acabaria lendo um estado meio-aplicado se
 * as escritas ainda estivessem em andamento. Todas as chaves entram primeiro,
 * só então alguém relê.
 */
function aplicarSnapshot(data) {
    if (typeof localStorage === "undefined") return;
    for (const { key } of scopes) {
        try {
            // Chave ausente no perfil = a configuração daquele escopo nunca foi
            // tocada nele. Remover (em vez de deixar a do perfil anterior
            // vazando) é o que faz o escopo cair no próprio default.
            if (Object.prototype.hasOwnProperty.call(data, key)) {
                localStorage.setItem(key, data[key]);
            } else {
                localStorage.removeItem(key);
            }
        } catch (e) {
            console.warn("[profiles] falha ao escrever", key, e);
        }
    }
    for (const { key, hydrate } of scopes) {
        try {
            hydrate?.();
        } catch (e) {
            console.warn("[profiles] falha ao re-hidratar", key, e);
        }
    }
}

function estadoVazio() {
    return { activeId: null, profiles: [] };
}

function carregar() {
    if (typeof localStorage === "undefined") return estadoVazio();
    try {
        const raw = readMigratedStorage(localStorage, STORAGE_KEY, ["aurora:profiles"]);
        const parsed = raw ? JSON.parse(raw) : null;
        if (!parsed || !Array.isArray(parsed.profiles)) return estadoVazio();
        const profiles = parsed.profiles.filter((p) => p && p.id && typeof p.name === "string");
        const activeId = profiles.some((p) => p.id === parsed.activeId) ? parsed.activeId : profiles[0]?.id || null;
        return { activeId, profiles };
    } catch (e) {
        console.warn("[profiles] falha ao ler perfis:", e);
        return estadoVazio();
    }
}

function persistir(estado) {
    if (typeof localStorage === "undefined") return;
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(estado));
    } catch (e) {
        console.warn("[profiles] falha ao salvar perfis:", e);
    }
}

const estadoStore = writable(carregar());

export const profiles = derived(estadoStore, ($e) => $e.profiles);
export const activeProfileId = derived(estadoStore, ($e) => $e.activeId);
export const activeProfile = derived(estadoStore, ($e) => $e.profiles.find((p) => p.id === $e.activeId) || null);

/** Já existe pelo menos um perfil materializado? */
function inicializado() {
    return get(estadoStore).profiles.length > 0;
}

/**
 * Registra um escopo de configuração.
 *
 * @param {{ key: string, hydrate?: () => void }} scope
 *   `key`     — a chave de localStorage que o módulo já usa.
 *   `hydrate` — relê essa chave para dentro dos stores do módulo. Chamado
 *               depois de uma troca de perfil.
 *
 * O primeiro registro também faz a MIGRAÇÃO: se ainda não há perfil nenhum, a
 * configuração que o usuário já tinha vira o perfil "Default", ativo. Nada é
 * descartado no upgrade.
 */
export function registerProfileScope(scope) {
    if (!scope?.key) return;
    const existente = scopes.find((s) => s.key === scope.key);
    if (existente) {
        // Re-registro: um escopo declarado dentro de um componente (o tema,
        // no Home) volta a passar por aqui se o componente remontar. Trocar o
        // hydrate é obrigatório — o antigo fecha sobre a instância destruída.
        existente.hydrate = scope.hydrate;
        return;
    }
    scopes.push({ key: scope.key, hydrate: scope.hydrate });

    if (!inicializado()) {
        const agora = new Date().toISOString();
        const inicial = {
            activeId: null,
            profiles: [
                { id: novoId(), name: "Default", data: snapshotAtual(), createdAt: agora, updatedAt: agora },
            ],
        };
        inicial.activeId = inicial.profiles[0].id;
        persistir(inicial);
        estadoStore.set(inicial);
        return;
    }

    // Escopo que chegou depois da migração (ex.: um módulo carregado sob
    // demanda): captura o estado atual dele no perfil ativo para que a chave
    // não fique órfã — sem isso a primeira troca de perfil a apagaria.
    touchActiveProfile();
}

/**
 * Copia as chaves registradas para dentro do perfil ativo. Deve ser chamado
 * por todo módulo de configuração logo depois de persistir uma mudança —
 * é o que mantém o perfil ativo sempre igual ao estado vivo da tela.
 */
export function touchActiveProfile() {
    const estado = get(estadoStore);
    if (!estado.activeId) return;
    // MESCLA, não substitui: um escopo pode registrar depois deste touch (o
    // registro acontece no import de cada módulo, em ordem indefinida) e
    // sobrescrever `data` inteiro apagaria a chave de quem ainda não chegou.
    const parcial = snapshotAtual();
    const profilesNovos = estado.profiles.map((p) =>
        p.id === estado.activeId
            ? { ...p, data: { ...(p.data || {}), ...parcial }, updatedAt: new Date().toISOString() }
            : p,
    );
    const next = { ...estado, profiles: profilesNovos };
    persistir(next);
    estadoStore.set(next);
}

/**
 * Troca o perfil ativo: captura o que está na tela no perfil que sai, escreve
 * as chaves do perfil que entra e re-hidrata cada escopo.
 */
export function switchProfile(id) {
    const estado = get(estadoStore);
    if (id === estado.activeId) return;
    const alvo = estado.profiles.find((p) => p.id === id);
    if (!alvo) return;

    // Fecha a conta do perfil que sai antes de sobrescrever as chaves.
    touchActiveProfile();

    // A mira muda ANTES de aplicar: re-hidratar pode disparar um save (o menu
    // reconcilia itens novos), e esse save tem que cair no perfil que entra,
    // não no que acabou de sair.
    const atualizado = get(estadoStore);
    const next = { ...atualizado, activeId: id };
    persistir(next);
    estadoStore.set(next);

    aplicarSnapshot(alvo.data || {});
}

/**
 * Cria um perfil novo. Por padrão parte da configuração atual (é o que o
 * usuário espera: "quero isto aqui, mas variando um pouco"). Com
 * `blank: true` o perfil nasce vazio e cada escopo cai no próprio default.
 * O perfil criado já entra em uso.
 */
export function createProfile(name, { blank = false } = {}) {
    const nome = (name || "").trim() || "New profile";
    // O perfil que sai precisa estar em dia antes de trocarmos a mira.
    touchActiveProfile();

    const agora = new Date().toISOString();
    const perfil = {
        id: novoId(),
        name: nome,
        data: blank ? {} : snapshotAtual(),
        createdAt: agora,
        updatedAt: agora,
    };

    const estado = get(estadoStore);
    const next = { activeId: perfil.id, profiles: [...estado.profiles, perfil] };
    persistir(next);
    estadoStore.set(next);

    // Perfil em branco muda a tela na hora; o clonado já bate com o que está lá.
    if (blank) aplicarSnapshot({});
    return perfil.id;
}

/** Copia um perfil existente (sem ativá-lo). */
export function duplicateProfile(id) {
    const estado = get(estadoStore);
    const origem = estado.profiles.find((p) => p.id === id);
    if (!origem) return null;
    // Se a origem é a ativa, o snapshot vivo é mais recente que o guardado.
    const data = id === estado.activeId ? snapshotAtual() : { ...(origem.data || {}) };

    const agora = new Date().toISOString();
    const copia = { id: novoId(), name: `${origem.name} copy`, data, createdAt: agora, updatedAt: agora };
    const next = { ...estado, profiles: [...estado.profiles, copia] };
    persistir(next);
    estadoStore.set(next);
    return copia.id;
}

export function renameProfile(id, name) {
    const nome = (name || "").trim();
    if (!nome) return;
    estadoStore.update((estado) => {
        const next = {
            ...estado,
            profiles: estado.profiles.map((p) =>
                p.id === id ? { ...p, name: nome, updatedAt: new Date().toISOString() } : p,
            ),
        };
        persistir(next);
        return next;
    });
}

/**
 * Remove um perfil. O último não pode ser removido — ficar sem nenhum perfil
 * deixaria o registry sem onde gravar as mudanças seguintes. Se o removido era
 * o ativo, o primeiro dos restantes entra no lugar (e a tela muda junto).
 */
export function deleteProfile(id) {
    const estado = get(estadoStore);
    if (estado.profiles.length <= 1) return false;
    const restantes = estado.profiles.filter((p) => p.id !== id);
    if (restantes.length === estado.profiles.length) return false;

    if (estado.activeId === id) {
        const proximo = restantes[0];
        // Mesma ordem do switchProfile: a mira primeiro, a aplicação depois.
        const next = { activeId: proximo.id, profiles: restantes };
        persistir(next);
        estadoStore.set(next);
        aplicarSnapshot(proximo.data || {});
    } else {
        const next = { ...estado, profiles: restantes };
        persistir(next);
        estadoStore.set(next);
    }
    return true;
}
