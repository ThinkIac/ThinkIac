import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { get } from "svelte/store";

const storage = new Map();
globalThis.localStorage = {
    getItem: (key) => storage.get(key) ?? null,
    setItem: (key, value) => storage.set(key, String(value)),
    removeItem: (key) => storage.delete(key),
};

const {
    MENU_DEFAULTS,
    menuItems,
    desktopMenuItems,
    leftPanelItems,
    rightPanelItems,
    isDedicatedMenuView,
} = await import(`./menu_bootstrap.js?test=${Date.now()}`);

assert.equal(isDedicatedMenuView({ view: "Widget" }), true);
assert.equal(isDedicatedMenuView({ view: "Index" }), false);
assert.equal(isDedicatedMenuView({ view: "home" }), false);
assert.equal(isDedicatedMenuView({}), false);

assert.deepEqual(MENU_DEFAULTS.order, [
    "chat-sessions",
    "apps",
    "windows",
    "sessions",
]);
assert.deepEqual(MENU_DEFAULTS.mobileOrderLeft, [
    "chat-sessions",
    "windows",
]);
assert.deepEqual(MENU_DEFAULTS.mobileOrderRight, ["apps", "sessions"]);

assert.deepEqual(
    get(menuItems).map(({ id, label, target, visible }) => ({ id, label, target, visible })),
    [
        { id: "windows", label: "Workstation", target: "left", visible: true },
        { id: "sessions", label: "Sessions", target: "right", visible: true },
        { id: "apps", label: "Packages", target: "right", visible: true },
        { id: "chat-sessions", label: "Conversations", target: "left", visible: true },
    ],
);
assert.deepEqual(get(desktopMenuItems).map((item) => item.id), ["chat-sessions", "apps", "windows", "sessions"]);
assert.deepEqual(get(leftPanelItems).map((item) => item.id), ["chat-sessions", "windows"]);
assert.deepEqual(get(rightPanelItems).map((item) => item.id), ["apps", "sessions"]);

for (const [manifestUrl, expectedLabel] of [
    [new URL("../../../process-manager/package.json", import.meta.url), "Task Manager"],
]) {
    const manifest = JSON.parse(await readFile(manifestUrl, "utf8"));
    assert.equal(manifest.manifest.menu.label, expectedLabel);
}
