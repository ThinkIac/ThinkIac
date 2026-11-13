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
    accordionMode,
    accordionOpenMap,
} = await import(`./menu_bootstrap.js?test=${Date.now()}`);

const source = await readFile(new URL('./menu_bootstrap.js', import.meta.url), 'utf8');
assert.match(source, /const MENU_APPS_CACHE_KEY = "shell:menu-apps-cache:v1";/);
assert.match(source, /const cachedApps = readCachedMenuApps\(\);/);

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
assert.equal(get(accordionMode), true);
assert.deepEqual(get(accordionOpenMap), {
    windows: true,
    sessions: true,
    apps: true,
    "chat-sessions": true,
});

for (const [path, expectedLabel] of [
    ["packages/system-monitor/package.json", "System Usage"],
    ["packages/process-manager/package.json", "Gerenciador de Tarefas"],
]) {
    const manifest = JSON.parse(await readFile(path, "utf8"));
    assert.equal(manifest.manifest.menu.label, expectedLabel);
}
