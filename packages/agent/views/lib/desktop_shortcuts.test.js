import assert from "node:assert/strict";
import { adjacentTabId, desktopShortcutAction, isEditableShortcutTarget } from "./desktop_shortcuts.js";

const press = (key, extra = {}) => desktopShortcutAction({ key, ctrlKey: true, ...extra });

assert.deepEqual(press("1"), { type: "select-index", index: 0 });
assert.deepEqual(press("0"), { type: "select-index", index: 9 });
assert.deepEqual(press("Tab"), { type: "next-tab" });
assert.deepEqual(press("Tab", { shiftKey: true }), { type: "previous-tab" });
assert.deepEqual(press("w"), { type: "close-active" });
assert.deepEqual(press("w", { shiftKey: true }), { type: "close-all" });
assert.deepEqual(press("r"), { type: "refresh-active" });
assert.deepEqual(press("r", { shiftKey: true }), { type: "reopen-active" });
assert.deepEqual(press("r", { altKey: true }), { type: "refresh-all" });
assert.deepEqual(press("r", { shiftKey: true, altKey: true }), { type: "recover-runtime" });
assert.deepEqual(press("b"), { type: "toggle-sidebar" });
assert.deepEqual(press("!", { shiftKey: true, code: "Digit1" }), { type: "select-index", index: 0 });
assert.deepEqual(press(")", { shiftKey: true, code: "Digit0" }), { type: "select-index", index: 9 });
assert.deepEqual(press("ArrowRight", { shiftKey: true, code: "ArrowRight" }), { type: "next-tab" });
assert.deepEqual(press("ArrowLeft", { shiftKey: true, code: "ArrowLeft" }), { type: "previous-tab" });
assert.deepEqual(desktopShortcutAction({ key: "1", metaKey: true }), { type: "select-index", index: 0 });
assert.equal(desktopShortcutAction({ key: "r", ctrlKey: true, isComposing: true }), null);
assert.equal(desktopShortcutAction({ key: "@", code: "Digit2", ctrlKey: true, altKey: true, getModifierState: key => key === "AltGraph" }), null);
assert.equal(desktopShortcutAction({ key: "r", ctrlKey: true }, { isMobile: true }), null);
assert.equal(isEditableShortcutTarget({ closest: selector => selector.includes("contenteditable") ? {} : null }), true);

const tabs = [{ sessionId: "a" }, { sessionId: "b" }, { sessionId: "c" }];
assert.equal(adjacentTabId(tabs, "b", 1), "c");
assert.equal(adjacentTabId(tabs, "c", 1), "a");
assert.equal(adjacentTabId(tabs, "a", -1), "c");
assert.equal(adjacentTabId([], "a", 1), null);
