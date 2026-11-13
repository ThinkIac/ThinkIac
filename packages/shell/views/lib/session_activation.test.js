import { describe, expect, test } from "vitest";
import { createSessionActivationGuard } from "./session_activation.js";

describe("isolamento da ativação de conversas", () => {
    test("rejeita uma carga antiga depois que outra conversa foi selecionada", () => {
        const guard = createSessionActivationGuard();
        const first = guard.begin("chat-a");
        const second = guard.begin("chat-b");

        expect(guard.isCurrent(first, "chat-b")).toBe(false);
        expect(guard.isCurrent(second, "chat-b")).toBe(true);
    });

    test("não publica histórico de chat enquanto uma aba de app está ativa", () => {
        const guard = createSessionActivationGuard();
        const token = guard.begin("chat-a");

        expect(guard.isCurrent(token, "chat-a", true)).toBe(false);
    });
});
