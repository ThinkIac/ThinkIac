import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { closeChatTab } from "../views/lib/chat_tabs.js";
import { saveSessionState, restoreSessionState } from "../views/persistence.js";

const values = new Map();
globalThis.localStorage = {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key),
};



const previous = {
    tabs: [{ sessionId: "orbit-a" }, { sessionId: "orbit-b" }],
    appTabs: [],
    activeTab: "orbit-b",
    sessionId: "orbit-b",
    sessionCache: { "orbit-b": [{ role: "user", content: "oi" }] },
    unreadMap: {},
    isMobile: false,
    history: [{ role: "user", content: "oi" }],
    activeIsApp: false,
};
const closed = closeChatTab("orbit-b", previous);
saveSessionState({ ...previous, ...closed, sessionCache: {} });
assert.deepEqual(restoreSessionState().tabs, [{ sessionId: "orbit-a" }]);
assert.equal(restoreSessionState().activeTab, "orbit-a");

const home = await readFile(new URL("../views/Home.svelte", import.meta.url), "utf8");
assert.match(home, /function handleVisibilityChange\(\)\s*\{\s*if \(document\.hidden\) fullSaveSessionState\(\);\s*\}/);
assert.match(home, /document\.addEventListener\("visibilitychange", handleVisibilityChange\)/);
assert.match(home, /document\.removeEventListener\("visibilitychange", handleVisibilityChange\)/);

for (const handler of [
    "handleSelectTab",
    "handleNewTab",
    "handleRenameTab",
    "handleTogglePin",
    "handleCloseTab",
    "handleOpenApp",
    "handleCloseApp",
    "handleCloseAllApps",
]) {
    const start = home.search(new RegExp(`(?:export )?(?:async )?function ${handler}\\b`));
    const end = home.indexOf("\n    function ", start + 1);
    assert.ok(start >= 0, `${handler} existe`);
    assert.match(home.slice(start, end < 0 ? undefined : end), /fullSaveSessionState\(\)/, `${handler} persiste a mutação`);
}

console.log("tab persistence: ok");
