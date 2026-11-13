import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeAllAppTabs } from "../views/lib/app_tabs.js";

const base = {
    appTabs: [{ id: "tasks" }, { id: "agenda" }],
    activeTab: "tasks",
    activeIsApp: true,
    sessionId: "orbit-a",
};


assert.deepEqual(closeAllAppTabs(base), {
    ...base,
    appTabs: [],
    activeTab: "orbit-a",
    activeIsApp: false,
});


assert.deepEqual(closeAllAppTabs({ ...base, sessionId: "" }), {
    ...base,
    sessionId: "",
    appTabs: [],
    activeTab: "",
    activeIsApp: false,
});


assert.deepEqual(closeAllAppTabs({ ...base, activeTab: "orbit-a", activeIsApp: false }), {
    ...base,
    appTabs: [],
    activeTab: "orbit-a",
    activeIsApp: false,
});

const [windows, menuList, sidebar, home] = await Promise.all([
    readFile(new URL("../views/Windows.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/MenuList.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Sidebar.svelte", import.meta.url), "utf8"),
    readFile(new URL("../views/Home.svelte", import.meta.url), "utf8"),
]);

assert.match(windows, /aria-label="Fechar todos os apps do Dock"/);
assert.match(windows, /dispatch\('closeAllApps'\)/);
assert.match(menuList, /on:closeAllApps=\{onCloseAllApps\}/);
assert.match(sidebar, /dispatch\("closeAllApps"\)/);
assert.match(home, /on:closeAllApps=\{handleCloseAllApps\}/);

console.log("app tabs: ok");
