import { describe, expect, test } from "vitest";

import {
    MOBILE_DESTINATION_HISTORY_KEY,
    historyStateWithMobileDestination,
    mobileDestinationFromHistoryState,
} from "./mobile_browser_history.js";

describe("histórico mobile do navegador", () => {
    test("preserva o estado existente ao registrar um destino mobile", () => {
        const state = historyStateWithMobileDestination({ scroll: 120 }, { kind: "app", id: "tasks" });
        expect(state).toEqual({
            scroll: 120,
            [MOBILE_DESTINATION_HISTORY_KEY]: { kind: "app", id: "tasks" },
        });
    });

    test("aceita apenas destinos internos completos ao restaurar o histórico", () => {
        expect(
            mobileDestinationFromHistoryState({ [MOBILE_DESTINATION_HISTORY_KEY]: { kind: "chat", id: "sessao-1" } }),
        ).toEqual({ kind: "chat", id: "sessao-1" });
        expect(mobileDestinationFromHistoryState({ [MOBILE_DESTINATION_HISTORY_KEY]: { kind: "other", id: "x" } })).toBeNull();
        expect(mobileDestinationFromHistoryState({ [MOBILE_DESTINATION_HISTORY_KEY]: { kind: "app" } })).toBeNull();
    });
});
