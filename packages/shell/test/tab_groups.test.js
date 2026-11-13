import test from "node:test";
import assert from "node:assert/strict";
import { groupTab, moveTab, normalizeTabGroups, normalizeTabOrder } from "../views/lib/tab_groups.js";

const tabs = ["a", "b", "c", "d", "e"].map((sessionId) => ({ sessionId }));

test("normalizes a mixed app/chat order without losing new tabs", () => {
    assert.deepEqual(normalizeTabOrder(["c", "missing", "a"], tabs), ["c", "a", "b", "d", "e"]);
});

test("reorders tabs independently of their type", () => {
    assert.deepEqual(moveTab(["a", "b", "c"], "a", "c"), ["b", "a", "c"]);
    assert.deepEqual(moveTab(["a", "b", "c"], "a", "c", true), ["b", "c", "a"]);
});

test("creates groups and refuses a fifth member", () => {
    const created = groupTab([], "b", "a", () => "g1");
    assert.deepEqual(created.groups[0].tabIds, ["a", "b"]);
    const full = [{ id: "g1", name: "G", tabIds: ["a", "b", "c", "d"], layout: "grid" }];
    assert.equal(groupTab(full, "e", "a", () => "g2").rejected, true);
});

test("drops invalid and duplicate persisted group members", () => {
    const groups = normalizeTabGroups([
        { id: "g1", tabIds: ["a", "b", "missing"] },
        { id: "g2", tabIds: ["b", "c"] },
    ], tabs);
    assert.deepEqual(groups, [{ id: "g1", tabIds: ["a", "b"], name: "Grupo", layout: "columns" }]);
});
