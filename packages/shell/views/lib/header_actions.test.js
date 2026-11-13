import { describe, expect, test } from "vitest";
import { actionTargetsView, headerActionMessage, headerActionsForView } from "./header_actions.js";

const app = { packageName: "projects", view: "Editor" };
const action = { id: "edit-ai", label: "Editar com IA", event: "ai:edit", sourcePackage: "ai-addon", target: { package: "projects", view: "Editor" }, order: 20 };

describe("header actions", () => {
    test("seleciona somente contribuições da view ativa e deduplica o catálogo", () => {
        const catalog = [{ headerActions: [action] }, { headerActions: [action, { ...action, id: "other", target: { package: "projects", view: "Index" } }] }];
        expect(headerActionsForView(catalog, app)).toEqual([action]);
    });

    test("compara package e view sem depender de maiúsculas", () => {
        expect(actionTargetsView({ target: { package: "PROJECTS", view: "editor" } }, app)).toBe(true);
        expect(actionTargetsView({ target: { package: "projects", view: "Index" } }, app)).toBe(false);
    });

    test("transporta somente o envelope do protocolo para a view", () => {
        expect(headerActionMessage(action, app)).toEqual({
            type: "thinkiac:header-action", version: 1,
            action: { id: "edit-ai", label: "Editar com IA", event: "ai:edit", sourcePackage: "ai-addon" },
            target: { package: "projects", view: "Editor" },
        });
    });
});
