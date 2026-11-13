import { describe, expect, test } from "vitest";
import { createOrExtendGroup, normalizeTabOrder, removeTabFromGroups, reorderTab } from "./tab_groups.js";

describe("desktop tab groups", () => {
    test("preserves one order across chat and app tabs", () => {
        const tabs = [{ sessionId: "chat" }, { sessionId: "app" }, { sessionId: "other" }];
        expect(normalizeTabOrder(["app", "chat"], tabs)).toEqual(["app", "chat", "other"]);
        expect(reorderTab(["app", "chat", "other"], "other", "app")).toEqual(["other", "app", "chat"]);
    });

    test("groups up to four tabs and rejects the fifth", () => {
        let result = createOrExtendGroup([], "b", "a", () => "g");
        result = createOrExtendGroup(result.groups, "c", "a");
        result = createOrExtendGroup(result.groups, "d", "a");
        expect(result.groups[0].members).toEqual(["a", "b", "c", "d"]);
        const rejected = createOrExtendGroup(result.groups, "e", "a");
        expect(rejected.rejected).toBe(true);
        expect(rejected.groups[0].members).toHaveLength(4);
    });

    test("dissolves a group after only one member remains", () => {
        expect(removeTabFromGroups([{ id: "g", members: ["a", "b"] }], "a")).toEqual([]);
    });
});
