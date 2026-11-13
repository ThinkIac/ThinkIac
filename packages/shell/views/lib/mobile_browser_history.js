// Estado serializável que conecta a pilha visual do Shell ao histórico nativo
// do navegador/WebView. A chave é isolada para não sobrescrever estado de
// outras camadas que também usem history.state.
export const MOBILE_DESTINATION_HISTORY_KEY = "thinkiac.shell.mobileDestination";

export function mobileDestinationFromHistoryState(state) {
    const destination = state?.[MOBILE_DESTINATION_HISTORY_KEY];
    if (!destination || (destination.kind !== "chat" && destination.kind !== "app")) return null;
    if (typeof destination.id !== "string" || !destination.id) return null;
    return { kind: destination.kind, id: destination.id };
}

export function historyStateWithMobileDestination(state, destination) {
    if (!destination?.id || (destination.kind !== "chat" && destination.kind !== "app")) return state ?? {};
    return {
        ...(state && typeof state === "object" ? state : {}),
        [MOBILE_DESTINATION_HISTORY_KEY]: { kind: destination.kind, id: destination.id },
    };
}
